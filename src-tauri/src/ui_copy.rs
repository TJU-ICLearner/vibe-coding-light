use crate::notifications::bark::PushPayload;
use crate::notifications::model::{AgentSource, NotificationSettings, PushCandidate, PushKind};
use crate::ui_locale::AppLocale;
use crate::{SessionSource, SessionSummary, State};

pub fn session_menu_title(locale: AppLocale) -> &'static str {
    match locale {
        AppLocale::ZhCn => "当前会话",
        AppLocale::En => "Sessions",
    }
}

pub fn session_menu_empty(locale: AppLocale) -> &'static str {
    match locale {
        AppLocale::ZhCn => "暂无活动会话",
        AppLocale::En => "No active sessions",
    }
}

pub fn session_menu_item(locale: AppLocale, item: &SessionSummary, now: u64) -> String {
    let source = match item.source {
        SessionSource::Claude => "Claude",
        SessionSource::Codex => "Codex",
        SessionSource::Cursor => "Cursor",
        SessionSource::Trae => "TRAE",
        SessionSource::Grok => "Grok Build",
        SessionSource::Deepseek => "DeepSeek Harness",
    };
    let state = match (locale, item.state) {
        (AppLocale::ZhCn, State::Working) => "工作中",
        (AppLocale::ZhCn, State::Waiting) => "等待确认",
        (AppLocale::ZhCn, State::Error) => "出错",
        (AppLocale::ZhCn, State::Completed) => "完成",
        (AppLocale::En, State::Working) => "Working",
        (AppLocale::En, State::Waiting) => "Waiting",
        (AppLocale::En, State::Error) => "Error",
        (AppLocale::En, State::Completed) => "Completed",
        _ => "—",
    };
    let minutes = now.saturating_sub(item.last_activity) / 60;
    let ago = match locale {
        AppLocale::ZhCn if minutes == 0 => "刚刚".into(),
        AppLocale::ZhCn => format!("{minutes} 分钟前"),
        AppLocale::En if minutes == 0 => "now".into(),
        AppLocale::En => format!("{minutes}m ago"),
    };
    format!("{source} · {} · {state} · {ago}", item.project)
}

pub fn login_item_label(
    locale: AppLocale,
    pending_approval: bool,
    failed: bool,
    needs_install: bool,
) -> &'static str {
    match (locale, pending_approval, failed, needs_install) {
        (AppLocale::ZhCn, _, _, true) => "请先将 App 移至应用程序",
        (AppLocale::ZhCn, _, true, _) => "登录启动设置失败",
        (AppLocale::ZhCn, true, _, _) => "登录时启动（请在系统设置批准）",
        (AppLocale::ZhCn, _, _, _) => "登录时启动",
        (AppLocale::En, _, _, true) => "Move the app to Applications first",
        (AppLocale::En, _, true, _) => "Launch at login failed",
        (AppLocale::En, true, _, _) => "Launch at login (approve in System Settings)",
        (AppLocale::En, _, _, _) => "Launch at login",
    }
}

pub fn automatic_update_label(locale: AppLocale) -> &'static str {
    match locale {
        AppLocale::ZhCn => "自动检查新版本",
        AppLocale::En => "Automatically check for updates",
    }
}

pub fn update_check_label(
    locale: AppLocale,
    checking: bool,
    failed: bool,
    current: bool,
) -> &'static str {
    match (locale, checking, failed, current) {
        (AppLocale::ZhCn, true, _, _) => "正在检查新版本…",
        (AppLocale::ZhCn, _, true, _) => "检查失败，点击重试",
        (AppLocale::ZhCn, _, _, true) => "当前已是最新版本 · 点击重新检查",
        (AppLocale::ZhCn, _, _, _) => "检查新版本",
        (AppLocale::En, true, _, _) => "Checking for updates…",
        (AppLocale::En, _, true, _) => "Check failed — retry",
        (AppLocale::En, _, _, true) => "Up to date · Check again",
        (AppLocale::En, _, _, _) => "Check for updates",
    }
}

