# Persistent Tray Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let macOS users change tray settings and check updates repeatedly without reopening the status item.

**Architecture:** Keep the native menu on right click. Add a small Tauri Webview window for left click, backed by typed Rust state and a shared tray action dispatcher. Poll the state while visible for asynchronous update results, and hide on blur or Escape.

**Tech Stack:** Tauri 2, Rust, TypeScript/Vitest, existing Vite multi-page build.

**Spec:** `docs/superpowers/specs/2026-10-27-persistent-tray-popover-design.md`

## Global Constraints

- macOS left click uses popover; right click retains native menu; other systems retain native menu.
- Switches, language and update check keep the popover open. Navigation actions close it.
- No new dependency. Popover commands are restricted to the `tray_panel` Webview label.

## Review Focus

- Multi-monitor and display-edge positioning: popover should remain visible near the tray icon.
- Full-screen Spaces: popover should appear without disturbing desktop pet placement and dragging.
- Failed login-item or update setting: UI should show the error and not display a false checked state.
- Rapid repeated clicks/checks: only one panel and one update request, with correct refreshed state.
- Locale change while panel is open: every label should switch, including update status and session text.

---

### Task 1: Shared tray state and action commands

**Files:** `src-tauri/src/lib.rs`, optionally `src-tauri/src/tray_panel.rs`.

**Interfaces:** `get_tray_panel_state(window) -> TrayPanelState`, `perform_tray_panel_action(window, action) -> TrayPanelState`; share action behavior with native menu.

- [ ] Write Rust tests for action classification, state labels and window guard; confirm failure.
- [ ] Implement typed state, whitelist actions and shared handler; restrict commands to `tray_panel`.
- [ ] Run Rust targeted and full tests; commit.

### Task 2: Persistent macOS popover

**Files:** `tray.html`, `src/tray.ts`, `src/tray.css`, `src/tray.test.ts`, `vite.config.ts`, `src-tauri/capabilities/tray_panel.json`, `src-tauri/src/lib.rs`.

- [ ] Write failing Vitest for rendering, switches staying visible, update progress/result, language and Escape.
- [ ] Implement the Webview, left-click toggle, placement, blur close, right-click native fallback and keyboard behavior.
- [ ] Run frontend and Rust tests, build, inspect diff; commit.

### Task 3: RC5 package and publish

**Files:** version files and `docs/releases/v1.7.0-rc.5.md`.

- [ ] Run formatting, Rust tests, frontend tests/build and Hook tests.
- [ ] Build Apple Silicon DMG, verify mount, version, signature and SHA-256.
- [ ] Publish `v1.7.0-rc.5` prerelease and verify remote digest/download URL; give concise Mac test steps.
