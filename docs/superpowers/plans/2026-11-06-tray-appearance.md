# Tray Appearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the macOS tray entry and add six persistent, app-wide UI themes with automatic system appearance.

**Architecture:** Rust stores the appearance preference and shares it with every WebView through commands and an event. A shared frontend module resolves system light/dark with `matchMedia` and applies one theme attribute to each document; CSS uses semantic tokens. The macOS tray panel is reorganized into three views, while Windows/Linux keep the native menu and receive an appearance submenu.

**Tech Stack:** Tauri 2/Rust, TypeScript, CSS, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-06-tray-appearance-design.md`

## Global Constraints

- Manual names: 系统浅色 / 系统深色 / 社戏 / 晨雾 / 知秋 / 芭蕉; full English labels required.
- System dark uses 夜雨 colors; “夜雨” is not a separate manual option.
- Preserve transparent pet imagery and existing Windows/Linux tray behavior.
- Reference palette author zhoulaiqing, MIT license; store attribution in source/docs.

## Review Focus

- Old users with no appearance file start in follow-system mode.
- Corrupt appearance file falls back safely and failed writes do not change current state.
- System appearance changes while the app is running update every open UI window.
- The macOS right click never shows the old duplicate menu.
- Hook and Bark statuses come from current service state, including unavailable and unconfigured cases.

---

### Task 1: Persistent appearance state

**Files:** Create `src-tauri/src/appearance.rs`; modify `src-tauri/src/lib.rs`; test in `appearance.rs`.

- [x] Write failing Rust tests for default, round-trip, corrupt data and failed write.
- [x] Run focused tests and confirm failure.
- [x] Add `AppearanceStore`, `ThemeId`, get/set Tauri commands and `appearance-changed` emission.
- [x] Re-run focused tests.

### Task 2: Shared palette and window synchronization

**Files:** Create `src/appearance.ts`, `src/appearance.css`, `src/appearance.test.ts`; modify `src/tray.ts`, `src/settings.ts`, `src/notifications.ts`, `src/tray.css`, `src/settings.css`, `src/notifications.css`.

- [x] Write failing tests for theme resolution and labels, including system dark = 夜雨.
- [x] Run focused tests and confirm failure.
- [x] Implement theme synchronization and semantic CSS tokens across all three interface windows.
- [x] Verify theme resolution, manual change and both languages through tests.

### Task 3: One macOS popover and three-view control UI

**Files:** Modify `src-tauri/src/lib.rs`, `src-tauri/src/tray_panel.rs`, `src/tray.ts`, `src/tray.css`, `src/tray.test.ts`.

- [x] Write tests for tab navigation, no duplicated current session, Hook and Bark status, theme selection and retained controls.
- [x] Run focused tests and confirm failure.
- [x] Implement tray panel state, three views and shared left/right click handling.
- [x] Keep Windows/Linux native menu, add appearance selection, then re-run tests.

### Task 4: Verification and RC build

**Files:** Update README CN/EN, release notes and version files if publishing an RC.

- [x] Run `pnpm test -- --run`, `pnpm build`, Rust tests, `cargo fmt --check`, `git diff --check`.
- [x] Inspect screenshots of the built UI through a local headless renderer; correct clipping and contrast.
- [x] Build cross-platform CI artifacts, then publish a test RC after required checks pass. macOS, Windows and Linux assets and SHA256SUMS are on v1.1.0-rc.5.