pub fn release_label(locale: AppLocale, version: Option<&str>, checked: bool) -> String {
    match (locale, version, checked) {
        (AppLocale::ZhCn, Some(v), _) => format!("有新版本 {v} · 打开下载页"),
        (AppLocale::En, Some(v), _) => format!("Version {v} available · Open release"),
        (AppLocale::ZhCn, None, true) => "当前已是最新版本".into(),
        (AppLocale::En, None, true) => "You're up to date".into(),
        (AppLocale::ZhCn, None, false) => "尚未检查版本".into(),
        (AppLocale::En, None, false) => "No update check yet".into(),
    }
}

#[derive(Clone)]
pub enum HookFeedback {
    Initial,
    Installed,
    Failed(String),
}

pub struct MenuLabels {
    pub toggle_pet: String,
    pub pet_action: String,
    pub customize_pet: String,
    pub notification_settings: String,
    pub setup_claude: String,
    pub setup_codex: String,
    pub claude_hooks: String,
    pub codex_hooks: String,
    pub language: String,
    pub chinese: String,
    pub english: String,
    pub quit: String,
}

fn hook_label(locale: AppLocale, agent: &str, feedback: &HookFeedback) -> String {
    match (locale, feedback) {
        (AppLocale::ZhCn, HookFeedback::Initial) => format!("设置 {agent} 钩子"),
        (AppLocale::ZhCn, HookFeedback::Installed) => format!("{agent} 钩子：已安装"),
        (AppLocale::ZhCn, HookFeedback::Failed(detail)) => {
            format!("{agent} 钩子：安装失败（{detail}）")
        }
        (AppLocale::En, HookFeedback::Initial) => format!("Setup {agent} Hooks"),
        (AppLocale::En, HookFeedback::Installed) => format!("{agent} hooks: installed"),
        (AppLocale::En, HookFeedback::Failed(detail)) => {
            format!("{agent} hooks: failed ({detail})")
        }
    }
}

pub fn menu_labels(
    locale: AppLocale,
    pet_visible: bool,
    claude: &HookFeedback,
    codex: &HookFeedback,
) -> MenuLabels {
    let (
        toggle_pet,
        pet_action,
        customize_pet,
        notification_settings,
        language,
        chinese,
        english,
        quit,
    ) = match locale {
        AppLocale::ZhCn => (
            if pet_visible {
                "隐藏桌宠"
            } else {
                "显示桌宠"
            },
            "摸摸  ⌘B",
            "自定义桌宠",
            "通知设置",
            "语言",
            "中文",
            "英文",
            "退出 Vibe Coding Light",
        ),
        AppLocale::En => (
            if pet_visible { "Hide Pet" } else { "Show Pet" },
            "Pet the Pet  ⌘B",
            "Customize Pet",
            "Notification Settings",
            "Language",
            "Chinese",
            "English",
            "Quit Vibe Coding Light",
        ),
    };
    MenuLabels {
        toggle_pet: toggle_pet.into(),
        pet_action: pet_action.into(),
        customize_pet: customize_pet.into(),
        notification_settings: notification_settings.into(),
        setup_claude: hook_label(locale, "Claude", &HookFeedback::Initial),
        setup_codex: hook_label(locale, "Codex", &HookFeedback::Initial),
        claude_hooks: hook_label(locale, "Claude", claude),
        codex_hooks: hook_label(locale, "Codex", codex),
        language: language.into(),
        chinese: chinese.into(),
        english: english.into(),
        quit: quit.into(),
    }
}

pub fn settings_title(locale: AppLocale) -> &'static str {
    match locale {
        AppLocale::ZhCn => "自定义桌宠 · Vibe Coding Light",
        AppLocale::En => "Customize Pet · Vibe Coding Light",
    }
}

pub fn notification_settings_title(locale: AppLocale) -> &'static str {
    match locale {
        AppLocale::ZhCn => "通知设置 · Vibe Coding Light",
        AppLocale::En => "Notification Settings · Vibe Coding Light",
    }
}

