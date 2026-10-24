use super::model::NotificationSettings;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

#[allow(dead_code)]
pub struct NotificationSettingsStore {
    path: PathBuf,
    value: NotificationSettings,
}

#[allow(dead_code)]
impl NotificationSettingsStore {
    pub fn load(path: PathBuf) -> Self {
        let value = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self { path, value }
    }

    pub fn get(&self) -> NotificationSettings {
        self.value.clone()
    }

    pub fn set(&mut self, value: NotificationSettings) -> Result<(), String> {
        if value.templates.values().any(|template| {
            template.title.chars().count() > 120 || template.body.chars().count() > 2_000
        }) {
            return Err("Notification template is too long".into());
        }
        let parent = self
            .path
            .parent()
            .ok_or("Notification settings path has no parent")?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let mut temp =
            tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
        serde_json::to_writer(&mut temp, &value).map_err(|error| error.to_string())?;
        temp.flush().map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            temp.as_file()
                .set_permissions(fs::Permissions::from_mode(0o600))
                .map_err(|error| error.to_string())?;
        }
        temp.persist(&self.path)
            .map_err(|error| error.to_string())?;
        self.value = value;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn defaults_are_opt_in() {
        let settings = NotificationSettings::default();
        assert!(!settings.enabled);
        assert!(settings.sources.claude);
        assert!(settings.sources.codex);
        assert!(settings.events.permission);
        assert!(settings.events.question);
        assert!(settings.events.completed);
        assert!(settings.events.error);
        assert!(!settings.quota.at80);
        assert!(!settings.quota.at50);
        assert!(!settings.quota.at20);
        assert!(!settings.quota.at0);
        assert!(!settings.quota.recovered);
    }

    #[test]
    fn round_trip_preserves_switches() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/notifications.json");
        let mut store = NotificationSettingsStore::load(path.clone());
        let mut value = store.get();
        value.enabled = true;
        value.sources.codex = false;
        value.quota.at20 = true;
        store.set(value.clone()).unwrap();
        assert_eq!(NotificationSettingsStore::load(path).get(), value);
    }

    #[test]
    fn failed_write_keeps_previous_settings() {
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("file");
        fs::write(&blocker, "not a directory").unwrap();
        let mut store = NotificationSettingsStore::load(blocker.join("notifications.json"));
        let mut value = store.get();
        value.enabled = true;
        assert!(store.set(value).is_err());
        assert!(!store.get().enabled);
    }

    #[test]
    fn oversized_custom_notification_text_is_rejected_before_saving() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notifications.json");
        let mut store = NotificationSettingsStore::load(path.clone());
        let mut value = store.get();
        value.templates.insert(
            "en.permission".into(),
            super::super::model::NotificationTemplate {
                title: "x".repeat(121),
                body: "Allowed body".into(),
            },
        );
        assert!(store.set(value).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn unknown_fields_do_not_crash_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notifications.json");
        fs::write(&path, r#"{"enabled":true,"sources":{"claude":true,"codex":false},"events":{"permission":true,"question":false,"completed":true,"error":true},"quota":{"at80":false,"at50":false,"at20":true,"at0":false,"recovered":false},"future":{"a":1}}"#).unwrap();
        let loaded = NotificationSettingsStore::load(path).get();
        assert!(loaded.enabled);
        assert!(!loaded.sources.codex);
        assert!(loaded.quota.at20);
    }
}
