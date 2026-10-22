# Pet Pat, Larger Window, and Per-Image Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace punishment effects with a pat, let photo pets grow to 3.0 without cropping, and let each static state image choose its own motion.

**Architecture:** Store a validated per-slot motion map in schema 3 manifests while reading schema 1/2 unchanged. A shared TypeScript size function drives both the settings preview and the desktop window. CSS applies motion to still images; a separate pat controller handles the hand overlay and short reaction.

**Tech Stack:** Tauri 2/Rust, TypeScript, Vite, CSS, Vitest, macOS WebView.

**Spec:** `docs/superpowers/specs/2026-10-22-pet-pat-size-motion-design.md`

## Global Constraints

- Target the existing macOS pet experience; keep single-image and five-state workflows, transparent GIF playback, bilingual UI, and previously saved pets.
- Size is 0.5–3.0; new profiles are centered, old profiles retain their saved offsets, and the built-in cat remains 128 px.
- GIFs have no additional per-image motion; absent optional slots inherit the default asset and its motion.
- No new image-processing dependency, GIF frame extraction, head detection, or new state detection.
- Do not use Computer Use for implementation verification; provide native visual checks for the user.

## Review Focus

1. A schema 2 profile with a nonzero offset and an optional GIF must still load and render after schema 3 is introduced; Task 1 adds a legacy-load test.
2. A motion entry for a GIF or missing optional image must be rejected on save rather than silently attached to the fallback; Task 1 adds validation tests.
3. Rapidly selecting a 3.0 pet, a small pet, then the built-in cat must leave the window at 128 px; Task 3 adds a serialized resize test.
4. Enlarging a pet near the edge of a display must keep its window in the monitor work area; Task 3 adds a clamp test.
5. Two quick pats followed by an agent-state change must leave the latest state, no weapon overlay, and no stuck hand; Task 4 adds a restart/state test.

---

## File map

- `src-tauri/src/pet_store.rs`: schema 3 motion enum/map, legacy read rules, centered save validation.
- `src-tauri/src/pet_commands.rs`: motion payload and save command boundary.
- `src/pet/types.ts`: shared TypeScript motion and profile types.
- `src/pet/photo_renderer.ts`, `src/styles.css`: choose the image/motion and render it without disturbing GIF frames.
- `src/pet/window_size.ts`, `src/pet/window_sizer.ts`: pure size/position rule and serialized native resize.
- `src/settings.ts`, `settings.html`, `src/settings.css`, `src/i18n.ts`: per-slot selector, larger preview, simplified controls and bilingual copy.
- `src/pet/pat_interaction.ts`, `src/main.ts`, `index.html`, `src-tauri/src/lib.rs`, `src-tauri/src/ui_copy.rs`: pat overlay, event, shortcut and tray copy; remove punishment path.
- Existing adjacent `*.test.ts` files and Rust module tests: regression gates. README and release note: use instructions.

### Task 1: Persist and validate motion metadata

**Files:** Modify `src-tauri/src/pet_store.rs`, `src-tauri/src/pet_commands.rs`, `src/pet/types.ts`; tests in the Rust modules.

**Interfaces:**
- Produces: `PetMotion::{FollowState, Still, Sway, Float, Breathe, Bounce, Wobble}` serialized as `follow_state`, `still`, `sway`, `float`, `breathe`, `bounce`, `wobble`; `PetManifest.motions: BTreeMap<PetSlot, PetMotion>` (missing field defaults empty); `ActivePetPayload::Photo.motions` and TypeScript `ActivePet`/`PetManifest.motions`.
- Produces: `PetStore::save_profile(&self, name: &str, assets: &PetAssets, scale: f32, motions: &BTreeMap<PetSlot, PetMotion>) -> Result<PetManifest, PetStoreError>`; `save_pet_profile` Tauri command takes matching `motions` instead of offsets and stores zero offsets.
- Produces: schema 3 for new profiles; `read_photo` accepts schema 1/2 using prior transform validation and schema 3 with finite `0.5..=3.0`, zero offsets and validated motion entries.

