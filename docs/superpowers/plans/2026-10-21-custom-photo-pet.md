# Custom Photo Pet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let macOS users turn one local image into a transparent Code Light pet with state-aware lightweight motion.

**Architecture:** A settings window previews and saves photos through Rust commands. Rust validates and normalizes images, uses macOS Vision for background removal, and stores versioned local pet packages. The pet window selects either the existing cat spritesheets or a photo renderer while consuming the existing agent state events.

**Tech Stack:** Tauri 2, Rust `image`, macOS Vision through a small Objective-C bridge, TypeScript/Vite/CSS, Vitest with jsdom.

**Spec:** `docs/superpowers/specs/2026-10-21-custom-photo-pet-design.md`

## Global Constraints

- Automatic background removal requires macOS 14+; macOS 12–13 accepts transparent PNG, and Windows/Linux retain their current features without photo import.
- The app remains installable on macOS 12+; platform-specific native code is conditionally compiled and runtime-gated.
- Input: PNG/JPEG, at most 10 MiB and 4096 pixels on either side. Output: transparent 256×256 PNG displayed in the 128×128 pet window.
- Photos stay local. Save only the processed image, versioned manifest, and current selection. Never save the original photo or make a network request.
- Keep the current agent state pipeline, built-in cat spritesheets, tray status, drag, and show/hide behavior.
- Preview does not change the current pet; failed processing or persistence leaves the last valid pet active.

## Review Focus

1. A JPEG with EXIF rotation must appear upright after processing — Task 1 test.
2. A small compressed file declaring enormous dimensions must fail before full decode or allocation — Task 1 test.
3. A fully transparent PNG must be rejected instead of saving an invisible pet — Task 1 test.
4. When image B is chosen while A is still processing, A's late result must not replace B's preview — Task 4 test.
5. A saved selection pointing to a missing or corrupt pet must restore the built-in cat without deleting files — Task 3 test.

## File Map

- `src-tauri/src/pet_image.rs`: input checks, EXIF orientation, transparent-image validation, 256×256 normalization.
- `src-tauri/src/pet_vision.rs` and `src-tauri/native/pet_vision.m`: macOS Vision bridge; platform and OS-version gating.
- `src-tauri/src/pet_store.rs`: versioned manifest, safe app-data paths, atomic save, selection, list, delete, fallback.
- `src-tauri/src/pet_commands.rs`: Tauri command shapes and events; thin orchestration of image processing and storage.
- `src-tauri/src/lib.rs`, `src-tauri/build.rs`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/`: registration, native build, settings window and permissions.
- `settings.html`, `src/settings.ts`, `src/settings.css`, `vite.config.ts`: dedicated import/preview/settings UI.
- `src/pet/types.ts`, `src/pet/photo_renderer.ts`, `src/pet/photo_renderer.test.ts`, `src/main.ts`, `src/styles.css`, `index.html`: shared frontend payload types, live photo rendering and state/interaction handling.
- `package.json`, `pnpm-lock.yaml`, `README.md`, `README_CN.md`: test tooling and user-facing platform instructions.

---

### Task 1: Validate and Normalize User Images

**Files:** Create `src-tauri/src/pet_image.rs`; modify `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`.

**Interfaces:** Produce `enum PetImageMode { RemoveBackground, KeepAlpha }`, `fn decode_oriented(input: &[u8]) -> Result<DynamicImage, PetImageError>`, and `fn prepare_pet_image(input: &[u8], mode: PetImageMode) -> Result<Vec<u8>, PetImageError>`. The result is a 256×256 RGBA PNG; `RemoveBackground` delegates to Task 2's `remove_background` on macOS. Expose `fn validate_processed_png(input: &[u8]) -> Result<(), PetImageError>` for Task 3.

- [ ] **Step 1: Write failing Rust tests** in `pet_image.rs`: PNG with a visible subject and transparent border produces a 256×256 image; fully transparent PNG fails; a >10 MiB input fails; a compact PNG declaring width >4096 fails before full decode; `decode_oriented` returns an upright image for an EXIF-rotated JPEG. Use small in-memory fixtures plus a checked-in tiny orientation fixture only if constructing EXIF bytes is unwieldy.
- [ ] **Step 2: Run `cargo test pet_image -- --nocapture`** from `src-tauri`; expect the new tests to fail before the implementation.
- [ ] **Step 3: Implement the three public functions** and private dimension/alpha/crop helpers. Enable JPEG decoding and add an EXIF reader; inspect dimensions and apply decode limits before allocation. For `KeepAlpha`, require a PNG with both nonzero visible alpha and transparent pixels; crop visible bounds and contain the result on the transparent canvas. Keep `RemoveBackground` as an explicitly unsupported stub until Task 2 adds Vision, so this task compiles independently.
- [ ] **Step 4: Run `cargo test pet_image -- --nocapture`**; expect all Task 1 tests to pass. Run `cargo check` to confirm the module integrates.
- [ ] **Step 5: Commit** image validation and normalization as `feat: validate and normalize photo pets`.

### Task 2: Add macOS Local Background Removal

**Files:** Create `src-tauri/src/pet_vision.rs`, `src-tauri/native/pet_vision.m`; modify `src-tauri/build.rs`, `src-tauri/Cargo.toml`, `src-tauri/src/pet_image.rs`.

**Interfaces:** Produce `#[cfg(target_os = "macos")] fn remove_background(input: &[u8]) -> Result<Vec<u8>, PetImageError>`. The Objective-C C ABI accepts temporary input/output paths and returns explicit `unsupported_os`, `no_subject`, or `processing_failed` codes. Task 1 then normalizes the returned transparent image.