pub fn test_notification(locale: AppLocale) -> PushPayload {
    PushPayload {
        title: "Vibe Coding Light".into(),
        body: match locale {
            AppLocale::ZhCn => "测试通知：连接正常",
            AppLocale::En => "Test notification: connection works",
        }
        .into(),
        group: "Vibe Coding Light".into(),
    }
}

pub fn notification_payload(candidate: &PushCandidate, locale: AppLocale) -> PushPayload {
    let source = candidate.source.label();
    let body = match (&candidate.kind, locale) {
        (PushKind::Permission, AppLocale::ZhCn) => format!("{source} · 等待权限批准"),
        (PushKind::Permission, AppLocale::En) => format!("{source} · Permission approval needed"),
        (PushKind::Question, AppLocale::ZhCn) => format!("{source} · 等待回答问题"),
        (PushKind::Question, AppLocale::En) => format!("{source} · Answer needed"),
        (PushKind::Completed, AppLocale::ZhCn) => format!("{source} · 本轮回复完成"),
        (PushKind::Completed, AppLocale::En) => format!("{source} · Current turn completed"),
        (PushKind::Error, AppLocale::ZhCn) => format!("{source} · 执行遇到错误"),
        (PushKind::Error, AppLocale::En) => format!("{source} · Execution encountered an error"),
        (PushKind::QuotaThreshold(_), _) => {
            let period = quota_period(candidate, locale);
            let remaining = candidate.remaining_percent.unwrap_or(0.0);
            let amount = if remaining.fract() == 0.0 {
                format!("{remaining:.0}")
            } else {
                format!("{remaining:.1}")
            };
            match locale {
                AppLocale::ZhCn => format!("{source} · {period}额度剩余 {amount}%"),
                AppLocale::En => format!("{source} · {period} quota {amount}% remaining"),
            }
        }
        (PushKind::QuotaRecovered, _) => {
            let period = quota_period(candidate, locale);
            match locale {
                AppLocale::ZhCn => format!("{source} · {period}额度已恢复"),
                AppLocale::En => format!("{source} · {period} quota recovered"),
            }
        }
        (PushKind::Test, _) => return test_notification(locale),
    };
    PushPayload {
        title: "Vibe Coding Light".into(),
        body,
        group: "Vibe Coding Light".into(),
    }
}

