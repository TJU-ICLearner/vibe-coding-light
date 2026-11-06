# Windows and Linux Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce testable Windows and Linux builds with all core features except automatic background removal.

**Architecture:** Share portable pet and notification logic across platforms, isolate native credential and login behavior, and build on native CI runners. Preserve macOS behavior.

**Tech Stack:** Tauri 2, Rust, TypeScript/Vite, GitHub Actions, NSIS, AppImage.

**Spec:** `docs/superpowers/specs/2026-10-28-windows-linux-port-design.md`

## Global Constraints

- Automatic background removal remains macOS-only.
- Never store Bark keys in plaintext.
- Keep existing macOS data and behavior compatible.
- Windows requires Git for Windows for shell hooks.
- Unsigned cross-platform builds are test builds until real-device validation.

## Review Focus

- Missing Windows Git Bash must produce actionable hook-install feedback.
- Linux without Secret Service must refuse key persistence without plaintext fallback.
- PNG/GIF validation limits must remain enforced on all platforms.
- Platform tray and drag behavior must be verified on real devices.
- CI artifacts must be downloadable and installable, not merely compile.

---

### Task 1: Portable pet commands and settings

**Files:** `src-tauri/src/pet_commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/pet_image.rs`.

**Interfaces:** Keep existing Tauri command signatures. Expose transparent PNG/GIF support on all desktop OSes and only gate Vision mode.

- [ ] Add/adjust capability and image-mode tests; confirm the expected unsupported Vision mode on nonmacOS.
- [ ] Remove nonmacOS early returns from preview/save commands; expose settings windows in the tray.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml` and `pnpm test -- --run`.
- [ ] Commit.

### Task 2: Secure credentials and login startup

**Files:** `src-tauri/src/notifications/keychain.rs`, `src-tauri/src/notifications/service.rs`, `src-tauri/src/lib.rs`, platform login module(s), `src-tauri/Cargo.toml`.

**Interfaces:** `KeyStore::{save,has_key,read,delete}` remains unchanged; provide an OS-selected implementation. Startup status/toggle are available on all desktop OSes.

- [ ] Add tests for key validation and platform-independent startup path/entry generation.
- [ ] Implement native credential storage and login startup without plaintext key fallback.
- [ ] Run Rust tests and platform CI checks.
- [ ] Commit.

### Task 3: Hook and quota portability

**Files:** `src-tauri/src/lib.rs`, `src-tauri/src/notifications/{claude_quota,codex_quota}.rs`, hook scripts where required.

**Interfaces:** Existing JSON hook command schema and event spool format remain stable.

- [ ] Add tests for Windows command quoting and shell detection; verify missing prerequisite feedback.
- [ ] Adapt hook command and executable discovery for Windows/Linux.
- [ ] Run Rust and shell hook tests.
- [ ] Commit.

### Task 4: Native build pipelines and testing handoff

**Files:** `.github/workflows/cross-platform.yml`, build config, `README.md` and test notes.

**Interfaces:** CI artifacts include Windows `.exe` and Linux `.AppImage` with commit/version identifiers.

- [ ] Add native Windows/Linux build/test jobs with artifact upload.
- [ ] Push branch and run CI, fix all build failures.
- [ ] Provide install links and focused real-device test steps.
- [ ] Commit build fixes and publish a pre-release only after artifacts pass CI.