- [ ] **Step 1: Write failing macOS tests**: `RemoveBackground` reports `unsupported_os` when the runtime is older than macOS 14 (version predicate factored for unit testing); a PNG of only transparent pixels is rejected; a fixture with a foreground object yields an output PNG with transparent corner pixels and nontransparent subject pixels on macOS 14+.
- [ ] **Step 2: Run `cargo test pet_vision -- --nocapture`**; expect the new tests to fail before the bridge exists.
- [ ] **Step 3: Implement the bridge** with `VNGenerateForegroundInstanceMaskRequest`, select the largest observed instance, composite its mask to alpha, and encode PNG. Compile `.m` only for macOS with `cc`; link Foundation, Vision, CoreImage, and AppKit. Guard the API at runtime so macOS 12–13 can still launch Code Light. Use temporary files cleaned on success and failure.
- [ ] **Step 4: Run `cargo test pet_vision -- --nocapture` and `cargo check`** on macOS; expect pass. If a non-macOS Rust target is installed, run `cargo check --target` with that target; otherwise inspect the `cfg` boundary and leave cross-platform packaging to CI.
- [ ] **Step 5: Commit** as `feat: remove pet image backgrounds with macOS Vision`.

### Task 3: Store and Select Pet Packages

**Files:** Create `src-tauri/src/pet_store.rs`, `src-tauri/src/pet_commands.rs`; modify `src-tauri/src/lib.rs`, `src-tauri/src/tauri.conf.json`, `src-tauri/capabilities/default.json`.

**Interfaces:** `PetManifest { schema_version: 1, id: String, name: String, scale: f32, offset_x: i16, offset_y: i16, created_at: i64 }`; `ActivePet` is `Builtin` or `Photo { manifest, png }`; `PetStore::new(root: PathBuf) -> Self`, `save(&self, name: &str, png: &[u8], scale: f32, offset_x: i16, offset_y: i16) -> Result<PetManifest, PetStoreError>`, `list(&self) -> Result<Vec<PetManifest>, PetStoreError>`, `select(&self, id: &str) -> Result<(), PetStoreError>`, `delete(&self, id: &str) -> Result<(), PetStoreError>`, `active(&self) -> ActivePet`. Reserve `builtin-cat`. Tauri commands: `prepare_pet_preview(input: Vec<u8>, mode: PetImageMode) -> Result<String, String>` returns a PNG data URL; `save_photo_pet(name: String, png_data_url: String, scale: f32, offset_x: i16, offset_y: i16) -> Result<PetManifest, String>`; `list_photo_pets() -> Result<Vec<PetManifest>, String>`; `select_pet(id: String) -> Result<(), String>`; `delete_photo_pet(id: String) -> Result<(), String>`; `get_active_pet() -> ActivePetPayload`. The payload is `{ kind: "builtin" }` or `{ kind: "photo", id, image_data_url, scale, offset_x, offset_y }`. Changes emit `pet-changed` after persistence succeeds.

- [ ] **Step 1: Write failing `pet_store` tests** for save/restart selection, Unicode display name with ID-based path, invalid PNG leaving no committed pet directory, deletion of active versus inactive pets, traversal-like ID rejection, and missing/corrupt manifest or image fallback to `builtin-cat` without file deletion.
- [ ] **Step 2: Run `cargo test pet_store -- --nocapture`**; expect failure before the store exists.
- [ ] **Step 3: Implement the store and thin commands.** Validate a processed PNG again at save, constrain scale/offset to the visible 128×128 window, derive all paths from generated IDs, use app data rather than the source tree, and return normalized errors to the UI. Give commands only the filesystem access they need; do not add broad frontend filesystem permissions.
- [ ] **Step 4: Run `cargo test pet_store -- --nocapture` and `cargo test`**; expect pass. Verify app restart selection against a temporary store in tests.
- [ ] **Step 5: Commit** as `feat: persist selectable photo pet packages`.

