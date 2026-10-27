use super::bark::{BarkClient, BarkError};
use super::claude_quota::ClaudeQuota;
use super::codex_quota::CodexQuota;
use super::diagnostics::{DiagnosticEntry, DiagnosticOutcome, DiagnosticReason, DiagnosticStore};
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
    pub service_available: bool,
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
    detail_marker: PathBuf,
    settings: Mutex<NotificationSettingsStore>,
    core: Mutex<NotificationCore>,
    spool: Mutex<EventSpool>,
    status: Mutex<NotificationStatus>,
    diagnostics: Mutex<DiagnosticStore>,
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
            service_available: true,
            key_saved: key_store.has_key().unwrap_or(false),
            ..Default::default()
        };
        let service = Arc::new(Self {
            app,
            data_dir: data_dir.clone(),
            detail_marker: dirs::home_dir()
                .ok_or("Home directory unavailable")?
                .join(".code-light/detail-capture"),
            settings: Mutex::new(store),
            core: Mutex::new(NotificationCore::new(
                data_dir.join("notification-ledger.json"),
            )),
            spool: Mutex::new(spool),
            status: Mutex::new(status),
            diagnostics: Mutex::new(DiagnosticStore::load(
                data_dir.join("notification-diagnostics.json"),
            )),
            last_claude_poll: Mutex::new(0),
            last_codex_poll: Mutex::new(0),
            key_store,
            bark: BarkClient::new().map_err(|_| "Bark transport unavailable")?,
        });
        service.sync_detail_capture(&service.settings());
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
        let old = self.settings();
        {
            let mut store = self.settings.lock().unwrap();
            store.set(value.clone())?;
            self.sync_detail_capture(&value);
        }
        self.core
            .lock()
            .unwrap()
            .quota_settings_changed(&old, &value);
        *self.last_claude_poll.lock().unwrap() = 0;
        *self.last_codex_poll.lock().unwrap() = 0;
        self.update_status(|status| {
            if !should_poll_quota(&value, AgentSource::Claude) {
                status.claude_quota_available = false;
            }
            if !should_poll_quota(&value, AgentSource::Codex) {
                status.codex_quota_available = false;
            }
        });
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
        let key = super::keychain::validate_bark_key(&key).map_err(str::to_owned)?;
        let payload = crate::ui_copy::test_notification(crate::current_locale(&self.app));
        let result = self.bark.send(&key, &payload);
        self.record_send_result(&result);
        let (outcome, reason) = diagnostic_send_result(&result);
        self.record_diagnostic(DiagnosticEntry {
            at_ms: now_ms(),
            source: None,
            kind: "test".into(),
            outcome,
            reason,
        });
        result.map_err(|error| format!("Bark send failed: {error:?}"))
    }

    pub fn status(&self) -> NotificationStatus {
        self.refresh_status();
        self.status.lock().unwrap().clone()
    }

    pub fn diagnostics(&self) -> Vec<DiagnosticEntry> {
        self.diagnostics.lock().unwrap().entries()
    }

    pub fn clear_diagnostics(&self) -> Result<(), String> {
        self.diagnostics.lock().unwrap().clear()?;
        let _ = self.app.emit("notification-diagnostics-changed", ());
        Ok(())
    }

    fn record_diagnostic(&self, entry: DiagnosticEntry) {
        if self.diagnostics.lock().unwrap().append(entry).is_ok() {
            let _ = self.app.emit("notification-diagnostics-changed", ());
        }
    }

    fn tick(&self) {
        let now = now_ms();
        let settings = {
            let store = self.settings.lock().unwrap();
            let settings = store.get();
            self.sync_detail_capture(&settings);
            settings
        };
        let events = self.spool.lock().unwrap().drain(now);
        for event in &events {
            if event.kind != super::model::AgentEventKind::Working {
                self.record_diagnostic(DiagnosticEntry::from_event(event, now, &settings));
            }
        }
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
            let active = should_poll_quota(&self.settings(), AgentSource::Claude);
            self.update_status(|status| status.claude_quota_available = active && result.is_ok());
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
            let active = should_poll_quota(&self.settings(), AgentSource::Codex);
            self.update_status(|status| status.codex_quota_available = active && result.is_ok());
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

    fn sync_detail_capture(&self, settings: &NotificationSettings) {
        let _ = super::detail_capture::sync(
            &self.detail_marker,
            settings.enabled && settings.include_details,
            now_ms() / 1_000,
        );
    }

    fn send_candidate(&self, candidate: PushCandidate) -> Result<(), BarkError> {
        let key = match self.key_store.read().ok().flatten() {
            Some(key) => key,
            None => {
                self.record_diagnostic(DiagnosticEntry::from_candidate(
                    &candidate,
                    now_ms(),
                    DiagnosticOutcome::Failed,
                    Some(DiagnosticReason::KeyMissing),
                ));
                return Err(BarkError::Unsent);
            }
        };
        let settings = self.settings();
        let now = now_ms();
        if !super::candidate_allowed(&candidate, &settings, now) {
            let reason = if now < candidate.due_at_ms || now >= candidate.expires_at_ms {
                DiagnosticReason::Expired
            } else if !settings.enabled {
                DiagnosticReason::NotificationsDisabled
            } else if !match candidate.source {
                AgentSource::Claude => settings.sources.claude,
                AgentSource::Codex => settings.sources.codex,
            } {
                DiagnosticReason::SourceDisabled
            } else {
                DiagnosticReason::TypeDisabled
            };
            self.record_diagnostic(DiagnosticEntry::from_candidate(
                &candidate,
                now,
                DiagnosticOutcome::Skipped,
                Some(reason),
            ));
            return Ok(());
        }
        let payload = crate::ui_copy::notification_payload_with_settings(
            &candidate,
            crate::current_locale(&self.app),
            &settings,
        );
        let result = match super::keychain::validate_bark_key(&key) {
            Ok(valid_key) => self.bark.send(valid_key, &payload),
            Err(_) => Err(BarkError::Rejected),
        };
        self.record_send_result(&result);
        let (outcome, reason) = diagnostic_send_result(&result);
        self.record_diagnostic(DiagnosticEntry::from_candidate(
            &candidate,
            now_ms(),
            outcome,
            reason,
        ));
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
        let claude_hooks = crate::hook_install_current("claude");
        let codex_hooks = crate::hook_install_current("codex");
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

fn diagnostic_send_result(
    result: &Result<(), BarkError>,
) -> (DiagnosticOutcome, Option<DiagnosticReason>) {
    match result {
        Ok(()) => (DiagnosticOutcome::Sent, None),
        Err(BarkError::Rejected) => (DiagnosticOutcome::Failed, Some(DiagnosticReason::Rejected)),
        Err(BarkError::Unsent) => (DiagnosticOutcome::Failed, Some(DiagnosticReason::Network)),
        Err(BarkError::Ambiguous) => (
            DiagnosticOutcome::Failed,
            Some(DiagnosticReason::Unconfirmed),
        ),
    }
}

fn status_or_unavailable(service: Option<&NotificationService>) -> NotificationStatus {
    service.map(NotificationService::status).unwrap_or_default()
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

pub(crate) fn can_access_notification_commands(label: &str) -> bool {
    label == "notifications"
}

#[cfg(test)]
mod startup_tests {
    use super::*;

    #[test]
    fn absent_optional_service_reports_unavailable_without_a_panic() {
        let status = status_or_unavailable(None);
        assert!(!status.service_available);
    }
}

fn ensure_notification_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if can_access_notification_commands(window.label()) {
        Ok(())
    } else {
        Err("Notification command unavailable from this window".into())
    }
}

#[tauri::command]
pub fn get_notification_settings(
    window: tauri::WebviewWindow,
    service: tauri::State<'_, Option<Arc<NotificationService>>>,
) -> Result<NotificationSettings, String> {
    ensure_notification_window(&window)?;
    Ok(service
        .as_deref()
        .map(NotificationService::settings)
        .unwrap_or_default())
}

#[tauri::command]
pub fn set_notification_settings(
    window: tauri::WebviewWindow,
    service: tauri::State<'_, Option<Arc<NotificationService>>>,
    settings: NotificationSettings,
) -> Result<NotificationSettings, String> {
    ensure_notification_window(&window)?;
    service
        .as_deref()
        .ok_or("Notification service unavailable")?
        .set_settings(settings)
}

#[tauri::command]
pub fn save_bark_key(
    window: tauri::WebviewWindow,
    service: tauri::State<'_, Option<Arc<NotificationService>>>,
    key: String,
) -> Result<(), String> {
    ensure_notification_window(&window)?;
    service
        .as_deref()
        .ok_or("Notification service unavailable")?
        .save_key(&key)
}

#[tauri::command]
pub fn delete_bark_key(
    window: tauri::WebviewWindow,
    service: tauri::State<'_, Option<Arc<NotificationService>>>,
) -> Result<(), String> {
    ensure_notification_window(&window)?;
    service
        .as_deref()
        .ok_or("Notification service unavailable")?
        .delete_key()
}

#[tauri::command]
pub fn send_test_notification(
    window: tauri::WebviewWindow,
    service: tauri::State<'_, Option<Arc<NotificationService>>>,
) -> Result<(), String> {
    ensure_notification_window(&window)?;
    service
        .as_deref()
        .ok_or("Notification service unavailable")?
        .send_test()
}

#[tauri::command]
pub fn get_notification_status(
    window: tauri::WebviewWindow,
    service: tauri::State<'_, Option<Arc<NotificationService>>>,
) -> Result<NotificationStatus, String> {
    ensure_notification_window(&window)?;
    Ok(status_or_unavailable(service.as_deref()))
}

#[tauri::command]
pub fn get_notification_diagnostics(
    window: tauri::WebviewWindow,
    service: tauri::State<'_, Option<Arc<NotificationService>>>,
) -> Result<Vec<DiagnosticEntry>, String> {
    ensure_notification_window(&window)?;
    Ok(service
        .as_deref()
        .map(NotificationService::diagnostics)
        .unwrap_or_default())
}

#[tauri::command]
pub fn clear_notification_diagnostics(
    window: tauri::WebviewWindow,
    service: tauri::State<'_, Option<Arc<NotificationService>>>,
) -> Result<(), String> {
    ensure_notification_window(&window)?;
    service
        .as_deref()
        .ok_or("Notification service unavailable")?
        .clear_diagnostics()
}