- [ ] **Step 1: Write failing Rust tests** for a schema 2 profile with nonzero placement and GIF, schema 3 scale 3.0 saved at zero offsets, schema 3 motion map round-trip, and rejection of motion on a GIF/absent optional slot, non-finite size, unknown enum value, or a schema 3 manifest with nonzero offsets. Update existing save signatures in tests as part of this test step.
- [ ] **Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml --lib pet_store` and inspect the expected compile/assertion failures.** Expected: RED on missing `PetMotion`/`motions` and new scale cases.
- [ ] **Step 3: Implement the interfaces above.** Keep the legacy scale/offset validator for schema 1/2; canonicalize `FollowState` by omitting it from the stored map. Adapt the legacy `save_photo_pet` command to a centered schema 3 save without changing its image pipeline.
- [ ] **Step 4: Run `cargo test --manifest-path src-tauri/Cargo.toml --lib`.** Expected: all Rust library tests pass, including unchanged image/import tests.
- [ ] **Step 5: Commit** Rust store/command, TypeScript type, and test changes as `feat: store per-image pet motion`.

### Task 2: Select and render motion for each static image

**Files:** Modify `src/pet/photo_renderer.ts`, `src/pet/photo_renderer.test.ts`, `src/styles.css`, `src/settings.ts`, `src/settings.test.ts`, `settings.html`, `src/settings.css`, `src/i18n.ts`, `src/i18n.test.ts`; optionally create `src/pet/motion.ts` for pure selection rules.

**Interfaces:**
- Consumes: Task 1 `PetMotion` string union and `motions` map on active profiles.
- Produces: `motionForState(pet: Extract<ActivePet,{kind:"photo"}>, state: AgentVisualState): PetMotion | "gif"` in `src/pet/motion.ts`; an optional-slot fallback chooses the default asset **and** default motion.
- Produces: `SettingsController.save(name: string, scale: number, motions: Partial<Record<PetSlot, PetMotion>>): Promise<PetManifest>` and the matching `SettingsApi.save` invocation. UI keeps a `Map<PetSlot, PetMotion>` while editing; new file selection resets that slot to `follow_state`, mode/language changes preserve it, and removing an optional file removes its choice.

- [ ] **Step 1: Write failing Vitest cases** in the renderer and settings suites: static slot chooses sway/float; absent slot inherits default motion; GIF receives no CSS motion even if malformed payload contains an entry; a single-image profile has one selector; five slots keep independent choices across locale/mode switches; replacing a file resets only its slot; save sends only motions for selected static assets. Include a CSS-class check for all seven motion names.
- [ ] **Step 2: Run `pnpm test --run src/pet/photo_renderer.test.ts src/settings.test.ts src/i18n.test.ts`.** Expected: RED on missing motion selection/UI.
- [ ] **Step 3: Implement selector, renderer and CSS motion classes.** Place the selector under the active slot's image processing control. Disable it with bilingual GIF explanation for GIFs; disable it for empty optional slots. Keep `follow_state` as the legacy state animation, including completed one-shot behavior; explicit choices loop. Keep animation on an inner image layer so later pat response can animate an outer layer. Use `prefers-reduced-motion` to stop CSS motion on still images.
- [ ] **Step 4: Run `pnpm test --run` and `pnpm build`.** Expected: 0 failed tests and successful TypeScript/Vite build.
- [ ] **Step 5: Commit** as `feat: choose motion for each static pet image`.

### Task 3: Enlarge the entire pet window and simplify size controls

**Files:** Create `src/pet/window_size.ts`, `src/pet/window_sizer.ts` and tests; modify `src/main.ts`, `src/pet/photo_renderer.ts`, `src/styles.css`, `src/settings.ts`, `settings.html`, `src/settings.css`, `src/i18n.ts`, and related tests.

**Interfaces:**
- Consumes: Task 1 scale range and legacy offset payload; Task 2 active image/effect rendering.
- Produces: `petWindowSide(scale: number): number` = `max(128, ceil(128 * scale + 16))` for valid photo scales; built-in pets use 128. A `PetWindowSizer` serializes requests to Tauri `setSize`, preserves the old center, clamps physical position to `currentMonitor().workArea`, and applies only the latest requested pet when rapid changes occur.
- Produces: `validPetScale(scale: number): boolean`; preview and desktop use the same side calculation. Settings save receives scale and motion map only; new saves have no offset inputs.

- [ ] **Step 1: Write failing tests** for 0.5/0.8/3.0 window sizes (128/128/400), invalid sizes, centered and work-area-clamped placement, rapid resize selection ending at 128, failed resize retaining a fitted pet, and settings DOM without offset controls. Add a preview test showing full 400 px virtual window fitted within its panel and an actual-size label.
- [ ] **Step 2: Run `pnpm test --run src/pet/window_size.test.ts src/pet/window_sizer.test.ts src/settings.test.ts`.** Expected: RED on missing functions/layout.
- [ ] **Step 3: Implement the two size modules and integrate them.** Use `LogicalSize` for Tauri resize, convert using `scaleFactor()` for physical centering/clamping, and serialize `setSize`/`setPosition` operations. Center `#photo-frame` inside the variable-size pet window; keep legacy offsets for old profiles. If resize rejects, log it and fit the image into the current size. The preview uses a scaled wrapper rather than cropping. Remove both offset inputs and copy, set size `min=0.5 max=3 step=0.1`.
- [ ] **Step 4: Run `pnpm test --run`, `pnpm build`, and `cargo test --manifest-path src-tauri/Cargo.toml --lib`.** Expected: all pass.
- [ ] **Step 5: Commit** as `feat: grow pet window with size control`.

