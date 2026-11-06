# Windows and Linux port design

## Scope

Ship testable Windows and Linux builds with the existing built-in Bubu pet, transparent PNG/GIF custom pets, five-state assets, hook-driven status, Bark notifications, bilingual settings, update checks, and launch at login. Automatic background removal remains macOS-only. Keep existing macOS data and behavior compatible.

## Platform decisions

- Use native Tauri windows and tray menus on Windows/Linux. The persistent macOS tray popover and full-screen Space integration remain macOS-specific.
- Reuse the portable Rust image validator, pet store, and notification engine. Only the Vision-backed image mode is platform-gated.
- Store Bark device keys in the operating system's credential store: Windows Credential Manager and Linux Secret Service. Report a clear error if a Linux desktop has no Secret Service provider; never fall back to plaintext.
- Use the existing shell hook scripts through an available Bash. Windows requires Git for Windows; installation/status diagnostics must make this requirement visible.
- Build Windows NSIS and Linux AppImage on their respective GitHub-hosted runners. These are unsigned test builds; release readiness requires real-device validation.

## Acceptance

1. Both builds launch with Bubu, show a tray icon, and open pet and notification settings.
2. PNG/GIF import, per-state selection, scaling, dragging, and status changes work on both systems.
3. Claude/Codex hook installation can report status and process events. Bark settings save, delete, test, and dispatch without exposing the key.
4. Update checks, language switching, and launch at login work or clearly report an OS-level prerequisite.
5. CI builds and unit tests pass. The user checks installer launch, tray, window stacking, dragging, GIF playback, and Bark on Windows and Linux hardware.

## Risks

Linux desktop environments differ in tray support, compositing, transparency, Secret Service, and Wayland window stacking. Windows unsigned installers may show SmartScreen. These require user device checks before a stable release.