pub fn notification_payload_with_settings(
    candidate: &PushCandidate,
    locale: AppLocale,
    settings: &NotificationSettings,
) -> PushPayload {
    let mut payload = notification_payload(candidate, locale);
    if candidate.kind == PushKind::Test {
        return payload;
    }
    let kind = match candidate.kind {
        PushKind::Permission => "permission",
        PushKind::Question => "question",
        PushKind::Completed => "completed",
        PushKind::Error => "error",
        PushKind::QuotaThreshold(80) => "quota80",
        PushKind::QuotaThreshold(50) => "quota50",
        PushKind::QuotaThreshold(20) => "quota20",
        PushKind::QuotaThreshold(0) => "quota0",
        PushKind::QuotaThreshold(_) => "quota20",
        PushKind::QuotaRecovered => "recovered",
        PushKind::Test => unreachable!(),
    };
    let locale_key = match locale {
        AppLocale::ZhCn => "zh-CN",
        AppLocale::En => "en",
    };
    let key = format!("{locale_key}.{kind}");
    let template = settings.templates.get(&key);
    let detail = if settings.include_details {
        match candidate.kind {
            PushKind::Permission => candidate
                .details
                .command
                .as_deref()
                .or(candidate.details.task.as_deref()),
            PushKind::Question => candidate
                .details
                .question
                .as_deref()
                .or(candidate.details.task.as_deref()),
            PushKind::Completed => candidate
                .details
                .task
                .as_deref()
                .or(candidate.details.reply.as_deref()),
            PushKind::Error => candidate
                .details
                .error
                .as_deref()
                .or(candidate.details.command.as_deref()),
            _ => None,
        }
    } else {
        None
    }
    .unwrap_or("");
    if template.is_none_or(|value| value.body.trim().is_empty()) && !detail.is_empty() {
        payload.body.push('\n');
        payload.body.push_str(detail);
    }
    let title = template
        .filter(|value| !value.title.trim().is_empty())
        .map(|value| value.title.as_str())
        .unwrap_or(&payload.title);
    let body = template
        .filter(|value| !value.body.trim().is_empty())
        .map(|value| value.body.as_str())
        .unwrap_or(&payload.body);
    let source = candidate.source.label();
    let remaining = candidate
        .remaining_percent
        .map(|value| {
            if value.fract() == 0.0 {
                format!("{value:.0}%")
            } else {
                format!("{value:.1}%")
            }
        })
        .unwrap_or_default();
    let period = if matches!(
        candidate.kind,
        PushKind::QuotaThreshold(_) | PushKind::QuotaRecovered
    ) {
        quota_period(candidate, locale)
    } else {
        String::new()
    };
    let raw = |value: &Option<String>| {
        if settings.include_details {
            value.as_deref().unwrap_or("").to_string()
        } else {
            String::new()
        }
    };
    let variables = [
        ("{source}", source.to_string()),
        ("{task}", raw(&candidate.details.task)),
        ("{command}", raw(&candidate.details.command)),
        ("{error}", raw(&candidate.details.error)),
        ("{reply}", raw(&candidate.details.reply)),
        ("{question}", raw(&candidate.details.question)),
        ("{detail}", detail.to_string()),
        ("{period}", period),
        ("{remaining}", remaining),
    ];
    let render = |input: &str| {
        let mut output = String::new();
        let mut rest = input;
        while let Some(start) = rest.find('{') {
            output.push_str(&rest[..start]);
            let tail = &rest[start..];
            let Some(end) = tail.find('}') else {
                rest = tail;
                break;
            };
            let token = &tail[..=end];
            if let Some((_, value)) = variables.iter().find(|(name, _)| *name == token) {
                output.push_str(value);
            } else {
                output.push_str(token);
            }
            rest = &tail[end + 1..];
        }
        output.push_str(rest);
        output
    };
    PushPayload {
        title: render(title),
        body: render(body),
        group: payload.group,
    }
}

fn quota_period(candidate: &PushCandidate, locale: AppLocale) -> String {
    let label = candidate.label.as_deref().unwrap_or_default();
    let parts: Vec<&str> = label.split('·').map(str::trim).collect();
    let minutes = parts
        .last()
        .and_then(|value| value.strip_suffix(" min"))
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let period = match (minutes, locale) {
        (300, AppLocale::ZhCn) => "5 小时".into(),
        (300, AppLocale::En) => "5 hours".into(),
        (10080, AppLocale::ZhCn) => "7 天".into(),
        (10080, AppLocale::En) => "7 days".into(),
        (value, AppLocale::ZhCn) if value >= 60 && value % 60 == 0 => {
            format!("{} 小时", value / 60)
        }
        (value, AppLocale::En) if value >= 60 && value % 60 == 0 => format!("{} hours", value / 60),
        (value, AppLocale::ZhCn) => format!("{value} 分钟"),
        (value, AppLocale::En) => format!("{value} min"),
    };
    if candidate.source == AgentSource::Codex && parts.len() > 1 {
        let bucket = parts[0].chars().take(40).collect::<String>();
        format!("{bucket} · {period}")
    } else {
        period
    }
}

