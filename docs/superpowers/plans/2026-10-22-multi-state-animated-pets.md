# Multi-State Animated Pets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the current single-image pet flow while allowing a default image plus optional state images, including transparent GIFs, on macOS.

**Architecture:** Rust validates and stores closed-format pet assets in versioned packages. The settings window builds a draft profile and previews each slot; the pet renderer selects an asset from the active profile for each existing agent state, with a default fallback. Version 1 packages remain readable without rewriting them.

**Tech Stack:** Tauri 2, Rust `image` with its `gif` feature, TypeScript, Vite, Vitest, macOS WebView.

**Spec:** `docs/superpowers/specs/2026-10-22-multi-state-animated-pets-design.md`

## Global Constraints

- Import targets macOS; background removal requires macOS 14+, transparent PNG/GIF import works on macOS 12–13. Existing Windows/Linux built-in pet behavior must still compile and run.
- Slots are `default` (required), `working`, `waiting`, `error`, `completed`; `idle` and `unknown` resolve to `default`.
- Static PNG/JPEG retains the 10 MiB input and 4096-pixel side limits and becomes a 256×256 transparent PNG. GIF is transparent and is never background-removed or re-encoded.
- GIF is at most 10 MiB, 1024 pixels per side, 2–120 frames, and 64 MiB cumulative decoded RGBA; a saved pet's assets total at most 25 MiB.
- A version 1 `manifest.json` plus `pet.png` remains readable without mutation. New saves use version 2, fixed slot filenames, and atomic package creation.
- No cloud calls, arbitrary manifest paths, animated WebP/APNG/video, per-slot transforms, or editing an existing saved pet in place.

## Review Focus

1. A valid version 1 pet selected before upgrade should still load; Task 2 tests selection and its bytes after reopening the store.
2. A GIF with a small compressed file but excessive decoded frames should be rejected without storing it; Task 1 tests the decoded-byte budget.
3. A manifest-declared optional file that goes missing should fall back only for that state; Task 2 tests a valid profile with one missing optional file.
4. Two rapid file choices in the same slot should keep the later preview; Task 5 tests completion in reverse order.
5. Duplicate `working` events should not restart an active GIF; Task 4 tests an unchanged `<img src>` across repeat events.

---

### Task 1: Validate and prepare static or GIF assets

**Files:** Modify `src-tauri/Cargo.toml`, `src-tauri/src/pet_image.rs`; test in `src-tauri/src/pet_image.rs`.

**Interfaces:** Produce `PetAssetKind { Png, Gif }` (Serde `snake_case`), `PetAsset { kind: PetAssetKind, bytes: Vec<u8> }`, `PetImageMode::KeepAnimation`, `prepare_pet_asset(input: &[u8], mode: PetImageMode) -> Result<PetAsset, PetImageError>`, and `validate_pet_asset(asset: &PetAsset) -> Result<(), PetImageError>`. Retain `prepare_pet_image` and `validate_processed_png` for existing callers.

- [ ] **Step 1: Write failing Rust tests.** In `prepares_transparent_animation_without_reencoding`, assert `asset.kind == PetAssetKind::Gif` and `asset.bytes == input`. In `rejects_invalid_animated_assets`, assert errors for an opaque GIF, an all-transparent GIF, a two-frame GIF with one fully opaque frame, one frame, 121 frames, width 1025, bytes over 10 MiB, and a small compressed GIF whose decoded RGBA exceeds 64 MiB. Assert the static path still returns `PetAssetKind::Png`.
- [ ] **Step 2: Run** `cargo test --manifest-path src-tauri/Cargo.toml pet_image::tests --lib`; confirm the new tests fail for missing interfaces/behavior.
- [ ] **Step 3: Implement** those interfaces using `image`'s `gif` feature. Detect actual file format from bytes, iterate composite frames with bounded allocation, require a visible subject and some transparent background in each composed frame, and leave GIF source bytes unchanged. Keep static processing on its existing path.
- [ ] **Step 4: Run** the same test command; require all `pet_image::tests` to pass.
- [ ] **Step 5: Commit** `src-tauri/Cargo.toml`, updated lockfile, and `src-tauri/src/pet_image.rs` as `feat: validate transparent animated pet assets`.

### Task 2: Store version 2 profiles and read version 1 packages

**Files:** Modify `src-tauri/src/pet_store.rs`; test in that file.

