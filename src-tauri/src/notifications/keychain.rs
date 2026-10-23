pub trait KeyStore: Send + Sync {
    fn save(&self, key: &str) -> Result<(), String>;
    fn has_key(&self) -> Result<bool, String>;
    fn read(&self) -> Result<Option<String>, String>;
    fn delete(&self) -> Result<(), String>;
}

pub struct MacKeyStore;

#[cfg(target_os = "macos")]
impl KeyStore for MacKeyStore {
    fn save(&self, key: &str) -> Result<(), String> {
        let key = key.trim();
        if key.is_empty() || key.len() > 256 {
            return Err("Invalid Bark device key".into());
        }
        security_framework::passwords::set_generic_password(
            "com.cuihuapeng.code-light.bark",
            "device-key",
            key.as_bytes(),
        )
        .map_err(|_| "Could not save Bark key in Keychain".into())
    }

    fn has_key(&self) -> Result<bool, String> {
        Ok(self.read()?.is_some())
    }

    fn read(&self) -> Result<Option<String>, String> {
        match security_framework::passwords::get_generic_password(
            "com.cuihuapeng.code-light.bark",
            "device-key",
        ) {
            Ok(bytes) => String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| "Invalid Keychain value".into()),
            Err(error) if error.code() == -25300 => Ok(None),
            Err(_) => Err("Could not read Bark key from Keychain".into()),
        }
    }

    fn delete(&self) -> Result<(), String> {
        match security_framework::passwords::delete_generic_password(
            "com.cuihuapeng.code-light.bark",
            "device-key",
        ) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == -25300 => Ok(()),
            Err(_) => Err("Could not delete Bark key from Keychain".into()),
        }
    }
}

#[cfg(not(target_os = "macos"))]
impl KeyStore for MacKeyStore {
    fn save(&self, _key: &str) -> Result<(), String> {
        Err("Bark Keychain is available on macOS only".into())
    }
    fn has_key(&self) -> Result<bool, String> {
        Ok(false)
    }
    fn read(&self) -> Result<Option<String>, String> {
        Ok(None)
    }
    fn delete(&self) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MockStore {
        value: Mutex<Option<String>>,
        fail: bool,
    }
    impl KeyStore for MockStore {
        fn save(&self, key: &str) -> Result<(), String> {
            if key.trim().is_empty() || self.fail {
                return Err("Key save failed".into());
            }
            *self.value.lock().unwrap() = Some(key.into());
            Ok(())
        }
        fn has_key(&self) -> Result<bool, String> {
            Ok(self.value.lock().unwrap().is_some())
        }
        fn read(&self) -> Result<Option<String>, String> {
            Ok(self.value.lock().unwrap().clone())
        }
        fn delete(&self) -> Result<(), String> {
            *self.value.lock().unwrap() = None;
            Ok(())
        }
    }

    #[test]
    fn empty_or_failed_save_keeps_prior_credential() {
        let store = MockStore::default();
        store.save("old-key").unwrap();
        assert!(store.save(" ").is_err());
        assert_eq!(store.read().unwrap().as_deref(), Some("old-key"));
        let failed = MockStore {
            value: Mutex::new(Some("old-key".into())),
            fail: true,
        };
        assert!(failed.save("new-key").is_err());
        assert_eq!(failed.read().unwrap().as_deref(), Some("old-key"));
        assert!(failed.has_key().unwrap());
    }

    #[test]
    fn preferences_json_never_contains_key() {
        let store = MockStore::default();
        store.save("secret-device-key").unwrap();
        let settings =
            serde_json::to_string(&crate::notifications::model::NotificationSettings::default())
                .unwrap();
        assert!(!settings.contains("secret-device-key"));
        store.delete().unwrap();
        assert!(!store.has_key().unwrap());
    }
}
