# Settings interaction hardening

The user approved five fixes after a read-only adversarial review: reliable notification-template saving, prevention of duplicate pet profiles, recovery from Bark key save errors, a visible retry path for notification-settings initialization errors, and keyboard-focus plus Hook-install concurrency fixes.

The notification page should save template changes without relying on blur, show pending/saved/error feedback, and preserve unsaved text when a save fails. Switching template events or closing the window must not silently discard pending edits. Bark key input remains masked and is cleared only after the credential write succeeds. Failed initial data loads show a localized retry action. Re-rendering preserves focus on the active control. Each Hook-install action is guarded while in flight.

The pet editor should distinguish its unsaved draft from the active pet. Saving a draft once should disable repeated saves until the user changes it; selecting a saved pet should not accidentally save the old draft again. A clear way back to the draft is provided when the selected pet is being previewed. No backend pet-update operation is introduced.

Implementation stays within the existing TypeScript/Tauri UI architecture, with Chinese and English copy. Targeted regression tests cover the failure paths and rapid interactions. Existing untracked preview files remain untouched.

Approaches considered: keep blur-only saves and add a warning, use an explicit Save button, or save template input automatically with visible status. The last approach best matches the existing settings interaction. For duplicate pets, an idempotent backend operation was considered; guarding the editor's draft revision better preserves the existing new-profile API.
