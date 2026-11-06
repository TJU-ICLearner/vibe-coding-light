# Watch Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in, individually selectable Bark notifications for Claude Code and Codex events and each available quota window on macOS.

**Architecture:** Hooks write immutable local events; separate adapters read Claude status-line and Codex App Server quota snapshots. A Rust notification engine applies settings, delay, thresholds, expiry and deduplication before a Bark client sends a short localized message. A dedicated Tauri settings window edits preferences and shows connection status; the Bark key stays in macOS Keychain.

**Tech Stack:** Tauri 2, Rust, Bash hooks, TypeScript/Vite/Vitest, `reqwest` 0.13.4, macOS `security-framework` 3.7.0.

**Spec:** `docs/superpowers/specs/2026-10-23-watch-notifications-design.md`

## Global Constraints

- macOS and Bark only; Vibe Coding Light must be running for automatic pushes. No independent daemon.
- Master switch defaults off; Claude/Codex source and four event switches default on; 80/50/20/0 and recovery switches default off.
- Event copy means “turn finished,” never verified project completion. No prompts, project paths, commands, raw errors or credentials in push payloads/logs.
- Completion settles for 3 seconds; repeated errors in one session have a 30-second cooldown. Pending action events expire after 2 minutes; completion/error events after 10 minutes.
- Every quota bucket/window is evaluated separately. First observation is baseline; crossing multiple enabled thresholds emits only the lowest one. Re-arm only after confirmed reset and recovery.
- Codex quota target interval is 5 minutes while enabled. Claude quota uses official status-line `rate_limits` values; unsupported/missing data stays unavailable.
- Notifications window and payloads follow the app's current Chinese/English language. No Computer Use; user performs macOS/iPhone/Watch checks.
- Keep Windows/Linux builds compiling and their existing pet/status behavior intact; watch notifications report unsupported there.

## File Map

| File | Responsibility |
| --- | --- |
| `src-tauri/src/notifications/model.rs`, `settings.rs` | Typed switches, event/quota/push values; atomic local preferences |
| `src-tauri/src/notifications/events.rs` | Validate and drain immutable hook event files; startup baseline and expiry |
| `src-tauri/src/notifications/engine.rs` | Per-turn event decisions, quota threshold state, deduplication ledger |
| `src-tauri/src/notifications/claude_quota.rs` | Preserve/restore Claude status line; parse sanitized snapshots and run CLI proxy |
| `src-tauri/src/notifications/codex_quota.rs` | Query Codex App Server and normalize available buckets/windows |
| `src-tauri/src/notifications/keychain.rs`, `bark.rs` | macOS credential operations and HTTPS JSON push |
| `src-tauri/src/notifications/mod.rs` | Background coordinator and Tauri command interface |
| `src-tauri/src/lib.rs`, `main.rs`, `ui_copy.rs` | Register worker/commands/window/menu and early status-line proxy entry point |
| `hooks/claude/*`, `hooks/codex/*` | Emit event files without blocking agent work or network access |
| `notifications.html`, `src/notifications.ts`, `src/notifications.css`, `src/notifications/i18n.ts` | Bilingual notification settings UI |
| `vite.config.ts`, `src-tauri/capabilities/notifications.json`, `src-tauri/Cargo.toml` | Bundle UI, command capability and dependencies |
| `docs/superpowers/qa/2026-10-23-watch-notifications.md` | User-run macOS/iPhone/Watch checks |

## Review Focus

1. A malformed, oversized or stale hook file must not block valid events or leak its contents: Task 2 tests this.
2. A user customizes Claude's status line before or after installation: Task 4 tests exact output preservation and safe restore behavior.
3. Codex returns two buckets with the same window duration or no authenticated quota: Task 5 tests distinct labels and unavailable results.
4. Bark times out after accepting a request: Task 6 tests no automatic retry for ambiguous delivery.
5. Notifications are disabled while a completion is settling or a quota check is in flight: Task 7 tests rechecking switches immediately before send.

---

### Task 1: Notification Model and Preferences

