use super::bark::{BarkClient, BarkError};
use super::claude_quota::ClaudeQuota;
use super::codex_quota::CodexQuota;
use super::events::EventSpool;
use super::keychain::{KeyStore, MacKeyStore};
use super::model::{AgentSource, NotificationSettings, PushCandidate};
use super::settings::NotificationSettingsStore;
use super::{should_poll_quota, NotificationCore};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const QUOTA_POLL_MS: u64 = 300_000;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationStatus {
    pub key_saved: bool,
    pub claude_hooks_installed: bool,
    pub codex_hooks_installed: bool,
    pub claude_quota_available: bool,
    pub codex_quota_available: bool,
    pub last_send_error: Option<String>,
}

pub struct NotificationService {
    app: AppHandle,
    data_dir: PathBuf,
    settings: Mutex<NotificationSettingsStore>,
    core: Mutex<NotificationCore>,
    spool: Mutex<EventSpool>,
    status: Mutex<NotificationStatus>,
    last_claude_poll: Mutex<u64>,
    last_codex_poll: Mutex<u64>,
    key_store: MacKeyStore,
    bark: BarkClient,
}

impl NotificationService {
    pub fn start(app: AppHandle, data_dir: PathBuf) -> Result<Arc<Self>, String> {
        let event_dir = dirs::home_dir()
            .ok_or("Home directory unavailable")?
            .join(".code-light/events");
        let mut spool = EventSpool::new(event_dir);
        spool.baseline()?;
        let store = NotificationSettingsStore::load(data_dir.join("notification-settings.json"));
        let key_store = MacKeyStore;
        let status = NotificationStatus {
            key_saved: key_store.has_key().unwrap_or(false),
            ..Default::default()
        };
        let service = Arc::new(Self {
            app,
            data_dir: data_dir.clone(),
            settings: Mutex::new(store),
            core: Mutex::new(NotificationCore::new(
                data_dir.join("notification-ledger.json"),
            )),
            spool: Mutex::new(spool),
            status: Mutex::new(status),
            last_claude_poll: Mutex::new(0),
            last_codex_poll: Mutex::new(0),
            key_store,
            bark: BarkClient::new().map_err(|_| "Bark transport unavailable")?,
        });
        service.sync_claude_proxy();
        service.refresh_status();
        let worker = Arc::clone(&service);
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(1));
            worker.tick();
        });
        Ok(service)
    }

    pub fn settings(&self) -> NotificationSettings {
        self.settings.lock().unwrap().get()
    }

    pub fn set_settings(
        &self,
        value: NotificationSettings,
    ) -> Result<NotificationSettings, String> {
        self.settings.lock().unwrap().set(value.clone())?;
        self.sync_claude_proxy();
        self.refresh_status();
        Ok(value)
    }

    pub fn save_key(&self, key: &str) -> Result<(), String> {
        self.key_store.save(key)?;
        self.refresh_status();
        Ok(())
    }

    pub fn delete_key(&self) -> Result<(), String> {
        self.key_store.delete()?;
        self.refresh_status();
        Ok(())
    }

    pub fn send_test(&self) -> Result<(), String> {
        if !self.settings().enabled {
            return Err("Notifications are disabled".into());
        }
        let key = self.key_store.read()?.ok_or("Bark device key not saved")?;
        let payload = crate::ui_copy::test_notification(crate::current_locale(&self.app));
        let result = self.bark.send(&key, &payload);
        self.record_send_result(&result);
        result.map_err(|error| format!("Bark send failed: {error:?}"))
    }

    pub fn status(&self) -> NotificationStatus {
        self.refresh_status();
        self.status.lock().unwrap().clone()
    }

    fn tick(&self) {
        let now = now_ms();
        let settings = self.settings();
        let events = self.spool.lock().unwrap().drain(now);
        {
            let mut core = self.core.lock().unwrap();
            core.events(
                events,
                now,
                &settings,
                || self.settings(),
                |candidate| self.send_candidate(candidate),
            );
            core.flush(
                now,
                &settings,
                || self.settings(),
                |candidate| self.send_candidate(candidate),
            );
        }
        if should_poll_quota(&settings, AgentSource::Claude) && due(&self.last_claude_poll, now) {
            let path = self.data_dir.join("claude-quota-snapshot.json");
            let result = if snapshot_is_fresh(&path) {
                ClaudeQuota::read_snapshot(&path)
            } else {
                Err("Claude quota snapshot stale".into())
            };
            self.update_status(|status| status.claude_quota_available = result.is_ok());
            if let Ok(windows) = result {
                for window in windows {
                    let current = self.settings();
                    self.core.lock().unwrap().quota(
                        window,
                        now,
                        &current,
                        || self.settings(),
                        |candidate| self.send_candidate(candidate),
                    );
                }
            }
        }
        if should_poll_quota(&settings, AgentSource::Codex) && due(&self.last_codex_poll, now) {
            let result = CodexQuota::read(Duration::from_secs(5));
            self.update_status(|status| status.codex_quota_available = result.is_ok());
            if let Ok(windows) = result {
                for window in windows {
                    let current = self.settings();
                    self.core.lock().unwrap().quota(
                        window,
                        now,
                        &current,
                        || self.settings(),
                        |candidate| self.send_candidate(candidate),
                    );
                }
            }
        }
        self.refresh_status();
    }

    fn send_candidate(&self, candidate: PushCandidate) -> Result<(), BarkError> {
        let key = self
            .key_store
            .read()
            .map_err(|_| BarkError::Unsent)?
            .ok_or(BarkError::Unsent)?;
        let settings = self.settings();
        if !super::candidate_allowed(&candidate, &settings, now_ms()) {
            return Ok(());
        }
        let payload =
            crate::ui_copy::notification_payload(&candidate, crate::current_locale(&self.app));
        let result = self.bark.send(&key, &payload);
        self.record_send_result(&result);
        result
    }

    fn record_send_result(&self, result: &Result<(), BarkError>) {
        self.update_status(|status| {
            status.last_send_error = result
                .as_ref()
                .err()
                .map(|error| format!("Bark send failed: {error:?}"))
        });
    }

    fn sync_claude_proxy(&self) {
        let Some(home) = dirs::home_dir() else {
            return;
        };
        let settings_path = home.join(".claude/settings.json");
        let Ok(executable) = std::env::current_exe() else {
            return;
        };
        let result = if should_poll_quota(&self.settings(), AgentSource::Claude) {
            ClaudeQuota::install(&settings_path, &executable, &self.data_dir)
        } else {
            ClaudeQuota::remove(&settings_path, &executable, &self.data_dir)
        };
        if result.is_err() {
            self.update_status(|status| status.claude_quota_available = false);
        }
    }

    fn refresh_status(&self) {
        let home = dirs::home_dir().unwrap_or_default();
        let claude_hooks = home.join(".code-light/hooks/claude/stop.sh").is_file();
        let codex_hooks = home.join(".code-light/hooks/codex/stop.sh").is_file();
        let key_saved = self.key_store.has_key().unwrap_or(false);
        self.update_status(|status| {
            status.claude_hooks_installed = claude_hooks;
            status.codex_hooks_installed = codex_hooks;
            status.key_saved = key_saved;
        });
    }

    fn update_status(&self, change: impl FnOnce(&mut NotificationStatus)) {
        let mut status = self.status.lock().unwrap();
        let before = status.clone();
        change(&mut status);
        if *status != before {
            let _ = self.app.emit("notification-status-changed", status.clone());
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn due(last: &Mutex<u64>, now: u64) -> bool {
    let mut last = last.lock().unwrap();
    if *last != 0 && now.saturating_sub(*last) < QUOTA_POLL_MS {
        return false;
    }
    *last = now;
    true
}
fn snapshot_is_fresh(path: &std::path::Path) -> bool {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age <= Duration::from_secs(600))
}

#[tauri::command]
pub fn get_notification_settings(
    service: tauri::State<'_, Arc<NotificationService>>,
) -> NotificationSettings {
    service.settings()
}

#[tauri::command]
pub fn set_notification_settings(
    service: tauri::State<'_, Arc<NotificationService>>,
    settings: NotificationSettings,
) -> Result<NotificationSettings, String> {
    service.set_settings(settings)
}

#[tauri::command]
pub fn save_bark_key(
    service: tauri::State<'_, Arc<NotificationService>>,
    key: String,
) -> Result<(), String> {
    service.save_key(&key)
}

#[tauri::command]
pub fn delete_bark_key(service: tauri::State<'_, Arc<NotificationService>>) -> Result<(), String> {
    service.delete_key()
}

#[tauri::command]
pub fn send_test_notification(
    service: tauri::State<'_, Arc<NotificationService>>,
) -> Result<(), String> {
    service.send_test()
}

#[tauri::command]
pub fn get_notification_status(
    service: tauri::State<'_, Arc<NotificationService>>,
) -> NotificationStatus {
    service.status()
}
