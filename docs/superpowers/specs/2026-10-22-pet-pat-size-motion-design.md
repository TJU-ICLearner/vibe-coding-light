# Vibe Coding Light: pat interaction, larger pets, and per-image motion

Date: 2026-10-22

## Intent and scope

The user wants a friendly interaction in place of the current punishment effects, a simpler size control that can enlarge the entire desktop pet, and motion choices for each uploaded still image. The first release targets the existing macOS pet experience. It keeps the single-image and five-state workflows, transparent GIF playback, bilingual UI, and previously saved pets.

## User experience

### Pat interaction

- The tray action becomes **摸摸 / Pet the Pet**. The existing ⌘B shortcut triggers the same action. The old whip, stick, car, water, and egg sequence is no longer reachable.
- A small vector hand enters from above, pats the upper-center area twice, then leaves. Both the built-in pixel cat and photo pets receive a short, gentle response. The image itself is not modified. The generic hand target is not described as head detection.
- Repeated triggers restart one pat cleanly. A pet or state change during the animation must not leave an overlay or temporary state stuck on screen. Dragging the pet remains possible.
- The English tray and any relevant help text use friendly language; no visible whip/punishment copy remains.

### Size and preview

- Remove horizontal and vertical offset controls from the settings form. The size input accepts **0.5 through 3.0**, with a useful step such as 0.1, and starts at the existing default value 0.8.
- New pets are centered. The desktop window grows with the scaled image and its motion margin: a 128 px minimum at normal sizes, up to approximately 400 px per side at scale 3.0. Resize around the existing window center where possible and keep the result within the current display's usable area. The built-in cat keeps its 128 px window.
- The settings preview shows the entire resulting window, proportionally reduced to fit its panel, and displays the actual window dimensions. The same sizing rule drives preview and desktop display. A valid size never leaves an invisible cropped pet or blocks saving solely because the old 128 px bounds were exceeded.
- Existing saved pets retain their previous scale and offset when loaded. The new form does not expose legacy offsets, and newly saved pets use zero offsets. Listing, selection, and deletion of old pets continue to work.

### Motion per image

- Each uploaded **static** image in the default, working, waiting, error, or completed slot has its own motion selector. Choices: follow the current state behavior (default), still, side-to-side sway, vertical float, breathe, bounce, and gentle wobble. A single-image pet has one selector for its one image.
- Motion choice stays with the image while switching slots, languages, or single-image/five-state modes. The selector and preview reflect the currently selected slot. Removing an optional image also removes its motion choice.
- An empty optional slot falls back to both the default image **and the default image's motion**. It does not store an independent effect for a missing image.
- Transparent GIFs retain their frame animation and do not offer additional motion choices. Selecting a GIF disables the motion selector and explains why. A GIF used as fallback behaves the same way.
- The preview and desktop renderer use the same motion names and timing. A one-shot completion motion returns to the expected idle/default behavior; switching status or image does not restart GIF playback unnecessarily.
- “Follow state” retains the existing one-shot completed animation. Explicit sway/float/breathe/bounce/wobble choices loop until the active image changes or the user selects another pet.

## Data and implementation boundaries

- Extend the pet profile with a validated per-slot motion map. Omitted entries mean “follow state,” so schema 1 and 2 profiles continue to load with their existing behavior. New profiles use schema 3. Reject unknown motion names and motion entries attached to GIF or absent slots when saving; read legacy manifests without changing them on disk.
- Keep the existing image bytes and PNG/GIF preparation pipeline. Motion is metadata applied with CSS in the renderer. No new image processing dependency or frame extraction is needed.
- Share the window-size calculation between settings preview and desktop renderer. The Rust store validates the new scale range and accepts legacy offsets only when loading legacy profiles. The save path creates centered profiles; the active-pet payload provides the motion map and necessary legacy placement data.
- Replace the old beat event/overlay path with a single pat event and vector overlay. The built-in cat state returns to the latest agent state after the pat. Photo and GIF pets keep their selected image throughout the interaction.
- Preserve the existing bilingual language switch. Add translated motion labels, GIF-only explanation, size guidance, and revised validation messages.

## Errors and edge cases

- Invalid, non-finite, or out-of-range size values cannot be saved. The preview remains stable and an error is shown in the selected language.
- Window resize failure fits the pet into the previous window size and surfaces a diagnostic in logs; it must not prevent image/state updates. Reopening or selecting another pet retries sizing.
- Effects must respect `prefers-reduced-motion`: static pets and the pat overlay use a reduced or still presentation while GIF frames continue as the supplied file.
- Older profile metadata with a missing or damaged optional image continues to use the default asset and its motion. A missing default image remains an error.

## Verification

- Rust tests cover schema 1/2 compatibility, new motion-map validation, GIF restrictions, scale bounds, and centered saves.
- Frontend tests cover per-slot selection and fallback, mode/language changes, GIF behavior, preview size calculation, size validation, pat restart, and state restoration.
- Build and package checks cover the macOS app bundle, DMG, signature, and checksum. Native visual checks on another Mac are delegated to the user: pat placement, window enlargement at 3.0 near screen edges, settings preview fidelity, and all static motion choices.

## Out of scope

- Automatic head detection or hand positioning customized to each uploaded character.
- New GIF frame editing or motion overlays on GIFs.
- Changes to how agent work/wait/error/completed states are detected.
- Installer builds for Intel Mac, Windows, or Linux in this iteration.
