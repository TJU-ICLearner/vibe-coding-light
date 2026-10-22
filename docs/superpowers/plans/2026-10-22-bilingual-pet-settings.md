# Bilingual Pet Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent Chinese/English switch for all app-owned UI and rebuild the pet settings editor so five asset slots are clear and the preview stays visible.

**Architecture:** Rust owns the saved locale, tray menu, tooltip and window title; the settings WebView reads it and reacts to `locale-changed`. Both sides render from keyed copy, with structured codes for predictable import errors. Existing `AssetDraft` still owns five independent slots while the settings page shows one editor at a time beside a stable preview.

**Tech Stack:** Tauri 2, Rust/Serde, `sys-locale` 0.3.2, TypeScript, Vitest/jsdom, macOS WebView.

**Spec:** `docs/superpowers/specs/2026-10-22-bilingual-pet-settings-design.md`

## Global Constraints

- Supported UI locales are `zh-CN` and `en`; default to Chinese only for a `zh` system locale, otherwise English. An explicit choice persists in app data and applies without restart. The language submenu and its two choices are themselves localized.
- English mode contains no app-owned Chinese copy in tray, tooltip, title, settings page, validation, warnings or action feedback. File names, pet names, paths, Agent free text and OS/third-party error details remain untouched.
- Slots remain `default`, `working`, `waiting`, `error`, `completed`; `idle` and `unknown` use `default`. Single mode saves only `default`; switching modes or languages preserves draft assets.
- Waiting state semantics and pet package format remain unchanged. This task does not add a third language, cloud translation, or new image processing.
- Settings must work at 760×760 and the existing 620×540 minimum window; English labels may wrap without hiding controls. The DMG must contain an `.app` passing `codesign --verify --deep --strict`.
- Keep the existing `com.cuihuapeng.code-light` identifier, `~/.code-light` hook data, and v1/v2 saved pet compatibility.

## Review Focus

1. A corrupt or unreadable locale preference must fall back to the system locale without preventing startup; Task 1 tests both conditions.
2. A failed preference write must leave the current locale unchanged in menu and open settings window; Task 1 tests the store and Task 2 tests switch ordering.
3. Switching language while an image is processing must preserve the pending result and current slot; Task 4 tests a deferred `prepare` call during locale change.
4. Long English copy at 620×540 and enlarged text must not overflow the tab row or cover the save action; Task 5 includes a visual check at both sizes.
5. A GIF in one optional slot, a missing neighboring slot, and repeated state selection must still show the correct preview without reprocessing; Task 5 tests asset preservation and fallback.

---

## File Map

- `src-tauri/src/ui_locale.rs`: locale enum, system selection and atomic preference store.
- `src-tauri/src/ui_copy.rs`: Rust menu, tooltip, title and fixed hook-message copy.
- `src-tauri/src/lib.rs`: Tauri commands, locale events and live menu/window updates.
- `src-tauri/src/pet_commands.rs`: stable user-facing error codes for image/profile commands.
- `src/i18n.ts`: TypeScript dictionaries, locale controller and error formatting.
- `src/pet/asset_draft.ts`: stable local validation codes while retaining per-slot request generations.
- `src/settings.ts`, `settings.html`, `src/settings.css`: translated settings editor, five slot tabs and visual layout.
- Existing Rust/TypeScript test files and new `src/i18n.test.ts`: behavior gates. README and release note: user instructions.

### Task 1: Persist the app locale

**Files:** Create `src-tauri/src/ui_locale.rs`; modify `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/lib.rs`; test in `ui_locale.rs`.

**Interfaces:** Produce `AppLocale { ZhCn, En }` serialized as `"zh-CN"` / `"en"`; `AppLocale::from_system_tag(tag: Option<&str>) -> AppLocale`; `UiLocaleStore::load(path: PathBuf, system_tag: Option<&str>) -> Self`; `UiLocaleStore::get(&self) -> AppLocale`; `UiLocaleStore::set(&mut self, locale: AppLocale) -> Result<(), String>`. Production system tag comes from `sys_locale::get_locale()`.

- [ ] **Step 1: Write failing Rust tests** `system_tag_selects_supported_language`, `corrupt_or_unreadable_preference_uses_system_locale`, `choice_survives_reload`, and `failed_write_keeps_old_choice`. Assert `zh-HK`→`ZhCn`, `en-US`/`ja-JP`/`None`→`En`; invalid stored JSON and a directory at the preference path fall back; failed persistence leaves `get()` unchanged.
- [ ] **Step 2: Run** `cargo test --manifest-path src-tauri/Cargo.toml ui_locale::tests --lib`; expect compile/test failure from missing interfaces.
- [ ] **Step 3: Implement** the interfaces in `ui_locale.rs`, storing `{ "locale": "..." }` in `app_data_dir()/preferences.json`. Use a same-directory temporary file and atomic rename; create the parent directory as needed. Add `sys-locale = "0.3.2"`; register the module in `lib.rs`.
- [ ] **Step 4: Run** the same Rust command; require all `ui_locale::tests` to pass.
- [ ] **Step 5: Commit** these files as `feat: persist interface language`.

