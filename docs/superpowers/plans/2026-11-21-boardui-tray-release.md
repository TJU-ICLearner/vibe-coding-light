# BoardUI Quick Controls and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the BoardUI interface refresh with a usable compact tray panel and cross-platform prerelease.

**Architecture:** Reuse the BoardUI foundation and theme bridge. Keep the Rust `TrayPanelState` and action command contract, move the panel's polling/action state out of DOM string rendering, and render the three tabs in React. Verify all three windows as a complete application before publishing a prerelease.

**Tech Stack:** Tauri 2, TypeScript, React 19, BoardUI free components, React Aria, Vitest, Rust, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-21-boardui-interface-design.md`

## Global Constraints

- Depends on the committed pet-settings and notification plans.
- Preserve `get_tray_panel_state`, `perform_tray_panel_action`, `hide_tray_panel` commands and existing Rust action strings.
- Keep the panel 360 × 620 and anchored to the menu-bar/taskbar icon; do not alter pet dragging or transparent-window behavior.
- Chinese and English, all six theme choices, follow-system preference, and no-Pro/no-remote-font constraints apply.
- Do not alter stable `main` or stable release until real-device acceptance; preserve `docs/previews/`.

## Review Focus

- Polling every second while the language select is focused does not reset its value or caret/focus; test in Task 1.
- Repeated toggle and update-check clicks do not close the panel; test in Task 1. Repeated launches do not spawn another app instance; platform smoke check in Task 2.
- A Tauri action failure retains the last known UI state and exposes retry feedback; test in Task 1.
- A change to any of six themes updates the panel and open settings windows without stale colors; test in Task 1 and smoke check in Task 2.
- Escape closes the panel while an outside click still uses the existing Rust hide behavior; test in Task 1.

## File map

- `src/tray/model.ts`, `src/tray/api.ts`: panel state, poll guards, action results, existing command adapter.
- `src/tray/TrayPanel.tsx`, `src/tray/TrayPanel.css`: compact BoardUI tabs, switches, buttons, source rows, theme choices.
- `src/tray.ts`, `tray.html`, `src/tray.css`, `src/tray.test.ts`: React bootstrap and behavior coverage.
- `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`: prerelease version alignment only after implementation passes.
- `docs/releases/<new-rc>.md`: release notes and device checklist.

---

### Task 1: Quick controls migration

**Files:** `src/tray/model.ts`, `src/tray/api.ts`, `src/tray/TrayPanel.tsx`, `src/tray/TrayPanel.css`, `src/tray.ts`, `tray.html`, `src/tray.css`, `src/tray.test.ts`

**Interfaces:**
- Consumes: existing `TrayPanelState`, `TrayPanelApi`, `Appearance` and the shared BoardUI component/theme source.
- Produces: `TrayPanelModel(api: TrayPanelApi)` with `init(): Promise<void>`, `refresh(): Promise<void>`, `performAction(action: string): Promise<void>`, `subscribe(listener: () => void): () => void`, `getSnapshot(): TrayViewState`; `TrayPanel({ model }: { model: TrayPanelModel })`. The snapshot reference changes only when state changes.

- [ ] Add failing tests `poll_keeps_language_focus`, `toggle_and_update_keep_panel_open`, `failed_action_keeps_last_state`, `theme_change_updates_all_windows`, `escape_hides_panel`, and `three_tabs_remain_reachable`. Assert the matching command/action counts and visible state; check 360 px layout separately in a browser smoke check. Keep existing tray assertions or move them to equivalent React tests.
- [ ] Run `pnpm test -- --run src/tray.test.ts`; confirm the new cases fail before the React migration.
- [ ] Extract the API and polling/action state from `src/tray.ts`; preserve action strings and generation guards. Replace `innerHTML` with a React root and use BoardUI Tabs, Switch, Select, Button, and status elements.
- [ ] Wire Overview, Agent setup, Settings, theme swatches, language, launch-at-login, update check, and quit. Keep panel scroll and focused select stable across refreshes; keep outside-click handling in Rust.
- [ ] Run `pnpm test -- --run src/tray.test.ts`, `pnpm test -- --run`, and `pnpm build`; all pass. Inspect the 360 × 620 layout in Chinese and English with long session names.
- [ ] Commit the tray migration.

### Task 2: App-wide verification and prerelease

**Files:** `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `docs/releases/<new-rc>.md`

**Interfaces:**
- Consumes: all three migrated windows and the unchanged Tauri backend.
- Produces: one version-aligned macOS Apple Silicon DMG, Windows x64 installer, Linux x64 AppImage, and a prerelease page with SHA-256 sums and device checklist.

- [ ] Run the full frontend suite, `cargo test --manifest-path src-tauri/Cargo.toml --lib`, `pnpm build`, `cargo fmt --check`, and `git diff --check`; resolve failures.
- [ ] Inspect each theme and both languages across all three windows, plus reduced-motion, a static pet, a GIF pet, background-removal loading, Bark key entry, template recovery, tray focus, and 600/620/360 px layouts. Record only observed results.
- [ ] Align the next prerelease version in the four version files and write bilingual release notes with a short real-device checklist.
- [ ] Build macOS DMG; verify image checksum, bundled app version, and code signature. Run Windows/Linux CI at the exact source commit; verify tests, artifacts, filenames, and SHA-256 sums.
- [ ] Publish a GitHub prerelease only after the three builds pass; keep stable `main` and the stable release unchanged. Provide direct platform links and state which real-device checks remain.
