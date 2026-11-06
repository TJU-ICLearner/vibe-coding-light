# Next Improvements Design

## Intent

Make Vibe Coding Light easier to trust and operate after RC3: explain notification behavior, reduce unwanted alerts, expose simultaneous agent sessions, and make the menu bar app convenient to run and update.

## Scope and defaults

1. **Notification diagnostics.** Keep a bounded local history of event metadata and delivery outcomes. Show source, event type, time, outcome, and a short reason. Never persist task, command, reply, error text, Bark key, or full payload in diagnostics. Include a clear-history action. An incoming event without a candidate can be marked as observed or deferred; do not mislabel it as delivered.
2. **Quiet hours.** Opt-in local-time interval, default 22:00–08:00. A start equal to the end is invalid. Let users choose which categories bypass it; permission, question, and error bypass by default. Suppressed alerts are discarded rather than sent later. Manual test notifications remain available.
3. **Session submenu.** Show up to eight recently active Claude/Codex sessions with source, project name, state, and last activity. Use existing hook state files; no task or command text appears in menu items. An empty state is explicit. Keep it current as sessions change and localize Chinese/English.
4. **Startup and update notice.** macOS-only opt-in launch at login. Manual check for newer GitHub releases, plus optional automatic check no more than once per day. A newer release is shown in the menu and opens its official GitHub release page on click. No silent download or installation.

## Constraints

- Preserve existing notification settings and stored pets across upgrades.
- Keep Bark disabled by default and never send during quiet hours unless the event category is selected to bypass it.
- New menu and settings text must be complete in Chinese and English.
- Keep diagnostics local, bounded, and readable only by the current user.
- Verify backend decisions with unit tests and UI interactions with focused DOM tests. macOS menu and login item behavior needs user smoke testing; avoid computer use automation.

## Approach

Use the existing Rust notification service and settings page for diagnostics and quiet hours. Use the existing session files for a native tray submenu. Use macOS launch-at-login support and a small GitHub release check for convenience features. This keeps new work within the existing app rather than adding a background service.
