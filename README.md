<div align="center">
  <img src="./logo.png" alt="Vibe Coding Light" width="120" />

  # Vibe Coding Light

  A system tray status light for AI coding agents, with a desktop pet companion.

  [中文文档](./README_CN.md)

  <img src="./preview.gif" alt="Preview" width="480" />
</div>

It shows a colored indicator in your system tray so you can tell at a glance what your AI agent is doing — without keeping the terminal visible. Plus, an adorable pixel cat pet that reacts to your agent's status!

Currently supports **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** and **[OpenAI Codex CLI](https://github.com/openai/codex)**.

## Status Indicators

| Color | State | Description |
|:---:|---|---|
| Gray | Idle | No active sessions |
| Gray | Unknown | No agent event for 5 minutes; the session may still be running |
| Green (blinking) | Working | Agent is executing tool calls |
| Yellow (blinking) | Waiting | Claude Code or Codex requested approval or interactive input |
| Red (blinking) | Error | An error has occurred |
| Blue | Completed | Task finished (displays for 10 seconds, then returns to idle) |

Active states blink every 500ms to catch your attention. The tray tooltip shows the current state, active session count, and last update time.

**When does Waiting appear?** Claude Code permission or interactive notifications and Codex `PermissionRequest` hooks trigger it. Ordinary work without an approval prompt can go directly from Working to Completed, then return to Idle. It does not mean that the app detects every moment an agent is waiting for a free-form user reply.

## Desktop Pet 🐱

Vibe Coding Light now includes a pixel art desktop pet that reacts to your AI agent's status! The cat companion sits on your desktop and animates based on what your agent is doing.

| State | Animation |
|:---:|---|
| Idle | Relaxed, sitting calmly |
| Working | Energetic, typing away |
| Waiting | Alert, looking around |
| Error | Startled, ears back |
| Completed | Happy, celebrating |

**Toggle the pet:** Right-click the tray icon and select **"Show Pet"** or **"Hide Pet"** to control visibility.

**Interface language:** Open the tray menu and choose **Language → English** or **Language → Chinese**. Menu items, status tooltip, settings title, and pet settings change immediately. Your choice is saved across launches; the first launch follows your Mac's preferred language (Chinese for a Chinese system language, English otherwise).

The pet window is always on top and draggable, so you can position it anywhere on your screen.
Choose **Pet the Pet** in the tray menu, or press **⌘B**, to see a hand gently pat the active pet twice. The action works with the built-in cat and custom pets.

### Create a custom pet (macOS)

1. Open the tray menu and choose **Customize Pet**.
   With the pet window focused, **⌘,** also opens this window.
2. Choose **One image for every state** to use one asset, or **Different images for each state** to edit five clearly separated tabs: required Default / Rest plus optional Working, Waiting, Error, and Completed. The preview stays next to the editor on wide windows and above it on narrow windows. Missing state assets use the default. Switching modes keeps your draft; saving in single image mode stores only the default.
3. Each slot accepts PNG, JPEG, or a transparent GIF (up to 10 MiB). Static images can be cut out locally with **Remove Background** on macOS 14+; transparent PNG and GIF work on macOS 12–13. GIFs retain their original animation and must already have a transparent background. Static images may be up to 4096 pixels per side; GIFs may be up to 1024 pixels per side and 120 frames.
4. For each static image, choose its own motion: follow the agent state, still, sway, float, breathe, bounce, or wobble. GIFs keep their own animation and do not offer an extra motion effect. An empty state uses the default image and its motion.
5. Preview each state, choose a name and size from **0.5 to 3**, then click **Save and Use**. The pet window grows with the image, and the preview shows its actual window dimensions. Previewing alone does not replace the active pet. You can select or delete saved pets and return to the built-in pixel cat in the same window.

Static assets are stored as processed 256×256 PNGs; GIF bytes, timing, and loop settings are kept. Everything stays in Vibe Coding Light's local app data; source photos are not uploaded. Existing single-image pets remain usable, including their saved placement. New pets are centered; horizontal and vertical offset controls have been removed. Windows and Linux continue to use the built-in cat in this version.

## How It Works

Vibe Coding Light uses a file-based polling mechanism:

1. **Shell hooks** are registered as lifecycle hooks for Claude Code (`~/.claude/settings.json`) and Codex (`~/.codex/hooks.json`)
2. Each hook writes a JSON state file to `~/.code-light/sessions/<session-id>.json`
3. The tray app polls these files every second and updates the icon

```
Agent event → Hook script → ~/.code-light/sessions/*.json → Tray icon
```

Zero network ports, zero APIs, zero configuration — just files on disk.

## Install

### Download for Mac

Download the Apple Silicon DMG from the [latest release](https://github.com/TJU-ICLearner/vibe-coding-light/releases/latest), then drag **Vibe Coding Light.app** into Applications. Intel Mac users can build from source. The build is ad-hoc signed but has no Apple Developer ID signature or notarization; first launch may require **Open Anyway** in System Settings → Privacy & Security.

The app keeps the existing `com.cuihuapeng.code-light` bundle identifier and `~/.code-light` hook data directory so previous local settings remain available after the rename.

### Prerequisites

- macOS 12+ / Linux / Windows 10+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) and/or [Codex CLI](https://github.com/openai/codex) installed
- Node.js 18+, [pnpm](https://pnpm.io/), and the [Rust](https://rustup.rs/) toolchain for source builds
- Windows users need [Git for Windows](https://git-scm.com/) (provides bash)

### Build from source

```bash
git clone https://github.com/TJU-ICLearner/vibe-coding-light.git
cd vibe-coding-light
pnpm install
pnpm tauri build
```

Built artifacts:

| Platform | Location |
|----------|----------|
| macOS | `src-tauri/target/release/bundle/macos/Vibe Coding Light.app` |
| Linux | `src-tauri/target/release/bundle/deb/vibe-coding-light_*.deb` |
| Windows | `src-tauri/target/release/bundle/nsis/Vibe Coding Light_*.exe` |

## Usage

1. **Launch** Vibe Coding Light — a gray dot appears in your system tray
2. **Right-click** the icon, choose your interface language, then select **"Setup Claude Hooks"** to register hooks for Claude Code, or **"Setup Codex Hooks"** for Codex CLI
3. **Start your AI agent** in the terminal — the tray icon changes color as the agent works

That's it. On macOS the app runs as a pure menu bar accessory with no dock icon.

> **Note for Codex users:** After setting up Codex hooks, run `/hooks` in the Codex CLI and press `t` to trust all hooks before they can take effect.

### macOS: "App is damaged" or "cannot be opened" error

Download the DMG again and compare its digest with `SHA256SUMS.txt` on the release page. After confirming its integrity and source, drag the app into Applications and try **Open Anyway** in System Settings → Privacy & Security. If macOS still reports it as damaged, remove quarantine only from this app:

```bash
xattr -cr "/Applications/Vibe Coding Light.app"
```

Then reopen the app. Do not run this command on files whose source or checksum you cannot verify.

### Multi-session support

If you run multiple sessions (Claude Code and/or Codex) in different terminals, Vibe Coding Light tracks all of them simultaneously. The icon reflects the highest-priority state across all sessions (Error > Waiting > Working > Completed > Unknown > Idle).

### Automatic cleanup

- Sessions with no activity for 5 minutes show "Status unknown"; their files are removed after 24 hours
- Only a `Stop` hook reports completion, and a later event can reactivate the same session
- Completed sessions are cleaned up after the 10-second display window

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev

# Build for production
pnpm tauri build

# Lint Rust code
cd src-tauri && cargo clippy
```

## Project Structure

```
vibe-coding-light/
├── hooks/
│   ├── claude/                      # Claude Code hook scripts
│   │   ├── _helpers.sh              # Shared helpers (session ID from env, atomic write)
│   │   ├── pre-tool-use.sh          # → working
│   │   ├── post-tool-use.sh         # Placeholder
│   │   ├── post-tool-use-failure.sh # → error
│   │   ├── notification.sh          # → waiting (on permission prompts)
│   │   └── stop.sh                  # → completed
│   └── codex/                       # Codex CLI hook scripts
│       ├── _helpers.sh              # Shared helpers (session ID from stdin JSON)
│       ├── session_start.sh         # → working
│       ├── pre_tool_use.sh          # → working
│       ├── permission_request.sh    # → waiting
│       ├── post_tool_use.sh         # → working
│       ├── user_prompt_submit.sh    # → working
│       └── stop.sh                  # → completed
├── public/pet/                      # Desktop pet sprite sheets
│   ├── idle.png                     # Idle animation
│   ├── working.png                  # Working animation
│   ├── waiting.png                  # Waiting animation
│   ├── error.png                    # Error animation
│   └── completed.png                # Completed animation
├── src-tauri/                       # Tauri v2 / Rust backend
│   ├── src/
│   │   ├── main.rs                  # Entry point
│   │   └── lib.rs                   # Tray icon, polling, blink, hook setup, pet window
│   ├── icons/status/                # Status indicator PNGs (gray, green, yellow, red, blue)
│   └── tauri.conf.json              # Tauri configuration
├── src/                             # Pet renderer and photo settings frontend
├── generate-sprites.cjs             # Sprite sheet generator for desktop pet
├── package.json
└── vite.config.ts
```

## Supported Agents & Events

| Event | Claude Code | Codex CLI |
|-------|:-----------:|:---------:|
| Session Start | - | working |
| Pre Tool Use | working | working |
| Permission / Notification | waiting | waiting |
| Post Tool Use | - | working |
| Tool Use Failure | error | - |
| User Prompt Submit | - | working |
| Stop | completed | completed |

## Tech Stack

- **Backend:** [Tauri v2](https://v2.tauri.app/) + Rust
- **Frontend:** Vite + TypeScript for the pet and settings windows
- **Hooks:** Bash scripts registered as lifecycle hooks
- **Desktop Pet:** Pixel art sprite sheets generated with Node.js canvas

## License

MIT