### Task 4: Build the macOS Import and Preview Window

**Files:** Create `settings.html`, `src/settings.ts`, `src/settings.css`, `src/settings.test.ts`, `src/pet/types.ts`; modify `vite.config.ts`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/`, `package.json`, `pnpm-lock.yaml`.

**Interfaces:** Use Task 3 command names and result shapes. Define `type AgentVisualState = "idle" | "unknown" | "working" | "waiting" | "error" | "completed"` and the matching `ActivePet` union in `src/pet/types.ts` for Task 5. Add tray menu item `Customize Pet`; create/reuse a settings WebView window. Expose `class PreviewController` with `load(file: File, mode: "remove_background" | "keep_alpha"): Promise<void>`; its `requestId` ensures only the latest file selection updates the preview.

- [ ] **Step 1: Add failing Vitest/jsdom tests**: file A's late response cannot replace B's preview; failed preview leaves the active pet untouched; saving only occurs on explicit click; transparent PNG is offered on macOS 12–13 while automatic removal is unavailable; list/select/delete updates visible selection only after command success.
- [ ] **Step 2: Run `pnpm test --run src/settings.test.ts`**; expect failure before the window/controller exists.
- [ ] **Step 3: Implement the settings entry and UI.** Add original and checkerboard transparent previews, name/scale/offset controls, five state preview buttons, progress/errors, pet list, default-cat restoration, and deletion. Add Vite's second HTML entry, Tauri window creation/reuse, and a settings-only capability. Keep window close from quitting the pet.
- [ ] **Step 4: Run `pnpm test --run src/settings.test.ts` and `pnpm build`**; expect pass. Manually open/close/reopen the settings window in `pnpm tauri dev`.
- [ ] **Step 5: Commit** as `feat: add photo pet import and preview window`.

### Task 5: Render Photo Pets for Agent States

**Files:** Create `src/pet/photo_renderer.ts`, `src/pet/photo_renderer.test.ts`; modify `src/main.ts`, `src/styles.css`, `index.html`.

**Interfaces:** `PhotoRenderer.applyPet(activePet: ActivePet): void` switches builtin/photo without changing agent state; `PhotoRenderer.applyState(state: AgentVisualState): void` maps `unknown` to idle; `PhotoRenderer.react(): boolean` returns `true` when it plays a generic photo wobble, otherwise `false` so the existing cat interaction runs. The renderer listens for Task 3's `pet-changed` event and refreshes through `get_active_pet`.

- [ ] **Step 1: Add failing Vitest/jsdom tests** for state-to-motion class mapping, `unknown` idle motion, completing a one-shot jump, switching pet while working, switching to built-in cat, and photo reaction suppressing the fixed-position overlays.
- [ ] **Step 2: Run `pnpm test --run src/pet/photo_renderer.test.ts`**; expect failure before implementation.
- [ ] **Step 3: Implement the renderer and CSS motions** without changing status calculation. Fit photo inside 128×128, apply saved scale/offset, cancel old motion on switch, and preserve drag and tray controls. Keep the cat's existing sprite and beat paths behind the built-in mode.
- [ ] **Step 4: Run `pnpm test --run src/pet/photo_renderer.test.ts` and `pnpm build`**; expect pass. Manually simulate all agent states and the interaction shortcut for both pet types.
- [ ] **Step 5: Commit** as `feat: animate custom photo pets from agent state`.

### Task 6: Verify the Full macOS Experience and Document It

**Files:** Modify `README.md`, `README_CN.md` and any files requiring fixes found by verification.

**Interfaces:** No new runtime API. Documents must state macOS 14+ automatic removal, macOS 12–13 transparent PNG import, local-only processing, and the tray entry.

- [ ] **Step 1: Write the user instructions** in both READMEs and a short manual QA checklist in the PR/commit notes: opaque JPEG/PNG, transparent PNG, multi-subject photo, corrupt and oversized input, restart persistence, default fallback, every status, custom reaction, and settings reopen.
- [ ] **Step 2: Run `cargo test`, `cargo clippy --all-targets -- -D warnings -A unexpected_cfgs`, `pnpm test --run`, and `pnpm build`**; expect pass. Fix only concrete failures and rerun the failed checks.
- [ ] **Step 3: Run `pnpm tauri dev` for manual macOS QA**, capture the observed result of each checklist case, and verify no photo leaves the local machine. For macOS 12–13 behavior, exercise the factored version predicate in tests or use an older macOS runner if available.
- [ ] **Step 4: Build the macOS app with `pnpm tauri build`**, check the app bundle includes the second HTML entry, launch the packaged app, and repeat import/restart/fallback smoke checks to verify the native Vision bridge works outside dev mode.
- [ ] **Step 5: Commit** documentation and verification fixes as `docs: explain custom photo pets and macOS support`.