**Files:** Create `src-tauri/src/notifications/model.rs`, `settings.rs`; modify `src-tauri/src/notifications/mod.rs`, `src-tauri/src/lib.rs` only to register modules; test within the new Rust modules.

**Interfaces:** `NotificationSettings { enabled: bool, sources: SourceSwitches { claude, codex }, events: EventSwitches { permission, question, completed, error }, quota: QuotaSwitches { at80, at50, at20, at0, recovered } }` with `Default`; `NotificationSettingsStore::load(path: PathBuf) -> Self`, `get(&self) -> NotificationSettings`, `set(&mut self, value: NotificationSettings) -> Result<(), String>`. Define `AgentSource`, `AgentEventKind`, `AgentEvent`, `QuotaWindow`, `PushCandidate` here for later tasks. `AgentEvent` carries `id`, `source`, `session_id`, optional `turn_id`, `kind`, `at_ms`; `QuotaWindow` carries source, bucket ID/label, duration, used percent, reset epoch and explicit `reached` flag.

- [ ] **Step 1: Write failing tests** in `settings.rs`: `defaults_are_opt_in` asserts master false, both sources and four event switches true, all quota switches false; `round_trip_preserves_switches` asserts persistence; `failed_write_keeps_previous_settings` asserts atomic failure behavior; `unknown_fields_do_not_crash_load` asserts forward-compatible parsing.
- [ ] **Step 2: Run red tests:** `cd src-tauri && cargo test notifications::settings::tests --lib`; expect missing type/module failures.
- [ ] **Step 3: Implement typed model and atomic JSON store** using `tempfile`, following `ui_locale.rs`. Reject out-of-range or invalid persisted values by returning safe defaults rather than enabling pushes.
- [ ] **Step 4: Run green tests:** same command; expect all Task 1 tests pass.
- [ ] **Step 5: Commit:** `git add src-tauri/src/notifications src-tauri/src/lib.rs && git commit -m "feat: add notification settings model"`.

### Task 2: Per-Event Hook Spool

**Files:** Create `src-tauri/src/notifications/events.rs`, `tests/hooks_notifications.test.ts`; modify `hooks/claude/_helpers.sh`, `notification.sh`, `post-tool-use-failure.sh`, `stop.sh`, `pre-tool-use.sh`, `hooks/codex/_helpers.sh`, `permission_request.sh`, `post_tool_use.sh`, `stop.sh`, `pre_tool_use.sh`; register `events.rs` in `mod.rs`.

**Interfaces:** `EventSpool::new(path: PathBuf)`, `baseline(&mut self) -> Result<(), String>`, `drain(&mut self, now_ms: u64) -> Vec<AgentEvent>`. Hook helper `write_notification_event input kind [turn_id]` extracts the session ID from Hook JSON with the existing environment fallback and emits one validated JSON file under `~/.code-light/events/` with UUID filename and no prompt/tool content. `working` is an internal event emitted only on a session state transition, to cancel a pending completion without recording every tool call. Normal state-file writes remain unchanged. Codex `PostToolUse` emits `error` only for an explicit nonzero exit/result or `isError: true` response; question events are emitted only when an explicit supported input event is observable.

- [ ] **Step 1: Write failing tests:** Bash fixture tests in `tests/hooks_notifications.test.ts` assert Claude permission/elicitation, Stop and failure files; Codex approval, Stop and explicit failure files; ordinary success does not emit error; repeated tools in one working state emit only one internal `working` event. Rust tests in `events.rs` assert two rapid events in one session survive, malformed/oversized/stale files are skipped, and baseline ignores old files while accepting new files.
- [ ] **Step 2: Run red tests:** `pnpm vitest run tests/hooks_notifications.test.ts` and `cd src-tauri && cargo test notifications::events::tests --lib`; expect missing spool/event behavior.
- [ ] **Step 3: Implement atomic immutable event files** with bounded size/age and strict field validation. Hook failures must exit successfully without delaying Claude/Codex; retain existing state-file writes. Avoid naive text matching for Codex question detection.
- [ ] **Step 4: Run green tests:** repeat both commands; expect all Task 2 cases pass.
- [ ] **Step 5: Commit:** `git add hooks tests/hooks_notifications.test.ts src-tauri/src/notifications && git commit -m "feat: record per-session agent notification events"`.