### Task 2: Localize tray menu, tooltip and settings title

**Files:** Create `src-tauri/src/ui_copy.rs`; modify `src-tauri/src/lib.rs`; test in `ui_copy.rs` and `lib.rs`.

**Interfaces:** Consume `AppLocale` and `UiLocaleStore` from Task 1. Produce `get_app_locale() -> AppLocale`, `set_app_locale(locale: AppLocale) -> Result<AppLocale, String>` Tauri commands and `locale-changed` event payload `"zh-CN" | "en"`. `ui_copy::HookFeedback { Initial, Installed, Failed(String) }`; `ui_copy::menu_labels(locale, pet_visible, claude_hook_result, codex_hook_result)` returns all menu labels; `ui_copy::status_text(locale, state, message, timestamp, count)` returns the tooltip; `ui_copy::settings_title(locale)` returns the window title. `change_locale(store: &mut UiLocaleStore, requested: AppLocale, publish: impl FnOnce(AppLocale)) -> Result<AppLocale, String>` persists before notifying the UI.

- [ ] **Step 1: Write failing Rust tests** `menu_labels_follow_locale_and_feedback`, `status_text_translates_fixed_copy`, and `change_locale_publishes_only_after_save`. Cover both locales' menu/action labels and tooltip states, including `2 sessions`, relative times, a known hook message, and arbitrary Agent message preserved verbatim. In the last test, a blocked preference write must not call `publish` or alter label state.
- [ ] **Step 2: Run** `cargo test --manifest-path src-tauri/Cargo.toml --lib ui_copy::tests` and `cargo test --manifest-path src-tauri/Cargo.toml --lib change_locale_publishes_only_after_save`; expect missing copy/switch behavior.
- [ ] **Step 3: Implement** one locale state managed by Tauri, native mutually exclusive Chinese/English menu choices, live `set_text`/check updates, tooltip refresh, and settings window `set_title`. Save before updating in-memory locale or emitting the event. Preserve pet visibility and hook result state during language changes; fixed hook messages are translated, Agent free text is not.
- [ ] **Step 4: Run** `cargo test --manifest-path src-tauri/Cargo.toml --lib` and `pnpm build`; require both to pass.
- [ ] **Step 5: Commit** Rust copy/menu changes as `feat: switch tray interface language`.

### Task 3: Give image errors stable codes

**Files:** Modify `src-tauri/src/pet_commands.rs`; test in that module.

**Interfaces:** Produce Tauri-serializable `PetCommandError { code: String, detail: Option<String> }` for `prepare_pet_preview`, `save_pet_profile`, legacy `save_photo_pet`, `list_photo_pets`, `select_pet` and `delete_photo_pet`. Codes cover existing predictable validation/store failures (e.g. `too_large`, `invalid_animation`, `no_transparency`, `invalid_transform`, `not_found`); unknown I/O details use `internal_error` plus `detail`. Existing successful payloads and command names stay unchanged.

- [ ] **Step 1: Write failing Rust tests** `serializes_known_pet_error_codes` and `retains_unknown_io_detail` using representative GIF, transform and missing-profile failures; assert stable JSON `code` values, with no translated sentence used as a discriminator.
- [ ] **Step 2: Run** `cargo test --manifest-path src-tauri/Cargo.toml pet_commands::tests --lib`; expect the new cases to fail.
- [ ] **Step 3: Implement** error-code mapping from existing Rust variants and update Tauri command `Result` error types. Keep detailed error strings only as optional diagnostics for unexpected failures; maintain normal success and rollback behavior.
- [ ] **Step 4: Run** `cargo test --manifest-path src-tauri/Cargo.toml --lib` and `pnpm build`; require both to pass.
- [ ] **Step 5: Commit** Rust error interfaces and tests as `feat: expose localized pet error codes`.

### Task 4: Translate the settings window without losing drafts

**Files:** Create `src/i18n.ts`, `src/i18n.test.ts`; modify `src/pet/asset_draft.ts`, `src/pet/asset_draft.test.ts`, `src/settings.ts`, `src/settings.test.ts`, `settings.html`.

