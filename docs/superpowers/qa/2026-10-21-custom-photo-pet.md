# Custom Photo Pet QA — 2026-10-21

Host: macOS 26.6.2, Apple Silicon. Tested the packaged `Code Light.app` generated from this branch.

| Check | Observed result |
|---|---|
| Opaque JPEG and transparent PNG with automatic background removal | Transparent preview with the subject retained; saved photo appears in the 128×128 pet window. |
| Transparent PNG with Keep Alpha | Transparent preview generated. Selecting this mode for a JPEG gives an error and disables Save. |
| Two subjects | The preview retains one subject (largest-instance selection). |
| Corrupt PNG and input above 10 MiB | Error shown; Save stays disabled. The 4096-pixel bound and EXIF orientation are covered by Rust tests. |
| Save and restart | The selected photo is restored after relaunch. |
| Default cat, delete, settings reopen | Selecting the default cat restores its sprite. Deleting a saved photo removes its list entry. The settings window closes and reopens through ⌘,. |
| Corrupt saved manifest | Relaunch falls back to the built-in cat. The corrupt package remains on disk for recovery and is omitted from the selection list. QA package was removed after the check. |
| Five state preview buttons | Each button was exercised in the packaged settings window. Motion class transitions and one-shot completion are covered by frontend tests. |
| Custom reaction | The shortcut was exercised with a photo selected; the reaction and cat-overlay suppression are covered by frontend tests. The short motion was not reliably captured in a static screenshot. |
| Local processing | Code inspection found no network request path in the settings, image, Vision, or pet-command modules. Only the processed PNG, manifest, and selection are persisted. |
| macOS 12–13 | Runtime behavior was not tested on an older host; the macOS version predicate and transparent-PNG mode are covered by tests. |
| Distribution | `pnpm tauri build` produced .app and DMG. `hdiutil verify` reports a valid checksum. |
