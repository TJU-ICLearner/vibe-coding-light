pub mod bark;
pub mod claude_quota;
pub mod codex_quota;
pub mod engine;
pub mod events;
pub mod keychain;
pub mod model;
pub mod service;
pub mod settings;

use bark::BarkError;
use engine::NotificationEngine;
use model::{AgentEvent, AgentSource, NotificationSettings, PushCandidate, PushKind, QuotaWindow};
use std::path::PathBuf;

pub struct NotificationCore {
    engine: NotificationEngine,
}

impl NotificationCore {
    pub fn new(ledger_path: PathBuf) -> Self {
        Self {
            engine: NotificationEngine::load(ledger_path),
        }
    }

    pub fn events<F, G>(
        &mut self,
        events: Vec<AgentEvent>,
        now_ms: u64,
        settings: &NotificationSettings,
        current: F,
        send: G,
    ) -> Vec<BarkError>
    where
        F: FnMut() -> NotificationSettings,
        G: FnMut(PushCandidate) -> Result<(), BarkError>,
    {
        let candidates = events
            .into_iter()
            .flat_map(|event| self.engine.on_event(event, now_ms, settings))
            .collect();
        dispatch(candidates, now_ms, current, send)
    }

    pub fn quota<F, G>(
        &mut self,
        window: QuotaWindow,
        now_ms: u64,
        settings: &NotificationSettings,
        current: F,
        send: G,
    ) -> Vec<BarkError>
    where
        F: FnMut() -> NotificationSettings,
        G: FnMut(PushCandidate) -> Result<(), BarkError>,
    {
        let candidates = self.engine.on_quota(window, now_ms, settings);
        dispatch(candidates, now_ms, current, send)
    }

    pub fn flush<F, G>(
        &mut self,
        now_ms: u64,
        settings: &NotificationSettings,
        current: F,
        send: G,
    ) -> Vec<BarkError>
    where
        F: FnMut() -> NotificationSettings,
        G: FnMut(PushCandidate) -> Result<(), BarkError>,
    {
        let candidates = self.engine.flush_due(now_ms, settings);
        dispatch(candidates, now_ms, current, send)
    }
}

pub fn should_poll_quota(settings: &NotificationSettings, source: AgentSource) -> bool {
    settings.enabled
        && match source {
            AgentSource::Claude => settings.sources.claude,
            AgentSource::Codex => settings.sources.codex,
        }
        && (settings.quota.at80
            || settings.quota.at50
            || settings.quota.at20
            || settings.quota.at0
            || settings.quota.recovered)
}

pub fn dispatch<F, G>(
    candidates: Vec<PushCandidate>,
    now_ms: u64,
    mut current: F,
    mut send: G,
) -> Vec<BarkError>
where
    F: FnMut() -> NotificationSettings,
    G: FnMut(PushCandidate) -> Result<(), BarkError>,
{
    let mut errors = Vec::new();
    for candidate in candidates {
        let settings = current();
        if candidate_allowed(&candidate, &settings, now_ms) {
            if let Err(error) = send(candidate) {
                errors.push(error);
            }
        }
    }
    errors
}