fn known_message(locale: AppLocale, message: &str) -> String {
    if locale == AppLocale::En {
        return message.to_string();
    }
    match message {
        "No recent agent event" => "无近期代理事件".into(),
        "Waiting for confirmation" => "等待确认".into(),
        "Waiting for approval" => "等待批准".into(),
        "Waiting for user input" => "等待用户输入".into(),
        "Task finished" => "任务已完成".into(),
        "Tool execution failed" => "工具执行失败".into(),
        "User prompt submitted" => "已提交用户指令".into(),
        "Session started" => "会话已开始".into(),
        _ => {
            for (prefix, translated) in [
                ("Editing notebook ", "编辑笔记本 "),
                ("Reading ", "读取 "),
                ("Editing ", "编辑 "),
                ("Writing ", "写入 "),
                ("Running: ", "运行："),
                ("Searching: ", "搜索："),
                ("Agent: ", "代理："),
                ("Using ", "使用 "),
                ("Finished: ", "已完成："),
            ] {
                if let Some(value) = message.strip_prefix(prefix) {
                    return format!("{translated}{value}");
                }
            }
            if let Some(tool) = message.strip_suffix(" failed") {
                return format!("{tool} 执行失败");
            }
            message.to_string()
        }
    }
}

pub fn status_text(
    locale: AppLocale,
    state: State,
    message: &str,
    timestamp: u64,
    count: usize,
) -> String {
    let label = match (locale, state) {
        (AppLocale::ZhCn, State::Working) => "工作中",
        (AppLocale::ZhCn, State::Waiting) => "等待确认",
        (AppLocale::ZhCn, State::Error) => "出错",
        (AppLocale::ZhCn, State::Completed) => "任务完成",
        (AppLocale::ZhCn, State::Unknown) => "状态未知",
        (AppLocale::ZhCn, State::Idle) => "休息中",
        (AppLocale::En, State::Working) => "Working",
        (AppLocale::En, State::Waiting) => "Waiting for confirmation",
        (AppLocale::En, State::Error) => "Error",
        (AppLocale::En, State::Completed) => "Task completed",
        (AppLocale::En, State::Unknown) => "Status unknown",
        (AppLocale::En, State::Idle) => "Idle",
    };
    let mut parts = vec![format!("Vibe Coding Light: {label}")];
    if count > 1 {
        parts.push(match locale {
            AppLocale::ZhCn => format!("({count} 个会话)"),
            AppLocale::En => format!("({count} sessions)"),
        });
    }
    if !message.is_empty() {
        parts.push(known_message(locale, message));
    }
    if timestamp > 0 {
        let delta = crate::now_secs().saturating_sub(timestamp);
        let time = match locale {
            AppLocale::ZhCn if delta < 60 => format!("{delta} 秒前"),
            AppLocale::ZhCn if delta < 3600 => format!("{} 分钟前", delta / 60),
            AppLocale::ZhCn => format!("{} 小时前", delta / 3600),
            AppLocale::En if delta < 60 => format!("{delta}s ago"),
            AppLocale::En if delta < 3600 => format!("{}m ago", delta / 60),
            AppLocale::En => format!("{}h ago", delta / 3600),
        };
        parts.push(time);
    }
    parts.join(" | ")
}

#[cfg(test)]
mod tests {
    use super::{menu_labels, settings_title, status_text, HookFeedback};
    use crate::ui_locale::AppLocale;
    use crate::State;

    #[test]
    fn session_menu_labels_localize_status_and_elapsed_time_without_raw_message() {
        use crate::{SessionSource, SessionSummary};
        let item = SessionSummary {
            source: SessionSource::Claude,
            project: "demo".into(),
            state: State::Waiting,
            last_activity: 1_000,
        };
        assert_eq!(super::session_menu_title(AppLocale::ZhCn), "当前会话");
        assert_eq!(super::session_menu_title(AppLocale::En), "Sessions");
        assert!(
            super::session_menu_item(AppLocale::ZhCn, &item, 1_120).contains("等待确认 · 2 分钟前")
        );
        assert!(super::session_menu_item(AppLocale::En, &item, 1_120).contains("Waiting · 2m ago"));
        assert_eq!(super::session_menu_empty(AppLocale::ZhCn), "暂无活动会话");
    }

