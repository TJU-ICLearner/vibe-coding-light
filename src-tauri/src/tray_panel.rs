#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrayAction {
    TogglePet,
    PetAction,
    CustomizePet,
    NotificationSettings,
    SetupClaude,
    SetupCodex,
    LanguageZh,
    LanguageEn,
    LaunchAtLogin,
    AutoUpdates,
    CheckUpdates,
    OpenRelease,
    Quit,
}

impl TrayAction {
    pub fn parse(id: &str) -> Option<Self> {
        Some(match id {
            "toggle_pet" => Self::TogglePet,
            "pet_action" => Self::PetAction,
            "customize_pet" => Self::CustomizePet,
            "notification_settings" => Self::NotificationSettings,
            "setup_claude" => Self::SetupClaude,
            "setup_codex" => Self::SetupCodex,
            "language_zh" => Self::LanguageZh,
            "language_en" => Self::LanguageEn,
            "launch_at_login" => Self::LaunchAtLogin,
            "auto_updates" => Self::AutoUpdates,
            "check_updates" => Self::CheckUpdates,
            "open_release" => Self::OpenRelease,
            "quit" => Self::Quit,
            _ => return None,
        })
    }

    pub fn closes_panel(self) -> bool {
        matches!(
            self,
            Self::CustomizePet | Self::NotificationSettings | Self::OpenRelease | Self::Quit
        )
    }
}

#[derive(Clone, Copy, Debug)]
pub struct ScreenRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

pub fn panel_origin(tray: ScreenRect, screen: ScreenRect, width: i32, height: i32) -> (i32, i32) {
    let x = tray.x + tray.width / 2 - width / 2;
    let y = tray.y + tray.height;
    (
        x.clamp(screen.x, screen.x + (screen.width - width).max(0)),
        y.clamp(screen.y, screen.y + (screen.height - height).max(0)),
    )
}

pub fn authorized_window(label: &str) -> bool {
    label == "tray_panel"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_navigation_actions_close_the_panel() {
        for id in [
            "toggle_pet",
            "pet_action",
            "language_zh",
            "language_en",
            "launch_at_login",
            "auto_updates",
            "check_updates",
            "setup_claude",
            "setup_codex",
        ] {
            assert!(!TrayAction::parse(id).unwrap().closes_panel(), "{id}");
        }
        for id in [
            "customize_pet",
            "notification_settings",
            "open_release",
            "quit",
        ] {
            assert!(TrayAction::parse(id).unwrap().closes_panel(), "{id}");
        }
        assert!(TrayAction::parse("unknown").is_none());
        assert!(authorized_window("tray_panel"));
        assert!(!authorized_window("pet"));
        assert!(!authorized_window("notifications"));
    }

    #[test]
    fn panel_position_stays_inside_screen_near_tray_icon() {
        let screen = ScreenRect {
            x: 0,
            y: 0,
            width: 1440,
            height: 900,
        };
        let left = panel_origin(
            ScreenRect {
                x: 5,
                y: 0,
                width: 24,
                height: 24,
            },
            screen,
            360,
            600,
        );
        assert_eq!(left, (0, 24));
        let right = panel_origin(
            ScreenRect {
                x: 1410,
                y: 0,
                width: 24,
                height: 24,
            },
            screen,
            360,
            600,
        );
        assert_eq!(right, (1080, 24));
        let second_screen = ScreenRect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let other = panel_origin(
            ScreenRect {
                x: -400,
                y: 0,
                width: 24,
                height: 24,
            },
            second_screen,
            360,
            600,
        );
        assert!(other.0 >= -1920 && other.0 <= -360);
    }
}
