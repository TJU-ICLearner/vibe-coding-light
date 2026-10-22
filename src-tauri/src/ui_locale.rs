use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppLocale {
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en")]
    En,
}

impl AppLocale {
    pub fn from_system_tag(tag: Option<&str>) -> Self {
        match tag {
            Some(tag) if tag.split(['-', '_']).next().unwrap_or_default().eq_ignore_ascii_case("zh") => Self::ZhCn,
            _ => Self::En,
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Preference {
    locale: AppLocale,
}

pub struct UiLocaleStore {
    path: PathBuf,
    locale: AppLocale,
}

impl UiLocaleStore {
    pub fn load(path: PathBuf, system_tag: Option<&str>) -> Self {
        let locale = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Preference>(&bytes).ok())
            .map(|preference| preference.locale)
            .unwrap_or_else(|| AppLocale::from_system_tag(system_tag));
        Self { path, locale }
    }

    pub fn get(&self) -> AppLocale {
        self.locale
    }

    pub fn set(&mut self, locale: AppLocale) -> Result<(), String> {
        let parent = self.path.parent().ok_or("Invalid preferences path")?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
        serde_json::to_writer(&mut temp, &Preference { locale }).map_err(|error| error.to_string())?;
        temp.flush().map_err(|error| error.to_string())?;
        temp.persist(&self.path).map_err(|error| error.to_string())?;
        self.locale = locale;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{AppLocale, UiLocaleStore};
    use std::fs;

    #[test]
    fn system_tag_selects_supported_language() {
        assert_eq!(AppLocale::from_system_tag(Some("zh-HK")), AppLocale::ZhCn);
        assert_eq!(AppLocale::from_system_tag(Some("zh_CN")), AppLocale::ZhCn);
        assert_eq!(AppLocale::from_system_tag(Some("en-US")), AppLocale::En);
        assert_eq!(AppLocale::from_system_tag(Some("ja-JP")), AppLocale::En);
        assert_eq!(AppLocale::from_system_tag(None), AppLocale::En);
    }

    #[test]
    fn corrupt_or_unreadable_preference_uses_system_locale() {
        let dir = tempfile::tempdir().unwrap();
        let corrupt = dir.path().join("corrupt.json");
        fs::write(&corrupt, b"{broken").unwrap();
        assert_eq!(UiLocaleStore::load(corrupt, Some("zh-HK")).get(), AppLocale::ZhCn);
        let unreadable = dir.path().join("as-directory.json");
        fs::create_dir(&unreadable).unwrap();
        assert_eq!(UiLocaleStore::load(unreadable, Some("en-US")).get(), AppLocale::En);
    }

    #[test]
    fn choice_survives_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/preferences.json");
        let mut store = UiLocaleStore::load(path.clone(), Some("zh-HK"));
        store.set(AppLocale::En).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{\"locale\":\"en\"}");
        assert_eq!(UiLocaleStore::load(path, Some("zh-HK")).get(), AppLocale::En);
    }

    #[test]
    fn failed_write_keeps_old_choice() {
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("not-a-directory");
        fs::write(&blocker, b"block").unwrap();
        let mut store = UiLocaleStore::load(blocker.join("preferences.json"), Some("zh-CN"));
        assert!(store.set(AppLocale::En).is_err());
        assert_eq!(store.get(), AppLocale::ZhCn);
    }
}