**Interfaces:** Produce `PetSlot { Default, Working, Waiting, Error, Completed }` (Serde `snake_case`, `Ord`), `type PetAssets = BTreeMap<PetSlot, PetAsset>`, `PetManifest.assets: BTreeMap<PetSlot, PetAssetKind>` with `#[serde(default)]`, and `PetStore::save_profile(&self, name: &str, assets: &PetAssets, scale: f32, offset_x: i16, offset_y: i16) -> Result<PetManifest, PetStoreError>`. `ActivePet::Photo` supplies validated assets and a list of invalid optional slots. Keep the existing `save` method as a single-PNG delegate; update existing tests that assume new saves still use `pet.png` to expect a version 2 `default.png`.

- [ ] **Step 1: Write failing Rust tests.** `opens_selected_v1_without_rewriting` asserts `assets[Default].bytes == old_png` after restart and identical on-disk bytes. `round_trips_v2_and_falls_back_for_missing_optional` asserts `assets[Working].kind == Gif`, then removes `working.gif` and asserts `invalid_slots == [Working]` while `Default` remains active. `rejects_bad_v2_without_selection_change` checks corrupt/missing default, a 25 MiB aggregate overrun, an invalid asset, and a staging write failure; assert no final package and the prior selected ID remains.
- [ ] **Step 2: Run** `cargo test --manifest-path src-tauri/Cargo.toml pet_store::tests --lib`; confirm failures in the new tests.
- [ ] **Step 3: Implement** version-aware reads, fixed slot filenames derived only from `PetSlot`/`PetAssetKind`, validation on save/read, atomic staging, and optional-slot recovery. Reject manifest-declared paths and unknown slot/type strings. Update list/delete/select to accept valid version 1 and 2 packages.
- [ ] **Step 4: Run** the same test command; require all `pet_store::tests` to pass.
- [ ] **Step 5: Commit** `src-tauri/src/pet_store.rs` as `feat: store multi-state pet profiles compatibly`.

### Task 3: Carry prepared assets across Tauri commands

**Files:** Modify `src-tauri/src/pet_commands.rs`, `src-tauri/src/lib.rs`, `src/pet/types.ts`; test in `src-tauri/src/pet_commands.rs`.

**Interfaces:** `prepare_pet_preview(input, mode)` returns `PreparedAssetPayload { kind: "png" | "gif", data_url: string }`; TypeScript adds `PetSlot = "default" | "working" | "waiting" | "error" | "completed"` and `PetImageMode` gains `"keep_animation"`. Add `save_pet_profile(name, assets: Partial<Record<PetSlot, PreparedAssetPayload>>, scale, offset_x, offset_y)` and expose an active-photo payload containing the same `assets` map plus `invalid_slots: PetSlot[]`. A `data_url` must have the MIME matching its verified bytes. Keep existing list/select/delete behavior and event names.

- [ ] **Step 1: Write failing command tests.** `round_trips_gif_payload` asserts the URL starts `data:image/gif;base64,` and decodes to identical bytes. `rejects_invalid_profile_payload` asserts wrong MIME, bad base64, missing default, unknown slot, and over-budget asset sets return `Err`. `serializes_v1_as_default_only` asserts a version 1 active photo has exactly one `default` PNG entry.
- [ ] **Step 2: Run** `cargo test --manifest-path src-tauri/Cargo.toml pet_commands::tests --lib`; confirm the new tests fail.
- [ ] **Step 3: Implement** bounded URL decoding and kind checks, call `PetStore::save_profile`, emit `pet-changed` after successful selection, register commands in `lib.rs`, and update TypeScript types to match the Rust payload. Do not expose filesystem paths.
- [ ] **Step 4: Run** the same Rust command and `pnpm build`; require both to pass.
- [ ] **Step 5: Commit** command and type files as `feat: expose multi-state pet assets to windows`.

### Task 4: Render slot-specific static images and GIFs

**Files:** Modify `src/pet/photo_renderer.ts`, `src/pet/photo_renderer.test.ts`, `src/styles.css`; use the updated `src/pet/types.ts` interface from Task 3.

**Interfaces:** `PhotoRenderer.applyPet(active)` receives the profile payload; `applyState(state)` maps `idle`/`unknown` to `default`, selects a valid matching slot or default, and changes `image.src` only if the selected asset differs. `react()` keeps the generic image-pet reaction.