    #[test]
    fn update_and_login_menu_copy_follows_locale() {
        assert!(super::login_item_label(AppLocale::ZhCn, true, false, false).contains("系统设置"));
        assert!(
            super::login_item_label(AppLocale::En, true, false, false).contains("System Settings")
        );
        assert_eq!(
            super::login_item_label(AppLocale::ZhCn, false, true, true),
            "请先将 App 移至应用程序"
        );
        assert_eq!(
            super::automatic_update_label(AppLocale::ZhCn),
            "自动检查新版本"
        );
        assert_eq!(
            super::update_check_label(AppLocale::En, false, true, false),
            "Check failed — retry"
        );
        assert!(super::release_label(AppLocale::ZhCn, Some("1.7.0"), true).contains("1.7.0"));
        assert_eq!(
            super::automatic_update_label(AppLocale::ZhCn),
            "自动检查新版本"
        );
        assert_eq!(
            super::update_check_label(AppLocale::ZhCn, false, false, true),
            "当前已是最新版本 · 点击重新检查"
        );
    }

    #[test]
    fn notification_copy_uses_current_locale_and_period() {
        use crate::notifications::model::{AgentSource, PushCandidate, PushKind};
        let candidate = PushCandidate {
            id: "x".into(),
            source: AgentSource::Codex,
            kind: PushKind::QuotaThreshold(20),
            label: Some("Coding primary · 300 min".into()),
            quota_duration_mins: Some(300),
            remaining_percent: Some(19.5),
            details: Default::default(),
            due_at_ms: 1,
            expires_at_ms: 2,
        };
        let zh = super::notification_payload(&candidate, AppLocale::ZhCn);
        let en = super::notification_payload(&candidate, AppLocale::En);
        assert!(zh.body.contains("5 小时"));
        assert!(zh.body.contains("19.5%"));
        assert!(en.body.contains("5 hours"));
        assert!(en.body.contains("19.5%"));
        assert!(!en.body.contains("额度"));
        assert_ne!(
            super::test_notification(AppLocale::ZhCn).body,
            super::test_notification(AppLocale::En).body
        );
    }

    #[test]
    fn custom_permission_template_renders_task_and_command_only_with_detail_opt_in() {
        use crate::notifications::model::{
            AgentSource, EventDetails, NotificationSettings, NotificationTemplate, PushCandidate,
            PushKind,
        };
        let candidate = PushCandidate {
            id: "permission-1".into(),
            source: AgentSource::Codex,
            kind: PushKind::Permission,
            label: None,
            quota_duration_mins: None,
            remaining_percent: None,
            details: EventDetails {
                task: Some("修复登录".into()),
                command: Some("npm test".into()),
                ..Default::default()
            },
            due_at_ms: 1,
            expires_at_ms: 2,
        };
        let mut settings = NotificationSettings::default();
        settings.templates.insert(
            "zh-CN.permission".into(),
            NotificationTemplate {
                title: "{source} 需批准".into(),
                body: "任务：{task}\n命令：{command}".into(),
            },
        );
        let private =
            super::notification_payload_with_settings(&candidate, AppLocale::ZhCn, &settings);
        assert_eq!(private.title, "Codex 需批准");
        assert!(!private.body.contains("修复登录"));
        assert!(!private.body.contains("npm test"));

        settings.include_details = true;
        let detailed =
            super::notification_payload_with_settings(&candidate, AppLocale::ZhCn, &settings);
        assert_eq!(detailed.body, "任务：修复登录\n命令：npm test");
    }

    #[test]
    fn default_error_message_includes_raw_error_only_after_detail_opt_in() {
        use crate::notifications::model::{
            AgentSource, EventDetails, NotificationSettings, PushCandidate, PushKind,
        };
        let candidate = PushCandidate {
            id: "error-1".into(),
            source: AgentSource::Claude,
            kind: PushKind::Error,
            label: None,
            quota_duration_mins: None,
            remaining_percent: None,
            details: EventDetails {
                error: Some("Exit code 1: missing module".into()),
                ..Default::default()
            },
            due_at_ms: 1,
            expires_at_ms: 2,
        };
        let mut settings = NotificationSettings::default();
        assert_eq!(
            super::notification_payload_with_settings(&candidate, AppLocale::En, &settings).body,
            "Claude · Execution encountered an error"
        );
        settings.include_details = true;
        assert!(
            super::notification_payload_with_settings(&candidate, AppLocale::En, &settings)
                .body
                .contains("Exit code 1: missing module")
        );
    }

