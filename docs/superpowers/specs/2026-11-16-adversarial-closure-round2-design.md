# Adversarial Closure Round 2 Design

## Goal

Close three confirmed failure paths without changing the normal interaction: pet operations followed by failed reads, partial notification-settings startup failure, and obsolete pre-1.0 update hints in RC builds.

## Pet settings

- A successful save, selection, or deletion remains successful if a later list/active read fails. Show localized success with a refresh warning, and expose a retry control for the stale view.
- After successful save, retain the returned manifest and draft assets in the local view so the new pet remains selected and a second click cannot create a duplicate. A failed save still reports failure and permits retry.
- If profile files are saved but writing the selected-pet pointer fails, return the saved manifest as a partial result. Keep the previous selection, show a localized "saved but not selected" message, and block another save of the same draft.
- After successful selection or deletion, update the known selection immediately. A failed follow-up read must not claim the write failed. A failed write keeps the previous selection/list.
- Startup list and active reads may resolve independently; show whichever data loaded and offer retry for the missing part.

## Notification settings

- Settings are essential; Hook/Bark status and diagnostics are independent. If either optional read fails during startup, render usable settings with an explicit localized warning and retry for that section.
- A settings-read failure still shows the existing full-page retry state. Pending template drafts remain recoverable.

## Update checks

- Use GitHub's publish date to distinguish old pre-1.0 test releases from later official releases that reuse a tag. Preserve normal prerelease eligibility for current RC builds.
- Invalidate update caches written by older builds and recheck, so removed test releases cannot remain as update hints after upgrading.

## Verification and delivery

Write failing tests for each failure path before modifying product code. Run TypeScript and Rust suites, production build, formatting checks, and cross-platform installer CI. Publish 1.0.3 RC2 for Mac Apple Silicon, Windows x64, and Linux x64; keep stable 1.0.2 unchanged until real-device feedback.
