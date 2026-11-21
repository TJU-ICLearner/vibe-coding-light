# BoardUI Interface Refresh — Design

## Intent

Make Vibe Coding Light's three interactive windows feel like one polished desktop application using actual free BoardUI components, while preserving the pet, notification, update, theme, and localization behavior users already rely on. The user chose a staged React 19 + Tailwind CSS v4 migration over a CSS-only imitation.

## Goals and boundaries

- Redesign the desktop pet settings window, notification settings window, and 360 × 620 quick-control panel, in that order.
- Use BoardUI's free, MIT-licensed component source for the controls that fit each window. Retain license notices with copied source. No Pro purchase or Pro component is assumed.
- Keep all six current theme palettes (System Light, System Dark, Village Opera, Morning Mist, Autumn, Banana Rain), the follow-system setting, and the Chinese/English toggle. A chosen language applies to every visible label, status, error, and dialog.
- Keep Tauri commands, saved settings formats, hook behavior, Bark credential storage, pet import formats, default pets, notification templates, and update logic compatible with current installations.
- Preserve keyboard and screen-reader behavior, reduced-motion behavior, pet GIF playback, selected-state preview behavior, draft retention, autosave, and the tray panel's stay-open interaction.
- This refresh does not redesign the floating pet itself or change its animations, window behavior, or OS integration.

## Approaches considered

1. **Actual BoardUI source components with a staged React migration — selected.** Gives consistent controls and React Aria keyboard behavior, at the cost of migrating three webview renderers and introducing React/Tailwind. The existing Tauri backend and data contracts remain.
2. **Port only BoardUI's visual language into the current native DOM code.** Smaller change, but it would not use the requested components and would leave separate hand-built control logic in each window.
3. **Replace every view, including the floating pet, at once.** Would touch the transparent draggable pet window for no interface benefit and increase the chance of platform regressions.

## Shared design system

- Run BoardUI initialization in the existing Vite app, pin installed packages and CLI output, and add only needed free components. Use source components, not a remote runtime or Pro template.
- Keep BoardUI styles inside the three UI entry points. Do not load Tailwind or global BoardUI resets into `index.html`, the transparent pet renderer.
- Map each existing appearance palette to the BoardUI semantic tokens for page/surface, text, border, accent, danger, and focus. A single adapter owns the mapping. `system_dark` and `shaxi` use dark semantics; the other palettes use light semantics with palette-specific overrides. No raw accent hex codes in individual component layouts.
- Preserve the current theme IDs and persisted appearance values. Typography follows BoardUI's hierarchy with local system font fallback for Chinese; no network font request is required.
- Share page spacing, card radius, control height, section heading, status, focus, and empty-state patterns. Keep the pet preview checkerboard neutral so image transparency is legible in all themes.

## Window designs

### Desktop pet settings (first migration)

- At desktop widths, place a compact page heading above a two-column workspace: import/edit controls on the left and a sticky live preview on the right. The saved-pet library follows below. At the 620 px minimum window width, stack preview above the editor without moving it out of the visible workflow.
- Use BoardUI Tabs or Segmented Control for single-image versus per-state setup and the five state slots; use File Upload, Select, Number Field, Input, Button, and a confirmation Modal where the existing interaction needs them. A state selection always updates the preview, including both built-in pets.
- Keep the selected pet and unsaved draft visibly distinct. Show a clear saved, processing, or error status near the Save action. A saved draft cannot be saved twice; a partial save that failed to select is still marked saved. A failed refresh offers Retry without rewriting the profile.
- The saved-pet list uses one consistent row pattern with thumbnail/name, selected indicator, Select action, and named Delete confirmation. Built-in pets cannot be deleted.

### Notification settings (second migration)

- At 900 px, use a modest left section navigator and a single reading column for Connection, Sources, Events, Quotas, Quiet Hours, Message Templates, and Diagnostics. At 600 px, collapse navigation to a compact top section control and keep each setting row aligned.
- Use BoardUI Switch, Select, Input, Textarea, Button, Tabs, and status/notification components. Connection status distinguishes unknown, loading, configured, and failed states. Hook source rows align name, status, toggle, and setup action.
- Group 5-hour and 7-day quota controls under their explicit periods. Keep the independent weekly-zero setting and all existing switches. Quiet-hours inputs and bypass switches remain clear and test sends follow the configured rules.
- Template editing retains per-event title/body, token guidance, live preview, local recovery of unfinished drafts, and explicit saving/error states. A background status or diagnostic read failure never blocks the other settings.

### Quick controls (third migration)

- Preserve the compact anchored panel and its three areas: Overview, Agent setup, Settings. Use BoardUI Tabs, Switch, Button, Select, and status chips sized for a 360 px panel. Keep current session and Bark status visible at a glance.
- Toggle actions and update checks leave the panel open; outside click and Escape close it. Polling must not replace an active language selector, steal focus, or reset scroll position.
- Theme choices keep the six names and swatches. Selecting one updates every open UI window through the existing appearance event.

## Implementation seams

- Migrate one HTML entry point at a time to a React root. Keep headless Tauri API and state transitions separate from React view components. Extract the existing pet and notification controller behavior into testable models rather than copy business rules into JSX; preserve current command names and payloads.
- Maintain the old page until its replacement passes functional tests, then switch that entry point. Do not mix a React tree with `innerHTML` writes under the same root.
- Add a small shared UI package folder for appearance bridge, common layout primitives, and BoardUI component source. Avoid hand-editing imported BoardUI internals when a wrapper or token mapping can handle the app-specific need.
- Verify free-component availability and license metadata before installation. If a planned component is Pro-only, choose a free base component or an app-owned composition and record that substitution.

## Verification and delivery

- For each migrated page, verify Chinese/English, all six themes, narrow and standard window sizes, keyboard navigation, async loading/retry, and existing action outcomes. Keep or replace existing DOM tests with equivalent user-visible checks; do not weaken coverage of save, partial failure, notification draft recovery, or tray focus.
- Run TypeScript checks, frontend tests, Rust tests, and production build. Build macOS locally and Windows/Linux in CI before publishing a prerelease. Request real-device checks for transparency preview, dragging, tray positioning, and Bark delivery; the stable release stays unchanged until those checks pass.
- Prepare a visual preview of the three windows for review before implementation if the user wants one. The preview is a design artifact, not a shipping view.

## Builder decisions left open

- Select exact free BoardUI components and any app-owned compositions after inspecting their installed source. Use BoardUI's semantic tokens as the visual source of truth, with the existing palette values as brand overrides.
- Choose implementation module boundaries and the smallest migration sequence that keeps every page functional after each step.
