export type NotificationLocale = "zh-CN" | "en";

const copy = {
  "zh-CN": {
    title: "通知设置", intro: "只推送你选择的 Claude Code 和 Codex 事件。开启后，Bark 会先通知 iPhone；手表显示由 Apple 的通知规则决定。",
    master: "手表通知", masterHint: "总开关关闭时不会自动推送。应用退出后也不会继续推送。",
    connection: "连接 Bark", key: "Bark 设备密钥", keyPlaceholder: "粘贴设备密钥", saveKey: "保存密钥", deleteKey: "删除密钥", keySaved: "已保存到 macOS 钥匙串", keyMissing: "尚未保存密钥", test: "发送测试通知", testSending: "正在发送测试通知…", testPrerequisite: "请先开启手表通知并保存 Bark 密钥。", testSuccess: "测试通知已提交给 Bark", testFailure: "发送失败，请检查密钥与网络", testRejected: "Bark 拒绝了请求，请核对设备密钥（不要粘贴完整链接）。", testUnsent: "无法连接 Bark，请检查 Mac 网络。", testAmbiguous: "未收到 Bark 的确认，请查看手机后再重试。", saveFailure: "保存失败，请检查钥匙串", settingsFailure: "设置保存失败", noTypes: "当前没有选中的通知类型。",
    sources: "通知来源", claude: "Claude Code", codex: "Codex", hooksInstalled: "Hook 已安装", hooksMissing: "Hook 未安装，请在菜单栏安装", quotaAvailable: "额度可读取", quotaUnavailable: "额度暂不可用", sourceHint: "关闭一个来源会停止该来源的所有通知。",
    events: "工作事件", permission: "权限待批准", question: "问题待回答", completed: "本轮回复完成", error: "执行错误", eventHint: "“完成”表示当前一轮回复结束，继续工作时会取消这条提醒。", codexQuestionHint: "Codex 的部分界面内提问没有可观察 Hook，因此可能无法提醒。",
    quotas: "额度提醒", quotaHint: "按来源和额度周期分别提醒。首次开启只建立基线，不补发已经越过的档位。", at80: "剩余 80%", at50: "剩余 50%", at20: "剩余 20%", at0: "剩余 0%", recovered: "额度恢复", claudeQuota: "Claude 额度", codexQuota: "Codex 额度",
    serviceUnavailable: "通知服务暂不可用，桌宠仍可正常使用。", footer: "通知不包含提示词、项目路径、命令或错误原文。",
  },
  en: {
    title: "Notification Settings", intro: "Send only the Claude Code and Codex events you choose. Bark delivers to iPhone first; Apple decides whether the notification appears on your watch.",
    master: "Watch notifications", masterHint: "No automatic push is sent while this switch is off. Notifications also stop when the app exits.",
    connection: "Connect Bark", key: "Bark device key", keyPlaceholder: "Paste device key", saveKey: "Save key", deleteKey: "Delete key", keySaved: "Saved in macOS Keychain", keyMissing: "No key saved", test: "Send test notification", testSending: "Sending test notification…", testPrerequisite: "Turn on watch notifications and save a Bark key first.", testSuccess: "Test notification submitted to Bark", testFailure: "Send failed. Check your key and network.", testRejected: "Bark rejected the request. Check the device key (not the full URL).", testUnsent: "Could not connect to Bark. Check your Mac's network.", testAmbiguous: "Bark did not confirm delivery. Check your phone before retrying.", saveFailure: "Could not save to Keychain", settingsFailure: "Could not save settings", noTypes: "No notification types are selected.",
    sources: "Sources", claude: "Claude Code", codex: "Codex", hooksInstalled: "Hook installed", hooksMissing: "Hook not installed; install it from the menu bar", quotaAvailable: "Quota available", quotaUnavailable: "Quota unavailable", sourceHint: "Turning off a source stops all notifications from it.",
    events: "Work events", permission: "Permission approval needed", question: "Answer needed", completed: "Current turn completed", error: "Execution error", eventHint: "Completed means the current reply ended. A resumed turn cancels the alert.", codexQuestionHint: "Some questions inside Codex have no observable Hook, so they may not trigger an alert.",
    quotas: "Quota alerts", quotaHint: "Each source and quota period alerts separately. The first reading sets a baseline and does not backfill crossed levels.", at80: "80% remaining", at50: "50% remaining", at20: "20% remaining", at0: "0% remaining", recovered: "Quota recovered", claudeQuota: "Claude quota", codexQuota: "Codex quota",
    serviceUnavailable: "Notification service is unavailable. The desktop pet remains usable.", footer: "Notifications contain no prompts, project paths, commands, or raw error text.",
  },
} as const;

export type NotificationCopy = typeof copy["en"];
export function notificationCopy(locale: NotificationLocale): NotificationCopy { return copy[locale] as NotificationCopy; }