### Task 3: Notification Decision Engine

**Files:** Create `src-tauri/src/notifications/engine.rs`; modify `model.rs`, `mod.rs`; tests in `engine.rs`.

**Interfaces:** `NotificationEngine::load(ledger_path: PathBuf) -> Self`, `on_event(&mut self, event: AgentEvent, now_ms: u64, settings: &NotificationSettings) -> Vec<PushCandidate>`, `on_quota(&mut self, window: QuotaWindow, now_ms: u64, settings: &NotificationSettings) -> Vec<PushCandidate>`, `flush_due(&mut self, now_ms: u64, settings: &NotificationSettings) -> Vec<PushCandidate>`. Persist quota alert ledger and event dedupe keys atomically; delivery transport remains outside this module.

- [ ] **Step 1: Write failing tests:** `turn_completion_canceled_by_following_work`, `one_error_per_session_per_30_seconds`, `interleaved_sessions_do_not_mask_completion`, `first_quota_snapshot_is_baseline`, `jump_from_85_to_45_sends_only_50`, `explicit_reached_triggers_zero`, `each_bucket_and_window_is_independent`, `reset_rearms_once_and_optional_recovery_fires_once`, `ledger_survives_restart`, and `disabled_source_or_category_yields_no_candidate`; assert candidate category, label, threshold and due time.
- [ ] **Step 2: Run red tests:** `cd src-tauri && cargo test notifications::engine::tests --lib`; expect missing engine behavior.
- [ ] **Step 3: Implement pure state transitions** with the spec's 3-second completion delay, 30-second error cooldown, expiry, per-window threshold tracking and reset rule. Formatting is a separate localized function of a candidate, not raw hook text.
- [ ] **Step 4: Run green tests:** same command; expect all Task 3 cases pass.
- [ ] **Step 5: Commit:** `git add src-tauri/src/notifications && git commit -m "feat: decide and deduplicate watch notifications"`.

### Task 4: Claude Quota and Status-Line Preservation

**Files:** Create `src-tauri/src/notifications/claude_quota.rs`; modify `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/notifications/mod.rs`; tests in `claude_quota.rs`.

**Interfaces:** `ClaudeQuota::install(settings_path: &Path, executable: &Path, data_dir: &Path) -> Result<(), String>`, `remove(...) -> Result<(), String>`, `read_snapshot(path: &Path) -> Result<Vec<QuotaWindow>, String>`. `run_statusline_proxy(stdin: impl Read, stdout: impl Write, config: &ProxyConfig) -> Result<(), String>` parses only `rate_limits.five_hour` and `seven_day`, atomically writes the sanitized snapshot, then invokes and faithfully forwards the previous status-line command. `main.rs` handles `--statusline-proxy` before Tauri initialization.

- [ ] **Step 1: Write failing tests:** absent `rate_limits` returns unavailable; 5-hour/7-day values normalize independently; existing inline or script status-line output is byte-for-byte preserved; enabling twice is idempotent; disable restores only if own wrapper is still configured; later user edits survive; malformed settings and managed configuration do not get overwritten.
- [ ] **Step 2: Run red tests:** `cd src-tauri && cargo test notifications::claude_quota::tests --lib`; expect missing adapter behavior.
- [ ] **Step 3: Implement proxy and config ownership checks** via existing atomic hook-config helpers or a focused extraction. Store only percentage/reset fields under app data; never store or log complete status-line JSON. If safe wrapping is impossible, surface unavailable while leaving event notifications usable.
- [ ] **Step 4: Run green tests:** same command; expect all Task 4 cases pass.
- [ ] **Step 5: Commit:** `git add src-tauri/src/main.rs src-tauri/src/lib.rs src-tauri/src/notifications && git commit -m "feat: read Claude quota without replacing status line"`.

### Task 5: Codex App Server Quota Adapter

**Files:** Create `src-tauri/src/notifications/codex_quota.rs`; register it in `mod.rs`; tests in `codex_quota.rs`.

