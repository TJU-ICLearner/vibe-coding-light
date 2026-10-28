<div align="center">
  <img src="./logo.png" alt="Vibe Coding Light" width="120" />

  # Vibe Coding Light

  AI 编程助手的系统托盘状态指示灯，附带桌面宠物伴侣

  [English](./README.md)

  <img src="./public/pet/bubu/default.gif" alt="内置桌宠布布" width="240" />
</div>

让你一眼就能看到 AI 编程助手正在做什么 —— 不需要一直盯着终端窗口。内置桌宠布布也会根据 Agent 的状态做出反应。

目前支持 **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** 和 **[OpenAI Codex CLI](https://github.com/openai/codex)**。

**当前正式版：1.0.0。** GitHub 上此前发布的版本均为开发测试版。因正式版重新编号，已安装测试版的用户请从[最新发布页](https://github.com/TJU-ICLearner/vibe-coding-light/releases/latest)手动下载 1.0.0；旧版的自动检查可能无法识别较小的新版本号。

## 状态指示灯

| 颜色 | 状态 | 说明 |
|:---:|---|---|
| 灰色 | 空闲 | 没有活跃会话 |
| 灰色 | 状态未知 | 连续 5 分钟没有事件；会话可能仍在运行 |
| 绿色（闪烁） | 工作中 | Agent 正在执行工具调用 |
| 黄色（闪烁） | 等待确认 | Claude Code 或 Codex 发出了权限确认或交互输入请求 |
| 红色（闪烁） | 出错 | 发生了错误 |
| 蓝色 | 已完成 | 任务完成（显示 10 秒后自动回到空闲状态） |

活跃状态（工作 / 等待 / 出错）每 500ms 闪烁一次，提醒你注意。托盘图标的提示文字会显示当前状态、活跃会话数和最后更新时间。

菜单栏的**“当前会话”**可查看最多 8 个近期 Claude/Codex 会话，显示来源、项目名、状态和最近活动时间；不会展示任务、命令或错误原文。超过 5 分钟未活动的会话不会列在此菜单中。

**什么时候进入“等待”？** Claude Code 的权限提示或交互通知，以及 Codex 的 `PermissionRequest` 钩子会触发。无需审批的普通工作可以从“工作”直接进入“完成”，随后回到“休息”。应用不会推断所有等待用户自由回复的时刻。

> **截图占位｜托盘状态：** 展示空闲、工作、等待、出错、完成五种颜色，以及展开后的当前会话菜单。建议使用一张拼图；请将素材放入 `docs/images/` 后替换本段。

## 桌面宠物 🐻

Vibe Coding Light 默认使用布布作为内置桌宠。新安装会直接显示布布；升级时，已选择的自定义桌宠仍保持选中。五张透明 GIF 保留原有逐帧动画，不叠加额外动效。

| 状态 | 动画 |
|:---:|---|
| 空闲 | 睡觉 |
| 工作中 | 在电脑前工作 |
| 等待确认 | 喝奶茶 |
| 出错 | 道歉 |
| 已完成 | 跳舞 |

> **演示图占位｜布布五种状态：** 展示布布在五种状态下的原始 GIF 动画，建议用横向拼图或短视频；请将素材放入 `docs/images/` 后替换本段。

**切换宠物显示：** 右键点击托盘图标，选择 **“显示桌宠”** 或 **“隐藏桌宠”** 来控制宠物的可见性。

**切换界面语言：** 在托盘菜单中选择 **“语言 → 中文”** 或 **“语言 → 英文”**。菜单、状态提示、设置窗口标题和桌宠设置页会立即切换，重启后保留选择。首次启动时按系统首选语言选择：中文系统用中文，其他语言用英文。

宠物窗口始终置顶且可拖拽，你可以将它放在屏幕上的任何位置。在 macOS 13 及以上，桌宠也会尝试显示在其他应用的原生全屏空间中。
在菜单栏选择**“摸摸”**，或按 **⌘B**，会出现一只手轻轻摸桌宠两次。布布和自定义桌宠都支持。布布的部分原始 GIF 自带中文字；即使选择英文界面，这些画面文字仍保留原样。

### 用自己的图片制作桌宠

1. 打开托盘菜单，选择 **“自定义桌宠”**。
   桌宠窗口获得焦点时，macOS 也可以按 **⌘,**、Windows/Linux 按 **Ctrl+,** 打开设置。
2. 选择**单图**，让所有状态共用一个素材；或选择**按状态**，通过五个清晰分隔的标签设置必选的默认／休息素材，以及可选的工作、等待、出错和完成素材。宽窗口时预览固定在编辑区旁，窄窗口时预览排在编辑区前。未设置的状态会使用默认素材。切换模式会保留草稿；单图模式保存时只写入默认素材。
3. 每个位置可上传 PNG、JPEG 或已有透明背景的 GIF（单文件不超过 10 MiB）。macOS 14 及以上可为静态图片选择**自动去背景**；各桌面系统都可使用透明 PNG 或透明 GIF。GIF 保留原有帧、速度与循环设置，不提供自动抠图。静态图宽高均不超过 4096 像素；GIF 宽高均不超过 1024 像素、最多 120 帧。
4. 每张静态图都可单独选择动效：跟随状态、静止、左右摇摆、上下浮动、呼吸、弹跳或轻微晃动。GIF 保留自身逐帧动画，不叠加额外动效；缺少素材的状态沿用默认图片及其动效。
5. 预览各状态，设置名称和 **0.5–3 倍**大小，再点击**保存并使用**。桌宠窗口会随图片放大，预览旁显示实际窗口尺寸。仅预览不会更换当前桌宠。同一窗口可以切换或删除已保存桌宠，也可恢复默认布布。

静态素材在本地处理为 256×256 透明 PNG；GIF 保留原始动画数据。素材和设置都保存在本机，原图不会上传。旧版单图桌宠及其已保存的位置仍可使用；新桌宠居中显示，设置页不再提供水平、垂直偏移。Windows 和 Linux 也支持透明 PNG/GIF 自定义桌宠。

> **截图占位｜自定义桌宠：** 展示“单图／按状态”切换、素材预览、逐图动效与大小调节。建议同时展示一张透明 GIF 的预览；请将素材放入 `docs/images/` 后替换本段。

## 可选的手表通知

在菜单栏打开**“通知设置”**，只保存 Bark 测试链接中域名后、下一个 `/` 前的设备密钥（不要包含 `/title/body` 等路径或参数），然后开启总开关，再选择 Claude Code、Codex，以及权限确认、提问、完成、错误和额度提醒。当前连接 Bark 官方服务器 `api.day.app`。额度可分别选择剩余 80%、50%、20%、其他周期 0%、7 天周期 0% 与恢复提醒；每个来源和额度周期分别提醒，首次读取只建立基线。升级时，应用会更新之前由本应用安装的 Hook。

每类事件可分别编辑通知标题和正文，支持 `{source}`、`{detail}`、`{task}`、`{command}`、`{error}`、`{reply}`、`{question}`、`{period}`、`{remaining}` 变量；留空则使用默认文案。中文和英文文案分别保存。**“包含详细内容”默认关闭**：关闭时通知事件文件不会记录这些原文，也不会把原文发给 Bark；打开后默认文案会附上相应原文，最长取每项前 1000 字。原文可能包含密钥或私人信息，请按需开启。预览使用示例文字，不读取真实任务内容。

请先在 iPhone 安装 Bark 并允许通知，再设置 Apple Watch 接收 Bark 通知。推送先到 iPhone，是否显示在手表上由 Apple 的通知规则决定。总开关默认关闭；关闭开关或退出应用后不会继续推送。Claude 和 Codex 的额度接口因版本或登录方式可能不可用，设置页会显示读取状态。

通知设置页提供**发送记录**与**免打扰时段**。发送记录仅保存最近 100 条事件类型、来源、时间和发送结果，不保存通知正文、任务原文或 Bark 密钥，可随时清空。免打扰默认关闭，开启后默认 22:00–08:00 按本机时间生效；权限确认、提问和错误默认仍发送，每类事件可单独调整。被静音的通知不会稍后补发。正式版不提供通知测试按钮。

> **截图占位｜Bark 通知设置：** 展示来源和事件开关、额度档位、通知文案、免打扰与发送记录。截图前请隐藏 Bark 设备密钥和私人任务内容；请将素材放入 `docs/images/` 后替换本段。

菜单栏另有**“登录时启动”**和**“自动检查新版本”**两个可选开关，以及随时可用的**“检查新版本”**。自动检查最多每天一次；若 GitHub API 暂时不可用，应用会尝试 GitHub 发布订阅源。发现新版本后，点击菜单提示会打开本项目的 GitHub 发布页；应用不会自动下载或安装。macOS 的登录启动在 macOS 13 及以上优先使用系统登录项，必要时使用用户级 LaunchAgent；请先将 App 拖入“应用程序”。

## 工作原理

Vibe Coding Light 使用基于文件的轮询机制：

1. **Shell 脚本**作为生命周期钩子注册到 Claude Code（`~/.claude/settings.json`）和 Codex（`~/.codex/hooks.json`）
2. 每个钩子将 JSON 状态文件写入 `~/.code-light/sessions/<会话ID>.json`
3. 托盘应用每秒轮询这些文件，并更新图标

```
Agent 事件 → 钩子脚本 → ~/.code-light/sessions/*.json → 托盘图标
```

状态指示灯不开放网络端口。只有主动开启 Bark 通知后，应用才向 Bark 发送所选事件的简短通知；手动检查版本或开启每天检查后，应用会访问本项目的 GitHub Releases API。

## 安装

### 下载正式版

从[最新发布页](https://github.com/TJU-ICLearner/vibe-coding-light/releases/latest)按系统下载：

| 系统 | 安装包 | 安装方式 |
|---|---|---|
| macOS（Apple Silicon） | `.dmg` | 将 **Vibe Coding Light.app** 拖入“应用程序” |
| Windows（x64） | `-setup.exe` | 运行安装程序 |
| Linux（amd64） | `.AppImage` | 添加执行权限后运行 |

macOS 安装包使用 ad-hoc 签名，尚未通过 Apple Developer ID 签名或公证；首次打开可能需要在“系统设置 → 隐私与安全性”点击“仍要打开”。Windows 安装包尚未代码签名。Intel Mac 可从源码构建。Linux 需要可用的桌面环境与 WebKitGTK 4.1。

> **截图占位｜三平台安装：** 分别展示 macOS 应用、Windows 安装完成后的托盘图标、Linux AppImage 启动后的桌宠。请将素材放入 `docs/images/` 后替换本段。

更名后继续使用原有 `com.cuihuapeng.code-light` 应用标识和 `~/.code-light` 钩子数据目录，便于保留已有本地设置。

### 前提条件

- macOS 12+ / Linux / Windows 10+
- 已安装 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 和/或 [Codex CLI](https://github.com/openai/codex)
- 从源码构建时需要 Node.js 18+、[pnpm](https://pnpm.io/) 和 [Rust](https://rustup.rs/) 工具链
- Windows 用户需安装 [Git for Windows](https://git-scm.com/)；Hook 依赖 Git Bash 与 Perl（JSON::PP、Time::HiRes）。Linux Hook 依赖 Bash 与 Perl（JSON::PP、Time::HiRes）；Bark 密钥需要运行中的 Secret Service（如 GNOME Keyring 或 KWallet）。

### 从源码构建

```bash
git clone https://github.com/TJU-ICLearner/vibe-coding-light.git
cd vibe-coding-light
pnpm install
pnpm tauri build
```

构建产物：

| 平台 | 路径 |
|------|------|
| macOS | `src-tauri/target/release/bundle/macos/Vibe Coding Light.app` |
| Linux | `src-tauri/target/release/bundle/appimage/*.AppImage` |
| Windows | `src-tauri/target/release/bundle/nsis/Vibe Coding Light_*.exe` |

## 使用方法

1. **启动** Vibe Coding Light —— 系统托盘会出现一个灰色圆点
2. **右键点击**图标，可先选择 **“语言”**；再选择 **“设置 Claude 钩子”** 注册 Claude Code 钩子，或选择 **“设置 Codex 钩子”** 注册 Codex 钩子
3. **在终端启动你的 AI Agent** —— 托盘图标会随着 Agent 的工作自动变色

就这么简单。在 macOS 上应用以纯菜单栏方式运行，不会出现在 Dock 栏。

> **Codex 用户注意：** 设置 Codex Hooks 后，需要在 Codex CLI 中运行 `/hooks` 命令，然后按 `t` 信任所有钩子，钩子才会生效。

### macOS 提示"已损坏"或"无法打开"

先从发布页重新下载，并对照同页的 `SHA256SUMS.txt` 核对 DMG 摘要。确认文件完整且来源可信后，将应用拖入“应用程序”，尝试在“系统设置 → 隐私与安全性”点击“仍要打开”。如果仍提示“已损坏”，可在终端只移除这个应用的隔离属性：

```bash
xattr -cr "/Applications/Vibe Coding Light.app"
```

然后重新打开应用。不要对来源或校验结果不明的文件执行此命令。

### 多会话支持

如果你在不同终端同时运行多个会话（Claude Code 和/或 Codex），Vibe Coding Light 会同时追踪所有会话。图标显示所有会话中优先级最高的状态（错误 > 等待 > 工作 > 完成 > 状态未知 > 空闲）。

### 自动清理

- 连续 5 分钟没有事件的会话显示“状态未知”，状态文件在 24 小时后清理
- 只有 `Stop` 钩子报告完成，同一会话的后续事件可以重新激活状态
- "完成"状态在 10 秒显示窗口后自动清理

## 开发

```bash
# 安装依赖
pnpm install

# 开发模式运行
pnpm tauri dev

# 生产构建
pnpm tauri build

# Rust 代码检查
cd src-tauri && cargo clippy
```

## 项目结构

```
vibe-coding-light/
├── hooks/
│   ├── claude/                      # Claude Code 钩子脚本
│   │   ├── _helpers.sh              # 公共函数（环境变量获取会话 ID、原子写入）
│   │   ├── pre-tool-use.sh          # → 工作中
│   │   ├── post-tool-use.sh         # 占位
│   │   ├── post-tool-use-failure.sh # → 出错
│   │   ├── notification.sh          # → 等待确认（权限提示时）
│   │   └── stop.sh                  # → 已完成
│   └── codex/                       # Codex CLI 钩子脚本
│       ├── _helpers.sh              # 公共函数（从 stdin JSON 提取会话 ID）
│       ├── session_start.sh         # → 工作中
│       ├── pre_tool_use.sh          # → 工作中
│       ├── permission_request.sh    # → 等待确认
│       ├── post_tool_use.sh         # → 工作中
│       ├── user_prompt_submit.sh    # → 工作中
│       └── stop.sh                  # → 已完成
├── public/pet/                      # 桌面宠物精灵图
│   ├── idle.png                     # 空闲动画
│   ├── working.png                  # 工作中动画
│   ├── waiting.png                  # 等待确认动画
│   ├── error.png                    # 出错动画
│   └── completed.png                # 已完成动画
├── src-tauri/                       # Tauri v2 / Rust 后端
│   ├── src/
│   │   ├── main.rs                  # 入口
│   │   └── lib.rs                   # 托盘图标、轮询、闪烁、钩子注册、宠物窗口
│   ├── icons/status/                # 状态指示灯图标（灰、绿、黄、红、蓝）
│   └── tauri.conf.json              # Tauri 配置
├── src/                             # 桌宠渲染和图片设置窗口前端
├── generate-sprites.cjs             # 桌面宠物精灵图生成脚本
├── package.json
└── vite.config.ts
```

## 支持的 Agent 与事件

| 事件 | Claude Code | Codex CLI |
|------|:-----------:|:---------:|
| 会话启动 | - | 工作中 |
| 工具调用前 | 工作中 | 工作中 |
| 权限 / 通知 | 等待确认 | 等待确认 |
| 工具调用后 | - | 工作中 |
| 工具调用失败 | 出错 | - |
| 用户提交提示 | - | 工作中 |
| 会话结束 | 已完成 | 已完成 |

## 技术栈

- **后端：** [Tauri v2](https://v2.tauri.app/) + Rust
- **前端：** Vite + TypeScript，用于桌宠和设置窗口
- **钩子：** Bash 脚本，注册为生命周期钩子
- **桌面宠物：** 使用 Node.js canvas 生成像素艺术精灵图

## 许可证

MIT
