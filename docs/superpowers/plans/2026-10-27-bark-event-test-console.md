# RC Bark Event Test Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a temporary RC-only button beside every Bark event so users can test notification rules, templates and delivery without waiting for real events.

**Architecture:** A typed Tauri command creates a synthetic `PushCandidate` for one selected source/event/period. It uses the existing notification filter, template renderer and Bark client, returns a typed sent/skipped result, and records a test-only diagnostic without touching the event spool, session state or quota ledger. The notifications page renders one button per event and shows a local result.

**Tech Stack:** Rust/Tauri 2, TypeScript/Vitest, existing notification modules and Bark client.

**Spec:** `docs/superpowers/specs/2026-10-27-bark-event-test-console-design.md`

## Global Constraints

- RC versions only; backend rejects the command outside versions containing `-rc.`. Remove this feature before the stable release.
- Source is Claude Code or Codex; quota period is 300 or 10080 minutes.
- Nine events: permission, question, completed, error, quota80, quota50, quota20, quota0, recovered.
- Current master/source/type switches and quiet hours determine sent versus skipped; never write to real event or quota ledgers.
- Test message is visibly marked `[测试]` or `[TEST]`; no real task text or Bark key reaches the UI.

## Review Focus

- Master, source or event switch off: a test returns the specific skip reason and sends nothing (Task 1 test).
- Quiet hours, including across midnight: a test returns `quiet_hours` and sends nothing (Task 1 test).
- Invalid source/event/period or stable build: command rejects it without contacting Bark (Task 1 test).
- Missing or rejected Bark key: failure is localized and the key is absent from the UI/diagnostics (Tasks 1–2 tests).
- Repeated simulated quota tests: each can send, while the quota ledger and actual session state remain unchanged (Task 1 test).

---

### Task 1: Typed simulation and delivery result

**Files:** Create `src-tauri/src/notifications/test_console.rs`; modify `src-tauri/src/notifications/mod.rs`, `src-tauri/src/notifications/service.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/ui_copy.rs`.

**Interfaces:** Produce `TestEvent` (the nine serde `snake_case` events), `TestRequest { source: AgentSource, event: TestEvent, duration_mins: Option<u64> }`, and `TestResult { outcome: "sent" | "skipped", reason: Option<DiagnosticReason> }`. Tauri command `send_simulated_notification(window, service, request) -> Result<TestResult, String>`. Add `testConsoleAvailable` to `NotificationStatus`, true only when `CARGO_PKG_VERSION` contains `-rc.`.

- [ ] Write `test_console::tests::maps_all_events_and_periods` asserting nine exact `PushKind` mappings, `300`/`10080` labels, and rejection of other durations; `simulated_payload_is_marked_and_contains_only_examples` asserting both language markers and no real detail; `simulated_decision_reports_disabled_and_quiet_hours` asserting `NotificationsDisabled`, `SourceDisabled`, `TypeDisabled` and `QuietHours`; and `rc_guard_rejects_stable_version`.
- [ ] Run `cargo test --offline --lib test_console::tests` and confirm the tests fail for missing behavior.
- [ ] Implement request validation and RC/window guards; create synthetic candidate with an independent ID and expiry; reuse production filtering, rendering and Bark transport with an outcome returned to the caller. Record diagnostics as `test_<event>` without raw details.
- [ ] Run targeted Rust tests until they pass, then `cargo test --offline --lib` (zero failures); verify the simulation path never calls `NotificationCore::on_quota` or the event spool.
- [ ] Commit the backend slice.

### Task 2: Per-event controls and bilingual feedback

**Files:** Modify `src/notifications.ts`, `src/notifications/i18n.ts`, `src/notifications.css`, `src/notifications.test.ts`.

**Interfaces:** Consume `send_simulated_notification({ request: { source, event, duration_mins } }) -> TestResult`; use RC availability from notification status to hide controls in stable builds.

- [ ] Write `notifications.test.ts` cases named `renders nine RC test buttons`, `sends selected source and period`, `shows skipped and Bark failure reasons`, `prevents duplicate clicks`, and `hides console in stable builds`; assert exact API request fields and local feedback in both languages.
- [ ] Run `npm test -- --run src/notifications.test.ts` and confirm failures reflect missing controls/behavior.
- [ ] Render the RC test area alongside existing switches; keep buttons clickable when a category is off so the page can explain the skip. Preserve source/period selection and local feedback across status refreshes.
- [ ] Run targeted Vitest, then `npm test -- --run` and `npm run build`.
- [ ] Commit the UI slice.

### Task 3: RC4 packaging and user handoff

**Files:** Update version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`; add `docs/releases/v1.7.0-rc.4.md`.

**Interfaces:** Release `v1.7.0-rc.4` to `TJU-ICLearner/vibe-coding-light` with Apple Silicon DMG and SHA-256 file.

- [ ] Verify `cargo fmt --check`, Rust tests, Vitest, frontend build, hook tests and `git diff --check`; inspect the complete diff.
- [ ] Build DMG, mount it, verify checksum/signature/version and compute SHA-256 using GitHub's final asset filename.
- [ ] Commit, tag, push and publish a prerelease with the DMG plus checksum file; verify remote digest and download URL.
- [ ] Give the user a compact test sequence for all event buttons and note that provider status remains a separate check for real quota reading.
