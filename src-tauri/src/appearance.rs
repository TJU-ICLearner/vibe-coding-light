use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeId {
    SystemLight,
    SystemDark,
    Shaxi,
    Chenwu,
    Zhiqiu,
    Bajiao,
}

impl ThemeId {
    pub fn from_action_id(id: &str) -> Option<Self> {
        Some(match id {
            "appearance_system_light" => Self::SystemLight,
            "appearance_system_dark" => Self::SystemDark,
            "appearance_shaxi" => Self::Shaxi,
            "appearance_chenwu" => Self::Chenwu,
            "appearance_zhiqiu" => Self::Zhiqiu,
            "appearance_bajiao" => Self::Bajiao,
            _ => return None,
        })
    }

    pub fn action_id(self) -> &'static str {
        match self {
            Self::SystemLight => "appearance_system_light",
            Self::SystemDark => "appearance_system_dark",
            Self::Shaxi => "appearance_shaxi",
            Self::Chenwu => "appearance_chenwu",
            Self::Zhiqiu => "appearance_zhiqiu",
            Self::Bajiao => "appearance_bajiao",
        }
    }

    pub fn all() -> [Self; 6] {
        [
            Self::SystemLight,
            Self::SystemDark,
            Self::Shaxi,
            Self::Chenwu,
            Self::Zhiqiu,
            Self::Bajiao,
        ]
    }

    pub fn label(self, chinese: bool) -> &'static str {
        match (self, chinese) {
            (Self::SystemLight, true) => "系统浅色",
            (Self::SystemLight, false) => "System Light",
            (Self::SystemDark, true) => "系统深色",
            (Self::SystemDark, false) => "System Dark",
            (Self::Shaxi, true) => "社戏",
            (Self::Shaxi, false) => "Village Opera",
            (Self::Chenwu, true) => "晨雾",
            (Self::Chenwu, false) => "Morning Mist",
            (Self::Zhiqiu, true) => "知秋",
            (Self::Zhiqiu, false) => "Autumn",
            (Self::Bajiao, true) => "芭蕉",
            (Self::Bajiao, false) => "Banana Rain",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    pub follow_system: bool,
    pub manual_theme: ThemeId,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            follow_system: true,
            manual_theme: ThemeId::SystemLight,
        }
    }
}

pub struct AppearanceStore {
    path: PathBuf,
    preference: Appearance,
}

impl AppearanceStore {
    pub fn load(path: PathBuf) -> Self {
        let preference = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self { path, preference }
    }

    pub fn get(&self) -> Appearance {
        self.preference
    }

    pub fn set(&mut self, preference: Appearance) -> Result<(), String> {
        let parent = self.path.parent().ok_or("Invalid appearance path")?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let mut temp =
            tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
        serde_json::to_writer(&mut temp, &preference).map_err(|error| error.to_string())?;
        temp.flush().map_err(|error| error.to_string())?;
        temp.persist(&self.path)
            .map_err(|error| error.to_string())?;
        self.preference = preference;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{Appearance, AppearanceStore, ThemeId};
    use std::fs;

    #[test]
    fn first_launch_follows_system_and_manual_default_is_light() {
        let dir = tempfile::tempdir().unwrap();
        let store = AppearanceStore::load(dir.path().join("appearance.json"));
        assert_eq!(
            store.get(),
            Appearance {
                follow_system: true,
                manual_theme: ThemeId::SystemLight,
            }
        );
    }

    #[test]
    fn manual_theme_and_follow_choice_survive_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/appearance.json");
        let mut store = AppearanceStore::load(path.clone());
        let selected = Appearance {
            follow_system: false,
            manual_theme: ThemeId::Shaxi,
        };
        store.set(selected).unwrap();
        assert_eq!(AppearanceStore::load(path).get(), selected);
    }

    #[test]
    fn corrupt_file_and_failed_write_keep_safe_state() {
        let dir = tempfile::tempdir().unwrap();
        let corrupt = dir.path().join("corrupt.json");
        fs::write(&corrupt, b"{broken").unwrap();
        assert_eq!(AppearanceStore::load(corrupt).get(), Appearance::default());

        let blocker = dir.path().join("blocker");
        fs::write(&blocker, b"block").unwrap();
        let mut store = AppearanceStore::load(blocker.join("appearance.json"));
        assert!(store
            .set(Appearance {
                follow_system: false,
                manual_theme: ThemeId::Bajiao,
            })
            .is_err());
        assert_eq!(store.get(), Appearance::default());
    }

    #[test]
    fn every_manual_theme_has_an_action_and_bilingual_name() {
        for theme in ThemeId::all() {
            assert_eq!(ThemeId::from_action_id(theme.action_id()), Some(theme));
            assert!(!theme.label(true).is_empty());
            assert!(!theme.label(false).is_empty());
        }
        assert_eq!(ThemeId::SystemDark.label(true), "系统深色");
    }
}