### Task 4: Replace punishment with a pat

**Files:** Create `src/pet/pat_interaction.ts` and `src/pet/pat_interaction.test.ts`; modify `src/main.ts`, `index.html`, `src/styles.css`, `src-tauri/src/lib.rs`, `src-tauri/src/ui_copy.rs`, `src-tauri/src/ui_copy.rs` tests and renderer tests.

**Interfaces:**
- Consumes: Task 2's separated image-motion layer and Task 3's variable-size window.
- Produces: `PatController` with `start(): void`, `cancel(): void`, `setAgentState(state: AgentVisualState): void`, and `dispose(): void`. It owns one hand overlay and one response animation, restarts on repeated trigger, and restores the latest agent state. `pet` is the internal Tauri event; the menu ID becomes `pet_action`; ⌘B still emits it.

- [ ] **Step 1: Write failing tests** for localized tray labels, a pat on both built-in/photo pets, two quick pats restarting only one overlay, state change during pat restoring the latest state, GIF source remaining unchanged, and no old punishment nodes in `index.html`.
- [ ] **Step 2: Run `pnpm test --run src/pet/pat_interaction.test.ts src/pet/photo_renderer.test.ts` and `cargo test --manifest-path src-tauri/Cargo.toml --lib ui_copy`.** Expected: RED on the missing controller/new labels.
- [ ] **Step 3: Implement one vector hand overlay and pat CSS.** Replace the old beat rotation/weapon markup and CSS. Route menu and shortcut to `pet`; cancel timers/animation on pet switch or disposal; preserve dragging. Keep hand placement toward upper center and use reduced motion presentation when requested.
- [ ] **Step 4: Run `pnpm test --run`, `pnpm build`, and `cargo test --manifest-path src-tauri/Cargo.toml --lib`.** Expected: all pass; no visible punishment copy or nodes remain.
- [ ] **Step 5: Commit** as `feat: pat desktop pets`.

### Task 5: Documentation and release candidate

**Files:** Modify `README.md`, `README_CN.md`, `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`; create `docs/releases/v1.3.0.md`.

**Interfaces:** Consumes Tasks 1–4 and produces a release-ready macOS Apple Silicon artifact; no product API.

- [ ] **Step 1: Update bilingual usage** with the pat action, per-static-image motion, GIF behavior, size 0.5–3.0, removal of offsets, old-pet compatibility, and a short user-run native visual checklist. Bump version to 1.3.0 in all four version sources and write the release note.
- [ ] **Step 2: Run `pnpm test --run && cargo test --manifest-path src-tauri/Cargo.toml && pnpm build && git diff --check`.** Expected: all pass.
- [ ] **Step 3: Build `pnpm tauri build --bundles dmg`, run `hdiutil verify` on the DMG, mount it read-only, check `codesign --verify --deep --strict` and CFBundle version 1.3.0, and generate a matching SHA256SUMS file.** Expected: all commands pass; no claim of Apple notarization.
- [ ] **Step 4: Commit** documentation and version files as `docs: prepare pet pat release`. Keep generated DMG outside Git; publish only after the whole-branch review and final verification, using the already-authorized `TJU-ICLearner/vibe-coding-light` fork.