**Interfaces:** Consume `get_app_locale`, `locale-changed`, and `PetCommandError` from Tasks 2–3. Produce `Locale = "zh-CN" | "en"`, `t(locale: Locale, key: UiKey, params?: Record<string, string | number>) -> string`, and `formatPetError(locale, error: unknown) -> string`. `validatePetFile(file, mode) -> ValidationCode | null` returns a stable code instead of a Chinese sentence; `DraftSlot.error` stores `{ code: string; detail?: string } | null` while keeping the same asset/generation behavior. UI formats errors only at render time.

- [ ] **Step 1: Write failing Vitest cases**: every `UiKey` has both translations; English initial render has no built-in Chinese text/alt/placeholder; a live `locale-changed` updates all labels and an existing error while preserving draft, selected slot and transform; a deferred `prepare` resolves after language switch into the same slot. Test each local validation code and a structured Rust error in both languages, with unknown detail preserved.
- [ ] **Step 2: Run** `pnpm test --run src/i18n.test.ts src/settings.test.ts src/pet/asset_draft.test.ts`; expect failures for missing dictionaries/codes/locale events.
- [ ] **Step 3: Implement** dictionaries and DOM localization without remounting the controller. Replace hard-coded built-in strings in `settings.html`/`settings.ts`, local validation, warnings and action feedback. Set document `lang` and title; subscribe/unsubscribe to `locale-changed`. Keep user values and source filenames untouched.
- [ ] **Step 4: Run** the same Vitest command and `pnpm build`; require all tests and TypeScript build to pass.
- [ ] **Step 5: Commit** frontend locale changes as `feat: localize pet settings`.

### Task 5: Rebuild the five-slot editor and polish layout

**Files:** Modify `settings.html`, `src/settings.ts`, `src/settings.css`, `src/settings.test.ts`; test in `src/settings.test.ts` and packaged macOS WebView.

**Interfaces:** Consume `t()` from Task 4 and existing `AssetDraft.get/selected/load/clear`. The UI has five tabs (`default`, `working`, `waiting`, `error`, `completed`), one current editor, and one persistent preview; state selection maps `default` to idle preview and absent optional assets to default. No storage/renderer API changes.

- [ ] **Step 1: Write failing Vitest cases** for tab order and selected semantics, selecting a working GIF then waiting fallback without another prepare call, preserving each slot's file/mode/asset when tabs change, default preview staying before optional editors in DOM/visual order, and single mode only exposing/saving default. Test keyboard focus/ARIA selected state.
- [ ] **Step 2: Run** `pnpm test --run src/settings.test.ts`; expect the new layout/interaction cases to fail.
- [ ] **Step 3: Implement** a two-column editor with a sticky checkerboard preview at wide sizes and preview-first stacked layout at narrow sizes. Replace four simultaneous optional cards and duplicate preview buttons with five clearly bounded tabs. Use the spec's light neutral surfaces, restrained green emphasis, slot completion labels, spacing, error placement and visible focus states; let English labels wrap.
- [ ] **Step 4: Run** `pnpm test --run src/settings.test.ts`, `pnpm build`, then the full `pnpm test --run`; require all to pass. In an isolated packaged app, visually inspect 760×760 and 620×540 at normal and enlarged text in both languages; verify the preview stays visible and controls do not overflow.
- [ ] **Step 5: Commit** settings layout and tests as `feat: clarify five-state pet editor`.

### Task 6: Package, document and publish the bilingual update

**Files:** Modify `README.md`, `README_CN.md`, `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`; create `docs/releases/v1.2.0.md` if release is cut.

**Interfaces:** No new product API; preserve `signingIdentity: "-"` in Tauri macOS config. Version the release as `1.2.0` for the already authorized fork.

- [ ] **Step 1: Update** English/Chinese README instructions and `docs/releases/v1.2.0.md`; bump package/Cargo/Tauri versions together. Explain what “waiting” means without promising a generic user-reply detector.
- [ ] **Step 2: Run** `pnpm test --run`, `cargo test --manifest-path src-tauri/Cargo.toml`, `pnpm build`, and `git diff --check`; require green suites and clean diff.
- [ ] **Step 3: In the isolated macOS app**, verify first-run locale, live menu/settings switch, persistent choice after restart, five slots, GIF preview and saved pet compatibility. Record any untested older macOS version.
- [ ] **Step 4: Build** `pnpm tauri build --bundles dmg`; run `hdiutil verify` on the DMG and `codesign --verify --deep --strict` on the `.app` mounted from that DMG. Require `CFBundleShortVersionString=1.2.0`, the existing identifier, and a matching SHA-256 manifest.
- [ ] **Step 5: Commit** release docs/metadata as `docs: release bilingual pet settings`.

After Task 6, the executing skill's whole-branch reviewer checks the feature. Fix Important findings with RED→GREEN tests, rerun the full suite, then publish the final commit and DMG to `TJU-ICLearner/vibe-coding-light` under `v1.2.0`.
