# Adversarial Closure Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make settings outcomes truthful after partial failures and prevent obsolete update suggestions.

**Architecture:** Keep write outcome separate from follow-up read outcome in the existing controllers. Use independent reads for optional notification panels and filter old tags in the shared release selector/cache.

**Tech Stack:** TypeScript, Vitest, Tauri 2, Rust, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-16-adversarial-closure-round2-design.md`

## Global Constraints

- Keep Chinese and English UI copy aligned.
- Do not store Bark keys outside the credential store.
- Preserve `docs/previews/` and stable main/release 1.0.2.
- Use RC2 only for user device testing.

## Review Focus

- A successful pet save followed by a failed list read never enables duplicate save.
- A pet profile saved on disk but not selected is reported as saved and cannot be saved again from the same draft.
- A successful pet selection/deletion followed by failed active read never reports write failure.
- A failed pet write leaves the old selection intact.
- A failed diagnostic or status read does not block notification settings or template recovery.
- A cached removed test tag cannot surface as an update in an RC build.
- A later official release that reuses an old tag remains discoverable through the API and Atom feed.

---

### Task 1: Pet operations and recovery

**Files:** `src/settings.ts`, `src/settings.test.ts`, `src/i18n.ts`, `settings.html`, `src/settings.css`, `src-tauri/src/pet_store.rs`, `src-tauri/src/pet_commands.rs`

- [x] Write and run failing tests for save, select, delete, and partial startup refresh failures.
- [x] Separate successful writes from follow-up read failures; retain known local state and add localized retry control.
- [x] Return the saved manifest when a later selection write fails, and prevent a second save of that draft.
- [x] Run focused tests and full frontend suite.

### Task 2: Notification optional startup reads

**Files:** `src/notifications.ts`, `src/notifications.test.ts`, `src/notifications/i18n.ts`

- [x] Write and run failing tests for failed initial status and diagnostics reads, plus settings-read failure.
- [x] Render settings when optional reads fail, with per-section retry and truthful status.
- [x] Run focused tests and full frontend suite.

### Task 3: Obsolete update hints

**Files:** `src-tauri/src/app_updates.rs`

- [x] Write and run failing Rust tests for RC API/Atom selection and cached removed test tags.
- [x] Filter removed releases by publish date and invalidate old caches, while preserving current RC updates.
- [x] Run focused and full Rust tests.

### Task 4: RC2 delivery

**Files:** `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `docs/releases/v1.0.3-rc.2.md`

- [x] Align versions and document the changes.
- [x] Run production build, formatting, and diff checks; build and verify macOS DMG.
- [ ] Run Windows/Linux CI, verify artifacts and checksums, publish RC2 prerelease.
- [ ] Provide cross-platform real-device checklist and keep stable release untouched.