**Interfaces:** `parse_rate_limits(value: &serde_json::Value) -> Result<Vec<QuotaWindow>, String>` prefers `rateLimitsByLimitId` and falls back to `rateLimits`. `CodexQuota::read(timeout: Duration) -> Result<Vec<QuotaWindow>, String>` starts the installed `codex app-server` with piped stdio, performs its documented initialize exchange and `account/rateLimits/read`, then terminates/reaps the child. The coordinator invokes it at most every 5 minutes while relevant switches are enabled.

- [ ] **Step 1: Write failing tests:** multi-bucket primary/secondary fixtures produce distinct labels and windows; single-bucket fallback works; missing percentage, API-key-only/unauthed reply, malformed JSON and absent binary yield unavailable; fake app-server process proves request/response framing and timeout cleanup.
- [ ] **Step 2: Run red tests:** `cd src-tauri && cargo test notifications::codex_quota::tests --lib`; expect missing adapter behavior.
- [ ] **Step 3: Implement bounded subprocess exchange** without reading auth files or calling private HTTP endpoints. Validate 0–100 percentage, positive duration and reset epoch before normalizing.
- [ ] **Step 4: Run green tests:** same command; expect all Task 5 cases pass.
- [ ] **Step 5: Commit:** `git add src-tauri/src/notifications && git commit -m "feat: read Codex quota windows"`.

### Task 6: Bark Transport and Keychain

**Files:** Create `src-tauri/src/notifications/bark.rs`, `keychain.rs`; modify `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `mod.rs`; tests in both new modules.

**Interfaces:** `KeyStore` trait with `save(&self, key: &str)`, `has_key(&self)`, `read(&self)`, `delete(&self)`; macOS implementation uses Keychain service `com.cuihuapeng.code-light.bark` and account `device-key`. `BarkClient::send(&self, key: &str, payload: &PushPayload) -> Result<(), BarkError>` sends HTTPS JSON to `https://api.day.app/push` with `device_key` in the body. `BarkError` distinguishes definitely unsent connection failure from ambiguous timeout/result.

- [ ] **Step 1: Write failing tests:** mock KeyStore never exposes key in settings JSON; empty key and Keychain save failure leave the old credential/config intact; injected local transport verifies JSON shape and localized short body; connection refusal can retry briefly; timeout after request transmission does not retry; non-success Bark response produces local diagnostic without leaking key.
- [ ] **Step 2: Run red tests:** `cd src-tauri && cargo test notifications::bark::tests --lib && cargo test notifications::keychain::tests --lib`; expect missing transport/keychain behavior.
- [ ] **Step 3: Add target-macOS `security-framework = "3.7.0"` and `reqwest = { version = "0.13.4", default-features = false, features = ["blocking", "json", "rustls"] }`; implement typed Keychain access and POST body. Never put credentials in URL, process args, error strings or logs.
- [ ] **Step 4: Run green tests:** repeat both commands; expect all Task 6 cases pass.
- [ ] **Step 5: Commit:** `git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/notifications && git commit -m "feat: send Bark pushes with Keychain credentials"`.

### Task 7: Background Coordinator and Tauri Commands

**Files:** Modify `src-tauri/src/notifications/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/ui_copy.rs`; tests in `mod.rs` and `ui_copy.rs`.

**Interfaces:** `NotificationService::start(app: AppHandle, data_dir: PathBuf)`, `get_notification_settings`, `set_notification_settings`, `save_bark_key`, `delete_bark_key`, `send_test_notification`, `get_notification_status` Tauri commands. `NotificationStatus { key_saved, claude_hooks_installed, codex_hooks_installed, claude_quota_available, codex_quota_available, last_send_error }` is the only status DTO sent to the window. Settings changes affect the worker immediately; the worker polls events, reads enabled quotas, flushes due candidates, rechecks current switches/key before transport, and emits status changes to the settings window. The existing pet poll remains separate.