- [ ] **Step 1: Write failing Vitest cases.** `selects_state_asset_or_default` asserts `image.src` equals `working.gif` for `working` and default for `waiting`/`unknown`. `does_not_restart_same_state_gif` spies on `src` writes and asserts the count is unchanged after duplicate `working`, then increases after leaving and re-entering. `keeps_static_motion_only` asserts static state classes remain, GIF has none, and built-in selection removes `src`.
- [ ] **Step 2: Run** `pnpm test --run src/pet/photo_renderer.test.ts`; confirm the new cases fail.
- [ ] **Step 3: Implement** a pure slot resolver within the renderer, MIME-aware class selection, current-source tracking, and reset behavior on pet changes. Preserve one-shot completed CSS motion for static assets and the built-in sprite flow.
- [ ] **Step 4: Run** the same Vitest command; require all renderer cases to pass.
- [ ] **Step 5: Commit** renderer and CSS files as `feat: switch pet artwork by agent state`.

### Task 5: Build the single-image and per-state import UI

**Files:** Modify `settings.html`, `src/settings.ts`, `src/settings.css`, `src/settings.test.ts`; create `src/pet/asset_draft.ts` and `src/pet/asset_draft.test.ts` to isolate per-slot preview requests.

**Interfaces:** `AssetDraft.load(slot: PetSlot, file: File, mode: PetImageMode, prepare: (bytes: Uint8Array, mode: PetImageMode) => Promise<PreparedAssetPayload>): Promise<void>` records one slot's preview/error with a generation counter. `AssetDraft.get(slot: PetSlot)` returns that slot's draft; `AssetDraft.selected(mode: "single" | "states")` returns the payload map to save, using only `default` in single mode. Settings calls `prepare_pet_preview` through the draft and `save_pet_profile` with its selected map. A shared scale/offset applies to the profile.

- [ ] **Step 1: Write failing controller/UI tests.** `saves_single_or_state_mode` asserts saved asset keys are `[default]` or `[default, working]`, including after toggling back to single mode. `keeps_latest_preview_per_slot` resolves two same-slot requests in reverse order and asserts the later URL remains. `shows_slot_errors_and_fallback` asserts an error leaves other previews intact, absent slots show default, and an invalid saved optional slot shows a warning. `configures_gif_import` asserts GIF removes the background-removal choice and its preview keeps the GIF URL; capability cases cover macOS 12–13 and 14+.
- [ ] **Step 2: Run** `pnpm test --run src/settings.test.ts src/pet/asset_draft.test.ts`; confirm the new cases fail.
- [ ] **Step 3: Implement** mode selector, per-slot upload controls and errors, existing transform controls, state preview, accessible status labels, and API mapping. Retain existing saved-pet list, select/delete, and capability gating on macOS 12–13/14+.
- [ ] **Step 4: Run** the same Vitest command and `pnpm build`; require both to pass.
- [ ] **Step 5: Commit** settings files as `feat: configure state-specific pet images`.

### Task 6: Verify the macOS package and document the feature

**Files:** Modify `README.md` and `src-tauri/tauri.conf.json` only if user-facing instructions/version packaging require it; add a release note in `docs/releases/` when cutting a test release.

**Interfaces:** No new product API. Confirm the built app uses version 1 and 2 packages and that state changes work in the packaged WebView.

- [ ] **Step 1: Run** `pnpm test --run`, `cargo test --manifest-path src-tauri/Cargo.toml`, `pnpm build`, and `pnpm tauri build`; require passing tests and a generated Apple Silicon `.app`/`.dmg`.
- [ ] **Step 2: Manually check** transparent GIF in single and working-state slots, PNG/JPEG auto cutout on macOS 14+, v1 pet after restart, missing optional state fallback, built-in cat selection, and state changes in the packaged app. Record any untested macOS version explicitly.
- [ ] **Step 3: Update** README import instructions and, when publishing, release notes/version metadata. Keep the bundle identifier and `~/.code-light` storage location unchanged.
- [ ] **Step 4: Run** `git diff --check` and inspect the final branch diff against the pre-feature commit; require no untracked build artifacts or unrelated edits.
- [ ] **Step 5: Commit** documentation/version changes as `docs: explain multi-state animated pets`, then request whole-branch review before GitHub publication.
