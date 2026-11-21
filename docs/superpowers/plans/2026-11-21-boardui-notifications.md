# BoardUI Notification Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a functional BoardUI-based notification settings window with unchanged Bark, Hook, template, quota, and quiet-hours behavior.

**Architecture:** Reuse the BoardUI foundation from the pet-settings plan. Extract the existing DOM-bound notification controller's state transitions and persistence into a headless model, then render its state through React. Keep independent startup reads and queued template saving.

**Tech Stack:** Tauri 2, TypeScript, React 19, BoardUI free components, React Aria, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-boardui-interface-design.md`

## Global Constraints

- Depends on the committed foundation in `2026-11-21-boardui-pet-settings.md`.
- Preserve notification settings schema, Tauri command names, keychain storage, diagnostics, and local draft-recovery key.
- Chinese and English text, six themes, and quiet-hours rules remain intact. No Pro component or remote font.
- A status or diagnostics fetch must not block settings loading; unknown must not be shown as an unconfigured Bark key.
- Preserve `docs/previews/` and the stable release; publish only after the tray plan and platform checks.

## Review Focus

- `getStatus()` that never resolves still leaves all saved toggles editable; test in Task 1.
- A Bark key typed while status and locale change retains text, focus, and selection; test in Task 2.
- A template edit immediately before process exit recovers without losing another event's later edit; test in Task 1.
- A key save or Hook install followed by status-refresh failure reports the write as successful and offers retry; test in Task 2.
- 5-hour and 7-day 0% switches remain separate, and a quiet-hours test send follows its saved rules; test in Task 2.

## File map

- `src/notifications/model.ts`: `NotificationSettingsModel`, settings/status/diagnostics/template persistence and action outcomes.
- `src/notifications/api.ts`: existing Tauri command adapter and `NotificationApi` interface.
- `src/notifications/NotificationSettingsPage.tsx`, `src/notifications/NotificationSettingsPage.css`: BoardUI layout and section controls.
- `src/notifications.ts`, `notifications.html`, `src/notifications.css`: React bootstrap and compatibility re-exports, replacing DOM string rendering.
- `src/notifications/model.test.ts`, `src/notifications/NotificationSettingsPage.test.tsx`, `src/notifications.test.ts`: migration and user-visible regression checks.

---

### Task 1: Headless notification state and persistence

**Files:** `src/notifications/model.ts`, `src/notifications/api.ts`, `src/notifications/model.test.ts`, `src/notifications.ts`, `src/notifications.test.ts`

**Interfaces:**
- Consumes: `NotificationSettings`, `NotificationStatus`, `DiagnosticEntry`, `NotificationApi` types currently in `src/notifications.ts`.
- Produces: `NotificationSettingsModel(api: NotificationApi)` with `init(locale: NotificationLocale): Promise<void>`, `setLocale(locale): void`, `subscribe(listener: () => void): () => void`, `getSnapshot(): NotificationViewState`, and named methods for settings paths, key operations, source install, template editing/reset, diagnostics retry/clear. `NotificationViewState` contains settings, status loading/unknown/error, diagnostics loading/error, template draft/save state, and localized action feedback. `getSnapshot()` returns the same object reference until model state changes, for React subscriptions.

- [ ] Add failing model tests `settings_render_while_status_hangs` (`init()` resolves and saved toggles are available while `getStatus()` remains pending), `diagnostics_failure_is_local` (settings and status remain usable), `draft_recovers_after_restart` (unsaved title/body reappear and save), and `later_event_edit_survives_prior_save` (both event edits persist in order).
- [ ] Run `pnpm test -- --run src/notifications/model.test.ts`; confirm the new model tests fail before extraction.
- [ ] Extract the Tauri adapter and state/persistence logic from `src/notifications.ts` into the two focused files. Keep the same local draft key and generation guards; do not render HTML from the model.
- [ ] Run the model tests and existing notification tests; adapt existing DOM tests only after equivalent model coverage is present.
- [ ] Commit the headless model and API seam.

### Task 2: BoardUI notification window

**Files:** `src/notifications/NotificationSettingsPage.tsx`, `src/notifications/NotificationSettingsPage.css`, `src/notifications/NotificationSettingsPage.test.tsx`, `src/notifications.ts`, `notifications.html`, `src/notifications.css`, `src/notifications/i18n.ts`

**Interfaces:**
- Consumes: Task 1 `NotificationSettingsModel`, `NotificationViewState`, and Task 1 of the pet plan's BoardUI styles/components.
- Produces: `NotificationSettingsPage({ model }: { model: NotificationSettingsModel })` and a React bootstrap in `src/notifications.ts`.

- [ ] Add failing UI tests `preserves_key_input_during_status_and_locale_change` (value, focus, caret unchanged), `reports_key_and_hook_write_before_refresh_error` (success plus retry), and `keeps_period_and_quiet_controls_distinct` (5-hour zero, 7-day zero, quiet-hours choices call separate settings fields). Assert Chinese/English labels, unknown versus absent key text, and keyboard section navigation. Verify 600 px layout in a browser smoke check.
- [ ] Run `pnpm test -- --run src/notifications/NotificationSettingsPage.test.tsx`; confirm the missing page fails.
- [ ] Implement the approved section-navigation layout using free BoardUI Switch, Select, Input, Textarea, Button, and status primitives. Keep source rows aligned and make quota periods explicit. Use controlled inputs so status polling cannot erase a draft or Bark key.
- [ ] Connect all existing actions to the model: connection/key, source hooks, events, separate quota periods and weekly zero, quiet hours, template editor/preview/recovery, diagnostics retry/clear. Keep error and success messages distinct.
- [ ] Run focused tests, `pnpm test -- --run`, and `pnpm build`; all pass. Inspect Chinese/English and six themes in the local preview.
- [ ] Commit the notification migration. Continue with `2026-11-21-boardui-tray-release.md`.
