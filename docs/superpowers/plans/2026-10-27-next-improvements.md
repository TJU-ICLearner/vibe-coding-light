# Next Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver notification diagnostics, quiet hours, a session submenu, and opt-in startup/update conveniences in that order.

**Architecture:** Extend the existing Rust notification service and settings page for the first two tasks. Reuse hook session files for the tray submenu. Add platform-scoped startup handling and a release checker for the final task.

**Tech Stack:** Rust, Tauri 2, TypeScript, Vitest, macOS AppKit/ServiceManagement, GitHub Releases API.

**Spec:** `docs/superpowers/specs/2026-10-27-next-improvements-design.md`

## Global Constraints

- Existing users' pets, notification settings, and Bark key remain intact.
- Diagnostics never persist notification payload text or keys; cap records and write user-only files.
- All new UI copy is localized to Chinese and English.
- Startup and automatic update checks are opt-in; update prompt never silently installs.

## Review Focus

- A disabled or filtered notification should not appear as sent in diagnostics.
- A midnight-spanning quiet interval and daylight-saving changes should use local wall time at dispatch.
- A quiet-hour bypass applies to its selected event category only; a manual test still sends.
- A malformed or stale session file must not break the tray menu or expose raw text.
- A failed GitHub request must not affect the pet or notifications.

---

### Task 1: Notification diagnostics

**Files:** Create `src-tauri/src/notifications/diagnostics.rs`; modify `service.rs`, `mod.rs`, `src/notifications.ts`, `src/notifications/i18n.ts`, `src/notifications.css`; test in Rust and Vitest.

- [x] Write failing tests for bounded metadata-only history, result/reason classification, and clear.
- [x] Run targeted tests and confirm expected failures.
- [x] Add persistent diagnostics store and service commands; record observed events and send/skip outcomes.
- [x] Add localized diagnostic section with refresh and clear actions; verify escaping and no raw text.
- [x] Run targeted and full tests; commit.

### Task 2: Quiet hours

**Files:** Modify `model.rs`, `settings.rs`, `mod.rs`, `service.rs`, notification page/copy/styles; test in Rust and Vitest.

- [ ] Write failing tests for same-day/cross-midnight schedule, selected bypass categories, disabled schedule, and manual test.
- [ ] Run targeted tests and confirm expected failures.
- [ ] Add persisted interval and dispatch gate with local-time evaluation; log quiet skips.
- [ ] Add localized start/end and bypass controls with validation; verify settings migration.
- [ ] Run targeted and full tests; commit.

### Task 3: Session submenu

**Files:** Modify `src-tauri/src/lib.rs`, `src-tauri/src/ui_copy.rs`; add focused parser/menu-label tests.

- [ ] Write failing tests for source/project/state/recency, stale/malformed files, cap, and localization.
- [ ] Run targeted tests and confirm expected failures.
- [ ] Add menu-only session snapshots from existing hook files and refresh submenu when they change.
- [ ] Run Rust and hook tests; commit.

### Task 4: Startup and update notice

**Files:** Add scoped startup and release-check modules, app preferences/menu items, localized copy, docs, tests.

- [ ] Verify current official macOS/Tauri APIs and write failing tests for version comparison, response validation, opt-in settings, and failed checks.
- [ ] Implement launch-at-login toggle and manual/daily GitHub release notice without automatic installation.
- [ ] Wire localized tray feedback and official release link opening.
- [ ] Run all tests and a macOS DMG build; commit, publish a prerelease, and provide manual smoke-test steps.
