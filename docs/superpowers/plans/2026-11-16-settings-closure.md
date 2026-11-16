# Settings and Release Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make settings safe through process exit and destructive actions, then deliver testable cross-platform installers.

**Architecture:** Extend existing TypeScript controllers with a local pending-template journal and explicit operation feedback. Keep the pet deletion confirmation in the existing DOM mount. Use the current Tauri release and CI workflow.

**Tech Stack:** TypeScript, Vitest, Tauri 2, Rust, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-16-settings-closure-design.md`

## Global Constraints

- Keep Chinese and English wording synchronized.
- Store no Bark key in the draft journal.
- Preserve pre-existing `docs/previews/` files.
- Treat the installer as a prerelease until the user reports real-device results.

## Review Focus

- A template edit and a reset action survive a simulated immediate process exit.
- A failed settings write leaves the journal entry available for retry.
- A successful Hook install or key deletion remains successful when status refresh fails.
- A double click on Delete cannot erase a pet.
- All three installer artifacts originate from the same commit and version.

---

### Task 1: Template draft recovery

**Files:** `src/notifications.ts`, `src/notifications.test.ts`

- [x] Write failing restart/recovery tests and verify RED.
- [x] Persist pending template edits/reset intent synchronously and replay on init.
- [x] Verify focused tests GREEN.

### Task 2: Truthful operation feedback

**Files:** `src/notifications.ts`, `src/notifications/i18n.ts`, `src/notifications.test.ts`

- [x] Write failing refresh-failure tests and verify RED.
- [x] Separate operation and refresh outcomes; catch diagnostic refresh failures.
- [x] Verify focused tests GREEN.

### Task 3: Safe pet deletion

**Files:** `src/settings.ts`, `src/settings.css`, `src/i18n.ts`, `src/settings.test.ts`

- [x] Write failing named-confirmation and double-click tests and verify RED.
- [x] Implement localized inline confirmation and pending guard.
- [x] Verify focused tests GREEN.

### Task 4: Release candidate

**Files:** `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, release notes

- [x] Run full TypeScript and Rust tests, production build, and formatting checks.
- [x] Bump all app versions together, build the macOS DMG, and run cross-platform CI.
- [x] Publish a prerelease with matching Mac, Windows, Linux installers and checksums.
- [x] Provide a short manual test checklist and wait for user results before a stable release.
