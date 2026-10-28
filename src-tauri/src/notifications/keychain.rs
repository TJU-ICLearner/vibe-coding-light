pub trait KeyStore: Send + Sync {
    fn save(&self, key: &str) -> Result<(), String>;
    fn has_key(&self) -> Result<bool, String>;
    fn read(&self) -> Result<Option<String>, String>;
    fn delete(&self) -> Result<(), String>;
}

#[derive(Default)]
pub struct MacKeyStore;

#[cfg(any(target_os = "windows", target_os = "linux"))]
#[derive(Default)]
pub struct NativeKeyStore;

#[cfg(target_os = "macos")]
pub type PlatformKeyStore = MacKeyStore;

#[cfg(any(target_os = "windows", target_os = "linux"))]
pub type PlatformKeyStore = NativeKeyStore;

pub fn validate_bark_key(key: &str) -> Result<&str, &'static str> {
    let key = key.trim();
    if key.is_empty()
        || key.len() > 256
        || key.chars().any(|character| {
            matches!(character, '/' | '?' | '#' | '\\') || character.is_whitespace()
        })
    {
        return Err("Invalid Bark device key");
    }
    Ok(key)
}

#[cfg(target_os = "macos")]
impl KeyStore for MacKeyStore {
    fn save(&self, key: &str) -> Result<(), String> {
        let key = validate_bark_key(key)?;
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

#[cfg(any(target_os = "windows", target_os = "linux"))]
impl KeyStore for NativeKeyStore {
    fn save(&self, key: &str) -> Result<(), String> {
        let key = validate_bark_key(key)?;
        native_entry()?.set_password(key).map_err(native_error)
    }
    fn has_key(&self) -> Result<bool, String> {
        Ok(self.read()?.is_some())
    }
    fn read(&self) -> Result<Option<String>, String> {
        match native_entry()?.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(native_error(error)),
        }
    }
    fn delete(&self) -> Result<(), String> {
        match native_entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(native_error(error)),
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn native_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.cuihuapeng.code-light.bark", "device-key").map_err(native_error)
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn native_error(error: keyring::Error) -> String {
    format!("System credential store unavailable: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn device_key_rejects_copied_test_url_suffix() {
        assert!(validate_bark_key("abc123").is_ok());
        assert!(validate_bark_key("abc123-xyz_9").is_ok());
        for copied in [
            "abc123/title/body?group=example",
            "https://api.day.app/abc123/title/body",
            "abc123?group=example",
            "abc123 body",
        ] {
            assert_eq!(validate_bark_key(copied), Err("Invalid Bark device key"));
        }
    }

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
