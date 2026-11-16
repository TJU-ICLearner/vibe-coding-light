# Settings and release closure

The user approved four follow-up tasks: protect notification wording when the process exits before its delayed save, distinguish completed operations from a failed status refresh, require confirmation before permanently deleting a saved pet, and publish a cross-platform release candidate for manual testing.

Pending notification template edits and reset actions are written synchronously to a small local draft journal. On the next settings load, the page restores and retries them, then clears each journal entry after a confirmed settings save. The journal stores only custom wording, never Bark keys or event content. Invalid journal data is ignored. Existing settings remain the source of truth after a successful save.

Hook installation and Bark key operations report their own outcome separately from a subsequent status refresh. A refresh failure preserves the known result and shows a localized warning. Diagnostics refresh errors must not create an unhandled rejection.

The saved-pet list uses an inline, named confirmation below the selected row. The confirmation button is away from the original delete button so a double click cannot accidentally confirm. Cancel leaves the pet untouched; pending deletion cannot be submitted twice.

After automated verification, publish a versioned release candidate with macOS DMG, Windows NSIS, and Linux AppImage. Ask the user to run the supplied install and interaction checklist before promoting it to a stable release.

Approaches: a blocking app-exit save can stall shutdown; a local draft journal recovers after abrupt exit and fits existing Tauri persistence. A native confirmation dialog is smaller but less consistent across platforms; an inline confirmation has a predictable layout and can name the pet.
