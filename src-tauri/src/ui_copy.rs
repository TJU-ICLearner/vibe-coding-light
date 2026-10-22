use crate::ui_locale::AppLocale;
use crate::State;

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
    let (toggle_pet, pet_action, customize_pet, language, chinese, english, quit) = match locale {
        AppLocale::ZhCn => (
            if pet_visible {
                "隐藏桌宠"
            } else {
                "显示桌宠"
            },
            "摸摸  ⌘B",
            "自定义桌宠",
            "语言",
            "中文",
            "英文",
            "退出 Vibe Coding Light",
        ),
        AppLocale::En => (
            if pet_visible { "Hide Pet" } else { "Show Pet" },
            "Pet the Pet  ⌘B",
            "Customize Pet",
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
