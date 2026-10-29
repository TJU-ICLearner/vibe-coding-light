<div align="center">
  <img src="./logo.png" alt="Vibe Coding Light" width="120" />

  # Vibe Coding Light

  AI 编程助手的系统托盘状态指示灯，附带桌面宠物伴侣

  [English](./README.md) · [下载正式版](https://github.com/TJU-ICLearner/vibe-coding-light/releases/latest)

  <img src="./public/pet/bubu/default.gif" alt="内置桌宠布布" width="240" />
</div>

让你一眼就能看到 AI 编程助手正在做什么 —— 不需要一直盯着终端窗口。内置桌宠布布也会根据 Agent 的状态做出反应。

正式版 1.0.0 支持 **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** 和 **[OpenAI Codex CLI](https://github.com/openai/codex)**。当前开发分支还加入了 Cursor、TRAE、Grok Build 与 DeepSeek Harness 的可选 Hook 接入；后者需额外挂载官方桥接插件。

**当前正式版：1.0.0。** GitHub 上此前发布的版本均为开发测试版。因正式版重新编号，已安装测试版的用户请从[最新发布页](https://github.com/TJU-ICLearner/vibe-coding-light/releases/latest)手动下载 1.0.0；旧版的自动检查可能无法识别较小的新版本号。

## 目录

- [下载与安装](#安装)
- [首次使用](#首次使用)
- [状态指示灯](#状态指示灯)
- [桌面宠物与自定义素材](#桌面宠物)
- [Bark 手机与手表通知](#可选的手表通知)
- [常见问题](#常见问题)
- [数据与隐私](#工作原理)
- [从源码构建](#从源码构建)

## 安装

### 下载正式版

从[最新发布页](https://github.com/TJU-ICLearner/vibe-coding-light/releases/latest)按系统下载：

| 系统 | 安装包 | 安装方式 |
|---|---|---|
| macOS 12+（Apple Silicon） | [DMG](https://github.com/TJU-ICLearner/vibe-coding-light/releases/download/v1.0.0/Vibe.Coding.Light_1.0.0_aarch64.dmg) | 打开 DMG，将 **Vibe Coding Light.app** 拖入“应用程序”，再从“应用程序”启动。 |
| Windows 10+（x64） | [安装程序](https://github.com/TJU-ICLearner/vibe-coding-light/releases/download/v1.0.0/Vibe.Coding.Light_1.0.0_x64-setup.exe) | 运行 `-setup.exe`，按提示安装，再从开始菜单启动。 |
| Linux（amd64） | [AppImage](https://github.com/TJU-ICLearner/vibe-coding-light/releases/download/v1.0.0/Vibe.Coding.Light_1.0.0_amd64.AppImage) | 添加执行权限后运行；需要图形桌面与 WebKitGTK 4.1。 |

Linux 示例（在下载目录中执行）：

```bash
chmod +x Vibe.Coding.Light_1.0.0_amd64.AppImage
./Vibe.Coding.Light_1.0.0_amd64.AppImage
```

发布页还提供 [SHA256SUMS.txt](https://github.com/TJU-ICLearner/vibe-coding-light/releases/download/v1.0.0/SHA256SUMS.txt)。下载后可用 `shasum -a 256 <文件名>`（macOS）、`sha256sum <文件名>`（Linux）或 PowerShell 的 `Get-FileHash <文件名> -Algorithm SHA256`（Windows）计算安装包摘要，与清单中对应文件的值比较。
将 `<文件名>` 替换为实际下载的文件名；Windows PowerShell 中如文件名含空格，请用引号包住路径。

macOS 安装包使用 ad-hoc 签名，尚未通过 Apple Developer ID 签名或公证；首次打开可能需要在“系统设置 → 隐私与安全性”点击“仍要打开”。Windows 安装包尚未代码签名。Intel Mac 可从源码构建。Linux 需要可用的桌面环境与 WebKitGTK 4.1。

> **截图占位｜三平台安装：** 分别展示 macOS 应用、Windows 安装完成后的托盘图标、Linux AppImage 启动后的桌宠。请将素材放入 `docs/images/` 后替换本段。

更名后继续使用原有 `com.cuihuapeng.code-light` 应用标识和 `~/.code-light` 钩子数据目录，便于保留已有本地设置。

### 前提条件

- macOS 12+ / Linux 图形桌面 / Windows 10+
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

## 首次使用

1. **启动应用：** 菜单栏／系统托盘会出现灰色圆点，桌面显示默认布布。macOS 以菜单栏应用方式运行，不在 Dock 显示图标。
2. **打开控制界面：** macOS 左键点圆点打开可停留的控制弹窗，可以连续切换开关；点击外部或按 `Esc` 收起。macOS 右键点图标或 Windows／Linux 点击托盘图标，使用原生菜单。
3. **选择语言：** 在控制界面的“语言”中选择中文或英文，菜单、状态提示和设置页会同步切换。系统首次启动语言为中文时默认中文，其他语言默认英文。
4. **安装 Hook：** 使用 Claude Code 就选**设置 Claude 钩子**，使用 Codex CLI 就选**设置 Codex 钩子**；两者都用时两项都安装。菜单会显示安装结果。Windows 先准备 Git for Windows 的 Git Bash 与 Perl；Linux 先准备 Bash 与 Perl。
5. **重新启动 Agent 会话：** 在终端运行 Agent 并让它执行一次工具调用，状态灯应变绿，布布切换工作动画。旧会话可能需要重启后才能读取新 Hook。
6. **Codex 额外一步：** 在 Codex CLI 输入 `/hooks`，按 `t` 信任全部钩子，否则已安装的 Hook 仍可能不生效。

不使用 Bark 时，以上步骤已经足够。需要手机／手表提醒再打开[通知设置](#可选的手表通知)。

> **截图占位｜首次设置：** 展示菜单栏／托盘控制界面的语言和 Hook 安装入口，以及安装成功后的文字反馈。请隐藏私人项目名；将素材放入 `docs/images/` 后替换本段。

控制界面还有**“登录时启动”**、**“自动检查新版本”**两个可选开关，以及随时可用的**“检查新版本”**。自动检查最多每天一次；若 GitHub API 暂时不可用，应用会尝试 GitHub 发布订阅源。发现新版本后，点击菜单提示会打开本项目的 GitHub 发布页；应用不会自动下载安装。macOS 登录启动在 macOS 13+ 优先使用系统登录项，必要时使用用户级 LaunchAgent；请先将 App 放入“应用程序”。

## 状态指示灯

| 颜色 | 状态 | 说明 |
|:---:|---|---|
| 灰色 | 空闲 | 没有活跃会话 |
| 灰色 | 状态未知 | 连续 5 分钟没有事件；会话可能仍在运行 |
| 绿色（闪烁） | 工作中 | Agent 正在执行工具调用 |
| 黄色（闪烁） | 等待确认 | Claude Code 或 Codex 发出了权限确认或交互输入请求 |
| 红色（闪烁） | 出错 | 发生了错误 |
| 蓝色 | 已完成 | 本轮回复结束（显示约 10 秒后回到空闲状态） |

活跃状态（工作 / 等待 / 出错）每 500ms 闪烁一次，提醒你注意。托盘图标的提示文字会显示当前状态、活跃会话数和最后更新时间。

菜单栏的**“当前会话”**可查看最多 8 个近期会话，显示来源、项目名、状态和最近活动时间；不会展示任务、命令或错误原文。超过 5 分钟未活动的会话不会列在此菜单中。

同时运行多个会话时，图标显示优先级最高的状态：**出错 → 等待 → 工作 → 完成 → 状态未知 → 空闲**。例如一个会话仍在工作、另一个等待批准时，图标会显示黄色。灰色“状态未知”并不等于任务已经结束，可能只是暂时没有新的 Hook 事件。

**什么时候进入“等待”？** Claude Code 的权限提示或交互通知，以及 Codex 的 `PermissionRequest` 钩子会触发。无需审批的普通工作可以从“工作”直接进入“完成”，随后回到“休息”。应用不会推断所有等待用户自由回复的时刻。

“完成”指当前一轮回复结束，并不表示整个项目已经完成。后续工作事件会重新激活同一个会话；完成状态约显示 10 秒。

> **截图占位｜托盘状态：** 展示空闲、工作、等待、出错、完成五种颜色，以及展开后的当前会话菜单。建议使用一张拼图；请将素材放入 `docs/images/` 后替换本段。

## 桌面宠物

Vibe Coding Light 默认使用布布作为内置桌宠。新安装会直接显示布布；升级时，已选择的自定义桌宠仍保持选中。五张透明 GIF 保留原有逐帧动画，不叠加额外动效。

| 状态 | 动画 |
|:---:|---|
| 空闲 | 睡觉 |
| 工作中 | 在电脑前工作 |
| 等待确认 | 喝奶茶 |
| 出错 | 道歉 |
| 已完成 | 跳舞 |

> **演示图占位｜布布五种状态：** 展示布布在五种状态下的原始 GIF 动画，建议用横向拼图或短视频；请将素材放入 `docs/images/` 后替换本段。

**切换宠物显示：** 在托盘控制界面选择 **“显示桌宠”** 或 **“隐藏桌宠”**。macOS 左键点击菜单栏图标打开可停留的弹窗，可以连续操作多个开关；点击弹窗外或按 `Esc` 收起。macOS 右键点击可打开原生菜单。Windows／Linux 点击系统托盘图标打开原生菜单。

**切换界面语言：** 在托盘菜单中选择 **“语言 → 中文”** 或 **“语言 → 英文”**。菜单、状态提示、设置窗口标题和桌宠设置页会立即切换，重启后保留选择。首次启动时按系统首选语言选择：中文系统用中文，其他语言用英文。

宠物窗口始终置顶且可拖拽，你可以将它放在屏幕上的任何位置。在 macOS 13 及以上，桌宠也会尝试显示在其他应用的原生全屏空间中。
在菜单栏选择**“摸摸”**，或按 **⌘B**（Windows／Linux 为 **Ctrl+B**），会出现一只手轻轻摸桌宠两次。布布和自定义桌宠都支持。布布的部分原始 GIF 自带中文字；即使选择英文界面，这些画面文字仍保留原样。

### 用自己的图片制作桌宠

1. 打开托盘菜单，选择 **“自定义桌宠”**。
   桌宠窗口获得焦点时，macOS 也可以按 **⌘,**、Windows/Linux 按 **Ctrl+,** 打开设置。
2. 选择**单图：所有状态共用一张**；或选择**按状态：为不同状态设置素材**。按状态模式有必选的默认／休息素材，以及可选的工作、等待、出错和完成素材。宽窗口时预览固定在编辑区旁，窄窗口时预览排在编辑区前。未设置的状态会使用默认素材。切换模式会保留草稿；单图模式保存时只写入默认素材。
3. 每个位置可上传 PNG、JPEG 或已有透明背景的 GIF（单文件不超过 10 MiB，整套素材合计不超过 25 MiB）。macOS 14 及以上可为静态图片选择**自动去背景**；已有透明背景的 PNG 选**保留透明 PNG**。各桌面系统都可使用透明 PNG 或透明 GIF。GIF 须选**保留透明 GIF 动画**，不会逐帧抠图。静态图宽高均不超过 4096 像素；GIF 宽高均不超过 1024 像素，须有 2–120 帧。
4. 每张静态图都可单独选择动效：跟随状态、静止、左右摇摆、上下浮动、呼吸、弹跳或轻微晃动。GIF 保留自身逐帧动画，不叠加额外动效；缺少素材的状态沿用默认图片及其动效。
5. 预览各状态，设置 **1–64 字符**的名称和 **0.5–3 倍**大小，再点击**保存并使用**。桌宠窗口会随图片放大，预览旁显示实际窗口尺寸。仅预览不会更换当前桌宠。同一窗口的**我的桌宠**可以切换或删除已保存桌宠，也可恢复**默认布布**；内置布布不能删除。

静态素材在本地处理为 256×256 透明 PNG；GIF 保留原始动画数据。素材和设置都保存在本机，原图不会上传。旧版单图桌宠及其已保存的位置仍可使用；新桌宠居中显示，设置页不再提供水平、垂直偏移。Windows 和 Linux 也支持透明 PNG/GIF 自定义桌宠。

> **截图占位｜自定义桌宠：** 展示“单图／按状态”切换、素材预览、逐图动效与大小调节。建议同时展示一张透明 GIF 的预览；请将素材放入 `docs/images/` 后替换本段。

**选图建议：** 人物或物体轮廓清晰、主体位于画面中央的图片更容易得到完整预览。透明 GIF 需要素材本身已抠好背景；如果只找到不透明 GIF，可先在其他工具中处理，再导入这里。应用不会把原图上传到服务器。

## 可选的手表通知

**Bark 通知默认关闭。** 先在 iPhone 安装 Bark 并允许通知，再设置 Apple Watch 接收 Bark 通知。推送先到 iPhone；是否显示在手表上由 Apple 的通知规则决定。应用当前连接 Bark 官方服务器 `api.day.app`。

### 开启通知

1. 在菜单栏打开**通知设置 → 连接 Bark**。从 Bark 手机 App 的示例 URL 中，只复制域名后、下一个 `/` 前的**设备密钥**。例如 `https://api.day.app/<设备密钥>/title/body?group=example`，输入框只需 `<设备密钥>`，不含 `/title/body` 或参数。点击**保存密钥**，确认显示“已保存到系统凭据库”。请勿在截图或消息中公开密钥。
2. 开启顶部的**手表通知**总开关；在**通知来源**中选择 Claude Code 和／或 Codex。旁边若显示“Hook 未安装”，回到菜单安装对应 Hook，再重启 Agent 会话。
3. 在**工作事件**和**额度提醒**中选择真正需要的类型。各开关修改后自动保存。关闭某来源会停止该来源的所有通知；关闭总开关或退出应用后不会继续推送。升级时应用会更新之前由本应用安装的 Hook。
4. 按需要配置通知文案、详细内容和免打扰。正式版没有发送测试通知或模拟事件按钮；可以在**通知诊断记录**查看真实事件是否被观察到及发送结果。

### 接入其他编程助手

在**通知设置 → 通知来源**中，Cursor、TRAE、Grok Build 和 DeepSeek Harness 各有独立开关；新来源默认关闭。可在来源旁点击**安装 Hook**，也可在 macOS 菜单栏的**快捷控制 → 其他 Agent Hook**中安装。然后开启来源与所需工作事件，并重启对应客户端。安装只追加本应用的 Hook，不删除已有 Hook。状态、等待、完成、错误与 Bark 通知共用现有设置和免打扰规则；这些来源目前没有额度读取功能。

| 来源 | 安装位置 | 可观察事件 |
| --- | --- | --- |
| Cursor | `~/.cursor/hooks.json` | 工作、工具失败、回复完成；部分权限与问题不一定有独立 Hook |
| TRAE 中国版 | `~/.trae-cn/hooks.json` | 工作、完成、权限确认、问题通知、工具失败 |
| Grok Build CLI | `~/.grok/hooks/vibe-coding-light.json` | 工作、完成、权限拒绝、错误及通知 |
| DeepSeek Harness | `~/.code-light/hooks/deepseek/` | 官方 Codex Hook 桥接支持的工作、完成及工具失败 |

**DeepSeek Harness 需额外挂载桥接插件。** 点击“安装 Hook”会生成 `hooks.json` 与 `cordis.patch.yml`，但不会修改 Harness 的全局配置或安装插件。先为所用 Harness profile 安装官方 `@deepseek-ai/dsh-hooks-codex` 包，再将 `~/.code-light/hooks/deepseek/cordis.patch.yml` 的配置行加入该 profile 的补丁，或在启动时使用 `dsh --patch ~/.code-light/hooks/deepseek/cordis.patch.yml`。用 `dsh --dump-config` 确认 `vibe-coding-light-hooks` 已加载，并重启 Harness 会话。Harness 桌面版的 profile 与插件管理可能随预览版变化；请以其当前文档为准。

普通豆包客户端与 **Grok Bot** 目前没有供本应用读取工作状态的本地生命周期 Hook；这里的 TRAE 和 Grok Build 是不同产品。Cursor、TRAE、Grok Build 可读取其他客户端的兼容 Hook，本应用会尽量跳过因此产生的重复事件。若某客户端禁止自定义 Hook，通知诊断记录会没有对应事件。

### 工作事件和额度档位

| 开关 | 提醒条件与说明 |
|---|---|
| 权限待批准 | Agent 发出可观察的权限确认请求。 |
| 问题待回答 | Hook 捕获到交互问题；Codex 的部分界面内提问没有可观察 Hook，可能无法提醒。 |
| 本轮回复完成 | 当前一轮回复结束，不表示整个项目完成；继续工作时会取消待发的完成提醒。 |
| 执行错误 | Hook 记录到工具或命令执行失败。 |
| 剩余 80%、50%、20% | 可读取的额度跨过对应剩余档位时提醒。 |
| 其他周期剩余 0% | 非 7 天额度周期用尽时提醒。 |
| 7 天额度剩余 0% | 独立开关，专门提醒 7 天周期用尽。 |
| 额度恢复 | 观察到额度重新可用时提醒。 |

额度按 **Agent 来源和额度周期**分别提醒，通知会标明周期。首次读取只建立基线，不补发此前已越过的档位，因此刚开启开关时不一定立刻收到通知。Claude 和 Codex 的额度接口可能因客户端版本或登录方式而不可用；设置页分别显示“额度可读取／额度暂不可用”。

### 自定义标题和正文

在**通知文案**中选择事件，分别填写标题和正文；留空即使用该类型的默认文案。中文和英文文案分开保存，切换界面语言后可以分别编辑；**恢复此类默认文案**只清除当前类型的自定义内容。示例预览使用虚构内容，不读取真实任务。标题最多 120 字，正文最多 2000 字。

| 变量 | 插入内容 |
|---|---|
| `{source}` | Claude Code 或 Codex。 |
| `{detail}` | 与事件相关的简要详细内容。 |
| `{task}`、`{command}` | 当前任务、命令原文（可用时）。 |
| `{error}`、`{reply}`、`{question}` | 错误、回复、问题原文（可用时）。 |
| `{period}`、`{remaining}` | 额度周期和剩余比例。 |

**“包含详细内容”默认关闭。** 关闭时，任务、命令、错误和回复原文不会写入通知事件文件，也不会发给 Bark；对应变量为空。打开后可发送相关原文，每项最多取前 1000 字；这些内容可能包含密钥或私人信息，请按需开启。两个“剩余 0%”开关共用通知文案，使用 `{period}` 区分周期。

### 免打扰与通知诊断

免打扰默认关闭，初始时段为本机时间 **22:00–08:00**。开启后，权限确认、提问和错误默认仍发送；在**以下通知仍然发送**中可逐项调整，也可为额度提醒设置例外。被静音的消息不会在时段结束后补发。

**通知诊断记录**仅在本机保存最近 100 条事件的来源、类型、时间和结果；不保存通知正文、任务／命令／错误原文或 Bark 密钥，可随时清空。没有收到消息时，先看记录中的原因，例如“该来源已关闭”“该类型已关闭”“免打扰时段”“未保存 Bark 密钥”“网络连接失败”。“已提交给 Bark”表示 Bark 接收了请求，手表最终是否显示仍由 Apple 的通知设置决定。

> **截图占位｜Bark 通知设置：** 展示总开关、设备密钥保存状态、来源／事件／额度开关、免打扰和诊断记录。建议另放一张通知文案与示例预览的截图；截图前隐藏 Bark 设备密钥与私人任务内容。素材放入 `docs/images/` 后替换本段。

## 常见问题

### 安装 Hook 后，托盘仍一直是灰色

确认安装了当前 Agent 对应的 Hook，并**重新启动一个 Agent 会话**，让 Agent 执行工具调用。Codex CLI 还需运行 `/hooks` 并按 `t` 信任。Windows 检查 Git Bash 与 Perl，Linux 检查 Bash 与 Perl；缺少依赖时菜单会显示安装失败。仍无事件时，可查看本机 `~/.code-light/sessions/` 是否出现新的 JSON 状态文件。

### 为什么很少出现“等待”？

只有权限确认或 Hook 能观察到的交互请求才会触发“等待”。没有审批的任务通常从工作直接进入完成。部分 Codex 界面内提问没有可观察 Hook，也不会触发问题通知。

### Bark 没有到达手机或手表

先在**通知诊断记录**查看该事件被跳过或发送失败的原因，再核对总开关、来源、事件、Hook 安装状态及设备密钥。密钥只填写测试链接域名后的第一段，不含 `/title/body`。若显示“已提交给 Bark”但手表没收到，请检查 iPhone Bark 和 Apple Watch 的通知设置。额度提醒还需要显示“额度可读取”，并等待新的档位变化；首次读取不会补发旧档位。

### Windows／Linux 与 macOS 有什么区别？

三平台均支持状态灯、Claude/Codex Hook、布布与自定义透明 PNG/GIF 桌宠、Bark 通知、语言切换和版本检查。**静态图自动去背景目前只在 macOS 14+ 提供**。Windows Hook 需要 Git for Windows 的 Git Bash 与 Perl；Linux Hook 需要 Bash 与 Perl，Bark 密钥保存还需要运行中的 Secret Service（例如 GNOME Keyring 或 KWallet）。Linux AppImage 需在有 WebKitGTK 4.1 的图形桌面上运行。

### macOS 提示"已损坏"或"无法打开"

先从发布页重新下载，并对照同页的 `SHA256SUMS.txt` 核对 DMG 摘要。确认文件完整且来源可信后，将应用拖入“应用程序”，尝试在“系统设置 → 隐私与安全性”点击“仍要打开”。如果仍提示“已损坏”，可在终端只移除这个应用的隔离属性：

```bash
xattr -cr "/Applications/Vibe Coding Light.app"
```

然后重新打开应用。不要对来源或校验结果不明的文件执行此命令。

### 多会话支持

在不同终端同时运行 Claude Code 和／或 Codex 时，应用会追踪所有活跃会话，并以优先级最高的状态决定托盘颜色。“当前会话”显示最多 8 个近期会话，可用来确认哪个项目还在工作。

### 自动清理

- 连续 5 分钟没有事件的会话显示“状态未知”，状态文件在 24 小时后清理
- 只有 `Stop` 钩子报告完成，同一会话的后续事件可以重新激活状态
- "完成"状态在 10 秒显示窗口后自动清理

## 工作原理

Vibe Coding Light 使用基于文件的轮询机制：

1. **Shell 脚本**作为生命周期钩子注册到 Claude Code（`~/.claude/settings.json`）和 Codex（`~/.codex/hooks.json`）
2. 每个钩子将 JSON 状态文件写入 `~/.code-light/sessions/<会话ID>.json`
3. 托盘应用每秒轮询这些文件，并更新图标

```
Agent 事件 → 钩子脚本 → ~/.code-light/sessions/*.json → 托盘图标
```

状态指示灯不开放网络端口。只有主动开启 Bark 通知后，应用才向 Bark 发送所选事件的简短通知；手动检查版本或开启每天检查后，应用会访问本项目的 GitHub Releases API。

自定义桌宠素材与设置保存在本机应用数据目录，Bark 设备密钥保存在系统凭据库。通知诊断记录也只在本机保存最近 100 条元数据。是否将任务、命令、错误、回复原文放进 Bark 通知，由**包含详细内容**开关决定，默认关闭。

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
│   │   ├── post-tool-use.sh         # 工具调用后事件
│   │   ├── post-tool-use-failure.sh # → 出错
│   │   ├── notification.sh          # → 等待确认（权限提示时）
│   │   ├── user-prompt-submit.sh    # 用户提交提示
│   │   └── stop.sh                  # → 已完成
│   └── codex/                       # Codex CLI 钩子脚本
│       ├── _helpers.sh              # 公共函数（从 stdin JSON 提取会话 ID）
│       ├── session_start.sh         # → 工作中
│       ├── pre_tool_use.sh          # → 工作中
│       ├── permission_request.sh    # → 等待确认
│       ├── post_tool_use.sh         # → 工作中
│       ├── user_prompt_submit.sh    # → 工作中
│       └── stop.sh                  # → 已完成
├── public/pet/
│   └── bubu/                        # 内置布布的五张状态 GIF
├── src-tauri/                       # Tauri v2 / Rust 后端
│   ├── src/
│   │   ├── main.rs                  # 入口
│   │   ├── lib.rs                   # 托盘、轮询、Hook 注册与窗口
│   │   └── notifications/           # Bark、额度、免打扰与诊断
│   ├── icons/status/                # 状态指示灯图标（灰、绿、黄、红、蓝）
│   └── tauri.conf.json              # Tauri 配置
├── src/                             # 托盘弹窗、桌宠与设置页前端
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
- **桌面宠物：** 内置布布透明 GIF；自定义静态图、透明 PNG／GIF 的本地预览与渲染

## 许可证

MIT
