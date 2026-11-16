# Settings Interaction Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make notification and desktop-pet settings reliable under fast input, failures, and repeated actions.

**Architecture:** Keep state in the existing TypeScript controllers and DOM mounts. Serialize notification writes, track template and pet draft revisions, and render localized operation states without changing Tauri persistence APIs.

**Tech Stack:** TypeScript, Vitest, Tauri 2, Vite.

**Spec:** `docs/superpowers/specs/2026-11-16-settings-interaction-hardening-design.md`

## Global Constraints

- Keep Chinese and English copy synchronized.
- Preserve existing desktop-pet data and Bark credentials.
- Do not touch the pre-existing `docs/previews/` files.

## Review Focus

- Template input followed by immediate close or event switch must persist or explicitly indicate failure.
- A failed template write must not be reported as saved.
- A second pet Save without edits must not create another profile.
- A failed keychain write must retain the masked input for retry.
- Keyboard focus and concurrent Hook installation must behave predictably during refresh.

---

### Task 1: Notification template writes and feedback

**Files:** `src/notifications.ts`, `src/notifications/i18n.ts`, `src/notifications.test.ts`, `src/notifications.css`

- [x] Add failing tests for input-based persistence, event switch, failed write, and save status.
- [x] Run `npx vitest run src/notifications.test.ts` and observe expected failures.
- [x] Implement queued template persistence and localized status.
- [x] Run focused tests and confirm they pass.

### Task 2: Pet draft save guard

**Files:** `src/settings.ts`, `src/settings.test.ts`, `src/i18n.ts`, `settings.html`, `src/settings.css`

- [x] Add a failing mount test for repeated Save and resuming editing after a change.
- [x] Run focused test and observe expected failure.
- [x] Track saved draft identity and make the selected/draft transition explicit.
- [x] Run focused tests and confirm they pass.

### Task 3: Error and interaction recovery

**Files:** `src/notifications.ts`, `src/notifications/i18n.ts`, `src/notifications.test.ts`, `src/notifications.css`

- [x] Add failing tests for key retention, failed initial load with retry, keyboard focus, and duplicate Hook clicks.
- [x] Run focused tests and observe expected failures.
- [x] Implement the smallest recovery and in-flight states.
- [x] Run focused tests and confirm they pass.

### Task 4: Verification

- [x] Run the full TypeScript test suite and production build.
- [x] Run Rust tests if Rust code changes; otherwise verify the TypeScript/Tauri boundary remains unchanged.
- [x] Review the diff and report any remaining manual macOS/Windows/Linux checks.