    #[test]
    fn inserted_raw_text_is_not_parsed_as_another_template_variable() {
        use crate::notifications::model::{
            AgentSource, EventDetails, NotificationSettings, NotificationTemplate, PushCandidate,
            PushKind,
        };
        let candidate = PushCandidate {
            id: "permission-2".into(),
            source: AgentSource::Codex,
            kind: PushKind::Permission,
            label: None,
            quota_duration_mins: None,
            remaining_percent: None,
            details: EventDetails {
                task: Some("Print {command} literally".into()),
                command: Some("secret".into()),
                ..Default::default()
            },
            due_at_ms: 1,
            expires_at_ms: 2,
        };
        let mut settings = NotificationSettings::default();
        settings.include_details = true;
        settings.templates.insert(
            "en.permission".into(),
            NotificationTemplate {
                title: "Test".into(),
                body: "{task}".into(),
            },
        );
        assert_eq!(
            super::notification_payload_with_settings(&candidate, AppLocale::En, &settings).body,
            "Print {command} literally"
        );
    }

    #[test]
    fn menu_labels_follow_locale_and_feedback() {
        let en = menu_labels(
            AppLocale::En,
            true,
            &HookFeedback::Initial,
            &HookFeedback::Installed,
        );
        assert_eq!(en.toggle_pet, "Hide Pet");
        assert_eq!(en.language, "Language");
        assert_eq!(en.chinese, "Chinese");
        assert_eq!(en.english, "English");
        assert_eq!(en.codex_hooks, "Codex hooks: installed");
        assert_eq!(en.pet_action, "Pet the Pet  ⌘B");
        let zh = menu_labels(
            AppLocale::ZhCn,
            false,
            &HookFeedback::Failed("disk".into()),
            &HookFeedback::Initial,
        );
        assert_eq!(zh.toggle_pet, "显示桌宠");
        assert_eq!(zh.language, "语言");
        assert_eq!(zh.chinese, "中文");
        assert_eq!(zh.english, "英文");
        assert_eq!(zh.claude_hooks, "Claude 钩子：安装失败（disk）");
        assert_eq!(zh.pet_action, "摸摸  ⌘B");
        assert!(settings_title(AppLocale::ZhCn).contains("桌宠"));
        assert!(!settings_title(AppLocale::En).contains("桌宠"));
    }

    #[test]
    fn status_text_translates_fixed_copy() {
        let ts = crate::now_secs() - 120;
        let zh = status_text(
            AppLocale::ZhCn,
            State::Waiting,
            "No recent agent event",
            ts,
            2,
        );
        assert!(zh.contains("等待确认"));
        assert!(zh.contains("2 个会话"));
        assert!(zh.contains("无近期代理事件"));
        assert!(zh.contains("2 分钟前"));
        let en = status_text(AppLocale::En, State::Completed, "用户写的原文", ts, 2);
        assert!(en.contains("Task completed"));
        assert!(en.contains("2 sessions"));
        assert!(en.contains("2m ago"));
        assert!(en.contains("用户写的原文"));
    }

    #[test]
    fn status_text_translates_hook_action_without_changing_user_values() {
        let text = status_text(AppLocale::ZhCn, State::Working, "Reading 设计稿.md", 0, 1);
        assert!(text.contains("读取 设计稿.md"));
        assert!(!text.contains("Reading"));
        let text = status_text(AppLocale::ZhCn, State::Working, "Running: echo hello", 0, 1);
        assert!(text.contains("运行：echo hello"));
        let text = status_text(AppLocale::En, State::Working, "Reading 设计稿.md", 0, 1);
        assert!(text.contains("Reading 设计稿.md"));
        let text = status_text(
            AppLocale::ZhCn,
            State::Working,
            "Editing notebook 分析.ipynb",
            0,
            1,
        );
        assert!(text.contains("编辑笔记本 分析.ipynb"));
    }
}