pub fn candidate_allowed(
    candidate: &PushCandidate,
    settings: &NotificationSettings,
    now_ms: u64,
) -> bool {
    if now_ms < candidate.due_at_ms || now_ms >= candidate.expires_at_ms {
        return false;
    }
    if !settings.enabled
        || !match candidate.source {
            AgentSource::Claude => settings.sources.claude,
            AgentSource::Codex => settings.sources.codex,
        }
    {
        return false;
    }
    match candidate.kind {
        PushKind::Permission => settings.events.permission,
        PushKind::Question => settings.events.question,
        PushKind::Completed => settings.events.completed,
        PushKind::Error => settings.events.error,
        PushKind::QuotaThreshold(80) => settings.quota.at80,
        PushKind::QuotaThreshold(50) => settings.quota.at50,
        PushKind::QuotaThreshold(20) => settings.quota.at20,
        PushKind::QuotaThreshold(0) => settings.quota.at0,
        PushKind::QuotaThreshold(_) => false,
        PushKind::QuotaRecovered => settings.quota.recovered,
        PushKind::Test => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notifications::model::{
        AgentEvent, AgentEventKind, AgentSource, NotificationSettings, PushCandidate, PushKind,
        QuotaWindow,
    };

    fn enabled() -> NotificationSettings {
        let mut s = NotificationSettings::default();
        s.enabled = true;
        s
    }
    fn event(id: &str, kind: AgentEventKind, at: u64) -> AgentEvent {
        AgentEvent {
            id: id.into(),
            source: AgentSource::Claude,
            session_id: "session".into(),
            turn_id: None,
            kind,
            at_ms: at,
        }
    }

    #[test]
    fn master_off_or_disabled_during_settle_suppresses_send() {
        let dir = tempfile::tempdir().unwrap();
        let mut core = NotificationCore::new(dir.path().join("ledger.json"));
        let mut s = NotificationSettings::default();
        let mut sent = Vec::new();
        core.events(
            vec![event("a", AgentEventKind::Permission, 1_000)],
            1_000,
            &s,
            || s.clone(),
            |candidate| {
                sent.push(candidate);
                Ok(())
            },
        );
        assert!(sent.is_empty());
        s.enabled = true;
        core.events(
            vec![event("b", AgentEventKind::Completed, 2_000)],
            2_000,
            &s,
            || s.clone(),
            |candidate| {
                sent.push(candidate);
                Ok(())
            },
        );
        s.enabled = false;
        core.flush(
            5_000,
            &s,
            || s.clone(),
            |candidate| {
                sent.push(candidate);
                Ok(())
            },
        );
        assert!(sent.is_empty());
    }

    #[test]
    fn in_flight_disable_and_expired_candidate_are_filtered() {
        let mut s = enabled();
        let candidate = PushCandidate {
            id: "a".into(),
            source: AgentSource::Codex,
            kind: PushKind::Question,
            label: None,
            remaining_percent: None,
            due_at_ms: 1_000,
            expires_at_ms: 2_000,
        };
        let mut sent = 0;
        dispatch(
            vec![candidate.clone()],
            1_500,
            || {
                s.enabled = false;
                s.clone()
            },
            |_| {
                sent += 1;
                Ok(())
            },
        );
        assert_eq!(sent, 0);
        s.enabled = true;
        dispatch(
            vec![candidate],
            2_001,
            || s.clone(),
            |_| {
                sent += 1;
                Ok(())
            },
        );
        assert_eq!(sent, 0);
    }

    #[test]
    fn send_failure_is_local_and_other_source_continues() {
        let s = enabled();
        let candidates = [AgentSource::Claude, AgentSource::Codex]
            .into_iter()
            .enumerate()
            .map(|(i, source)| PushCandidate {
                id: i.to_string(),
                source,
                kind: PushKind::Error,
                label: None,
                remaining_percent: None,
                due_at_ms: 1_000,
                expires_at_ms: 10_000,
            })
            .collect();
        let mut calls = 0;
        let errors = dispatch(
            candidates,
            1_000,
            || s.clone(),
            |_| {
                calls += 1;
                if calls == 1 {
                    Err(bark::BarkError::Unsent)
                } else {
                    Ok(())
                }
            },
        );
        assert_eq!(calls, 2);
        assert_eq!(errors.len(), 1);
    }

    #[test]
    fn quota_adapters_run_only_for_enabled_source_and_category() {
        let mut s = enabled();
        assert!(!should_poll_quota(&s, AgentSource::Claude));
        s.quota.at20 = true;
        assert!(should_poll_quota(&s, AgentSource::Claude));
        s.sources.claude = false;
        assert!(!should_poll_quota(&s, AgentSource::Claude));
        assert!(should_poll_quota(&s, AgentSource::Codex));
        s.enabled = false;
        assert!(!should_poll_quota(&s, AgentSource::Codex));
    }

    #[test]
    fn startup_baselines_old_event_files() {
        let dir = tempfile::tempdir().unwrap();
        let event_dir = dir.path().join("events");
        std::fs::create_dir_all(&event_dir).unwrap();
        std::fs::write(
            event_dir.join("old.json"),
            serde_json::to_vec(&event("old", AgentEventKind::Permission, 1_000)).unwrap(),
        )
        .unwrap();
        let mut spool = events::EventSpool::new(event_dir.clone());
        spool.baseline().unwrap();
        assert!(spool.drain(2_000).is_empty());
    }

    #[test]
    fn quota_provider_failure_does_not_stop_other_source() {
        let dir = tempfile::tempdir().unwrap();
        let mut core = NotificationCore::new(dir.path().join("ledger.json"));
        let mut s = enabled();
        s.quota.at50 = true;
        let q = |remaining| QuotaWindow {
            source: AgentSource::Codex,
            bucket_id: "a".into(),
            bucket_label: "a".into(),
            duration_mins: 300,
            used_percent: 100.0 - remaining,
            resets_at: 9999,
            reached: false,
        };
        core.quota(q(85.0), 1_000, &s, || s.clone(), |_| Ok(()));
        let mut sent = 0;
        core.quota(
            q(45.0),
            2_000,
            &s,
            || s.clone(),
            |_| {
                sent += 1;
                Ok(())
            },
        );
        assert_eq!(sent, 1);
    }

    #[test]
    fn notification_commands_are_scoped_to_settings_window() {
        assert!(service::can_access_notification_commands("notifications"));
        assert!(!service::can_access_notification_commands("pet"));
        assert!(!service::can_access_notification_commands("settings"));
    }
}