- [ ] **Step 1: Write failing tests:** current event while master disabled never sends; disable during completion settle or in-flight quota read suppresses send; stale event is dropped; connection error only updates local status; new app start baselines old files; quota adapters do not run when their source or all quota switches are off; locale switch changes subsequent payload copy; provider-independent failure does not stop the other provider.
- [ ] **Step 2: Run red tests:** `cd src-tauri && cargo test notifications::tests --lib`; expect missing coordinator behavior.
- [ ] **Step 3: Implement service wiring and command validation** with injectable clock, adapters and transport for tests. Add one tray command/window opener and localized menu/title without moving existing pet state logic into the new service.
- [ ] **Step 4: Run green tests:** `cd src-tauri && cargo test notifications::tests --lib && cargo test ui_copy::tests --lib`; expect all Task 7 cases pass.
- [ ] **Step 5: Commit:** `git add src-tauri/src/lib.rs src-tauri/src/ui_copy.rs src-tauri/src/notifications && git commit -m "feat: coordinate optional watch notifications"`.

### Task 8: Bilingual Notification Settings Window

**Files:** Create `notifications.html`, `src/notifications.ts`, `src/notifications.css`, `src/notifications/i18n.ts`, `src/notifications.test.ts`, `src-tauri/capabilities/notifications.json`; modify `vite.config.ts`, `src-tauri/tauri.conf.json` only if window bundle configuration requires it.

**Interfaces:** The window invokes Task 7 commands. It renders master/source/event/quota switches, key saved/unsaved state, hook/quota availability and test result. It listens to `locale-changed` and notification status events; never receives the Keychain secret from Rust after save.

- [ ] **Step 1: Write failing Vitest DOM tests:** all controls and defaults render; a source/category/threshold switch sends the exact settings shape; master off disables test push; saved key is masked and never returned to the DOM; Chinese and English cover every visible label, hint and error, including Codex question-hook coverage; missing Claude/Codex quota shows unavailable without a numeric placeholder; switching locale re-renders immediately.
- [ ] **Step 2: Run red tests:** `pnpm vitest run src/notifications.test.ts`; expect missing window/controller behavior.
- [ ] **Step 3: Implement compact responsive UI** with clearly grouped independent switches and a Keychain-backed masked key field. Add the Vite page input and scoped Tauri window capability.
- [ ] **Step 4: Run green tests and build:** `pnpm vitest run src/notifications.test.ts && pnpm build`; expect tests pass and `dist/notifications.html` exists.
- [ ] **Step 5: Commit:** `git add notifications.html src/notifications.ts src/notifications.css src/notifications/i18n.ts src/notifications.test.ts src-tauri/capabilities/notifications.json vite.config.ts src-tauri/tauri.conf.json && git commit -m "feat: add bilingual watch notification settings"`.

### Task 9: Integrated Verification and User Test Checklist

**Files:** Create `src-tauri/src/notifications/integration_tests.rs`, `docs/superpowers/qa/2026-10-23-watch-notifications.md`; adjust only defects exposed by integration verification.

**Interfaces:** No new runtime interface. The checklist covers Bark setup, locked/unlocked iPhone routing, a real Claude/Codex permission/completion/error event, both quota sources when available, language switch and existing Claude status line.

- [ ] **Step 1: Add integration fixtures** in `integration_tests.rs` proving Hook file → spool → engine → mock Bark for both agents, including interleaved sessions and quota reset/restart. Use fake server/KeyStore, never a real device key. Run `cd src-tauri && cargo test notifications::integration_tests --lib`; expect all fixtures pass.
- [ ] **Step 2: Run full automated checks:** `pnpm vitest run && pnpm build && (cd src-tauri && cargo test --lib && cargo check)`; expect all commands exit 0.
- [ ] **Step 3: Write user-run macOS/iPhone/Watch checklist** with observed-result fields and note Apple's phone/watch routing. Record any unverified real-device items clearly.
- [ ] **Step 4: Review diff and status:** `git diff --check && git status --short`; expect no whitespace errors or unintended files.
- [ ] **Step 5: Commit:** `git add src-tauri/src/notifications/integration_tests.rs docs/superpowers/qa/2026-10-23-watch-notifications.md && git commit -m "test: verify watch notification integration"`.
