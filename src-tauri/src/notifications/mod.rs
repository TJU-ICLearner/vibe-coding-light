pub mod bark;
pub mod claude_quota;
pub mod codex_quota;
mod detail_capture;
pub mod diagnostics;
pub mod engine;
pub mod events;
pub mod keychain;
pub mod model;
pub mod service;
pub mod test_console;

#[cfg(test)]
mod integration_tests;
pub mod settings;

use bark::BarkError;
use diagnostics::{DiagnosticEntry, DiagnosticOutcome, DiagnosticReason};
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

    pub fn quota_settings_changed(
        &mut self,
        old: &NotificationSettings,
        new: &NotificationSettings,
    ) {
        self.engine.quota_settings_changed(old, new);
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

    pub fn events_with_diagnostics<F, G, H>(
        &mut self,
        events: Vec<AgentEvent>,
        now_ms: u64,
        settings: &NotificationSettings,
        current: F,
        send: G,
        mut record: H,
    ) -> Vec<BarkError>
    where
        F: FnMut() -> NotificationSettings,
        G: FnMut(PushCandidate) -> Result<(), BarkError>,
        H: FnMut(DiagnosticEntry),
    {
        let mut candidates = Vec::new();
        for event in events {
            let (produced, (outcome, reason), canceled) =
                self.engine
                    .on_event_tracked(event.clone(), now_ms, settings);
            if event.kind != model::AgentEventKind::Working {
                record(DiagnosticEntry::from_event_decision(
                    &event, now_ms, outcome, reason,
                ));
            }
            for candidate in canceled {
                record(DiagnosticEntry::from_candidate(
                    &candidate,
                    now_ms,
                    DiagnosticOutcome::Skipped,
                    Some(DiagnosticReason::Superseded),
                ));
            }
            candidates.extend(produced);
        }
        dispatch_tracked(candidates, now_ms, current, send, record)
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

    pub fn quota_with_diagnostics<F, G, H>(
        &mut self,
        window: QuotaWindow,
        now_ms: u64,
        settings: &NotificationSettings,
        current: F,
        send: G,
        record: H,
    ) -> Vec<BarkError>
    where
        F: FnMut() -> NotificationSettings,
        G: FnMut(PushCandidate) -> Result<(), BarkError>,
        H: FnMut(DiagnosticEntry),
    {
        let candidates = self.engine.on_quota(window, now_ms, settings);
        dispatch_tracked(candidates, now_ms, current, send, record)
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

    pub fn flush_with_diagnostics<F, G, H>(
        &mut self,
        now_ms: u64,
        settings: &NotificationSettings,
        current: F,
        send: G,
        mut record: H,
    ) -> Vec<BarkError>
    where
        F: FnMut() -> NotificationSettings,
        G: FnMut(PushCandidate) -> Result<(), BarkError>,
        H: FnMut(DiagnosticEntry),
    {
        let (candidates, skipped) = self.engine.flush_due_tracked(now_ms, settings);
        for (candidate, reason) in skipped {
            record(DiagnosticEntry::from_candidate(
                &candidate,
                now_ms,
                DiagnosticOutcome::Skipped,
                Some(reason),
            ));
        }
        dispatch_tracked(candidates, now_ms, current, send, record)
    }
}

pub fn should_poll_quota(settings: &NotificationSettings, source: AgentSource) -> bool {
    settings.enabled
        && matches!(source, AgentSource::Claude | AgentSource::Codex)
        && settings.sources.enabled(source)
        && (settings.quota.at80
            || settings.quota.at50
            || settings.quota.at20
            || settings.quota.at0
            || settings.quota.at_week0
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

fn dispatch_tracked<F, G, H>(
    candidates: Vec<PushCandidate>,
    now_ms: u64,
    mut current: F,
    mut send: G,
    mut record: H,
) -> Vec<BarkError>
where
    F: FnMut() -> NotificationSettings,
    G: FnMut(PushCandidate) -> Result<(), BarkError>,
    H: FnMut(DiagnosticEntry),
{
    let mut errors = Vec::new();
    for candidate in candidates {
        let settings = current();
        if candidate_allowed(&candidate, &settings, now_ms) {
            if let Err(error) = send(candidate) {
                errors.push(error);
            }
        } else {
            let reason = candidate_skip_reason(&candidate, &settings, now_ms);
            record(DiagnosticEntry::from_candidate(
                &candidate,
                now_ms,
                DiagnosticOutcome::Skipped,
                Some(reason),
            ));
        }
    }
    errors
}

pub fn candidate_skip_reason(
    candidate: &PushCandidate,
    settings: &NotificationSettings,
    now_ms: u64,
) -> DiagnosticReason {
    if now_ms < candidate.due_at_ms || now_ms >= candidate.expires_at_ms {
        DiagnosticReason::Expired
    } else if !settings.enabled {
        DiagnosticReason::NotificationsDisabled
    } else if !settings.sources.enabled(candidate.source) {
        DiagnosticReason::SourceDisabled
    } else {
        DiagnosticReason::TypeDisabled
    }
}

pub fn candidate_allowed(
    candidate: &PushCandidate,
    settings: &NotificationSettings,
    now_ms: u64,
) -> bool {
    if now_ms < candidate.due_at_ms || now_ms >= candidate.expires_at_ms {
        return false;
    }
    if !settings.enabled || !settings.sources.enabled(candidate.source) {
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
        PushKind::QuotaThreshold(0) if candidate.quota_duration_mins == Some(10080) => {
            settings.quota.at_week0
        }
        PushKind::QuotaThreshold(0) => settings.quota.at0,
        PushKind::QuotaThreshold(_) => false,
        PushKind::QuotaRecovered => settings.quota.recovered,
        PushKind::Test => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notifications::diagnostics::{DiagnosticOutcome, DiagnosticReason};
    use crate::notifications::model::{
        AgentEvent, AgentEventKind, AgentSource, NotificationSettings, PushCandidate, PushKind,
        QuotaWindow,
    };

    fn enabled() -> NotificationSettings {
        let mut s = NotificationSettings::default();
        s.enabled = true;
        s
    }

    #[test]
    fn dispatch_uses_the_independent_weekly_zero_switch() {
        let mut settings = enabled();
        settings.quota.at_week0 = true;
        let candidate = PushCandidate {
            id: "weekly-zero".into(),
            source: AgentSource::Codex,
            kind: PushKind::QuotaThreshold(0),
            label: Some("7 days · 10080 min".into()),
            quota_duration_mins: Some(10080),
            remaining_percent: Some(0.0),
            details: Default::default(),
            due_at_ms: 1_000,
            expires_at_ms: 10_000,
        };
        assert!(candidate_allowed(&candidate, &settings, 1_000));
        settings.quota.at_week0 = false;
        settings.quota.at0 = true;
        assert!(!candidate_allowed(&candidate, &settings, 1_000));
    }

    #[test]
    fn weekly_zero_alone_keeps_quota_polling_enabled() {
        let mut settings = enabled();
        settings.quota.at_week0 = true;
        assert!(should_poll_quota(&settings, AgentSource::Codex));
    }

    #[test]
    fn new_source_switch_gates_bark_and_never_starts_quota_polling() {
        let mut settings = enabled();
        let candidate = PushCandidate {
            id: "cursor-done".into(),
            source: AgentSource::Cursor,
            kind: PushKind::Completed,
            label: None,
            quota_duration_mins: None,
            remaining_percent: None,
            details: Default::default(),
            due_at_ms: 1_000,
            expires_at_ms: 10_000,
        };
        assert!(!candidate_allowed(&candidate, &settings, 2_000));
        settings.sources.cursor = true;
        assert!(candidate_allowed(&candidate, &settings, 2_000));
        settings.quota.at80 = true;
        assert!(!should_poll_quota(&settings, AgentSource::Cursor));
    }

    fn event(id: &str, kind: AgentEventKind, at: u64) -> AgentEvent {
        AgentEvent {
            id: id.into(),
            source: AgentSource::Claude,
            session_id: "session".into(),
            turn_id: None,
            kind,
            at_ms: at,
            new_turn: false,
            details: Default::default(),
        }
    }

    #[test]
    fn diagnostic_dispatch_reports_duplicate_and_superseded_completion() {
        let dir = tempfile::tempdir().unwrap();
        let mut core = NotificationCore::new(dir.path().join("ledger.json"));
        let settings = enabled();
        let mut records = Vec::new();
        core.events_with_diagnostics(
            vec![
                event("first", AgentEventKind::Permission, 1_000),
                event("second", AgentEventKind::Permission, 1_001),
            ],
            1_001,
            &settings,
            || settings.clone(),
            |_| Ok(()),
            |entry| records.push(entry),
        );
        assert!(records
            .iter()
            .any(|entry| entry.outcome == DiagnosticOutcome::Skipped
                && entry.reason == Some(DiagnosticReason::Duplicate)));
        records.clear();
        core.events_with_diagnostics(
            vec![
                event("done", AgentEventKind::Completed, 2_000),
                event("working", AgentEventKind::Working, 2_001),
            ],
            2_001,
            &settings,
            || settings.clone(),
            |_| Ok(()),
            |entry| records.push(entry),
        );
        assert!(records
            .iter()
            .any(|entry| entry.kind == "completed"
                && entry.reason == Some(DiagnosticReason::Superseded)));
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
            quota_duration_mins: None,
            remaining_percent: None,
            details: Default::default(),
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
                quota_duration_mins: None,
                remaining_percent: None,
                details: Default::default(),
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
