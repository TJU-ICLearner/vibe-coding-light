use super::model::{
    AgentEvent, AgentEventKind, AgentSource, NotificationSettings, PushCandidate, PushKind,
    QuotaWindow,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

const COMPLETE_DELAY_MS: u64 = 3_000;
const ERROR_COOLDOWN_MS: u64 = 30_000;
const CANDIDATE_TTL_MS: u64 = 120_000;
const COMPLETION_ERROR_TTL_MS: u64 = 600_000;
const EVENT_DEDUPE_MS: u64 = 86_400_000;

#[derive(Clone, Default, Serialize, Deserialize)]
struct QuotaState {
    previous_remaining: f64,
    resets_at: u64,
    crossed: Vec<u8>,
    alerted: bool,
    #[serde(default)]
    lowest_alerted: Option<u8>,
}

#[derive(Default, Serialize, Deserialize)]
struct Ledger {
    event_ids: HashMap<String, u64>,
    error_at: HashMap<String, u64>,
    quotas: HashMap<String, QuotaState>,
    #[serde(default)]
    turn_categories: HashMap<String, u64>,
}

struct PendingCompletion {
    source: AgentSource,
    session_id: String,
    turn_id: Option<String>,
    candidate: PushCandidate,
}

pub struct NotificationEngine {
    ledger_path: PathBuf,
    ledger: Ledger,
    pending: Vec<PendingCompletion>,
}

impl NotificationEngine {
    pub fn load(ledger_path: PathBuf) -> Self {
        let ledger = fs::read(&ledger_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            ledger_path,
            ledger,
            pending: Vec::new(),
        }
    }

    fn persist(&self) {
        let Some(parent) = self.ledger_path.parent() else {
            return;
        };
        if fs::create_dir_all(parent).is_err() {
            return;
        }
        let Ok(mut tmp) = tempfile::NamedTempFile::new_in(parent) else {
            return;
        };
        if serde_json::to_writer(&mut tmp, &self.ledger).is_err() || tmp.flush().is_err() {
            return;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if tmp
                .as_file()
                .set_permissions(fs::Permissions::from_mode(0o600))
                .is_err()
            {
                return;
            }
        }
        let _ = tmp.persist(&self.ledger_path);
    }

    pub fn on_event(
        &mut self,
        event: AgentEvent,
        now_ms: u64,
        settings: &NotificationSettings,
    ) -> Vec<PushCandidate> {
        let age_limit = if matches!(
            event.kind,
            AgentEventKind::Completed | AgentEventKind::Error
        ) {
            COMPLETION_ERROR_TTL_MS
        } else {
            CANDIDATE_TTL_MS
        };
        if event.at_ms > now_ms.saturating_add(60_000)
            || now_ms.saturating_sub(event.at_ms) >= age_limit
        {
            return Vec::new();
        }
        self.ledger
            .event_ids
            .retain(|_, at| now_ms.saturating_sub(*at) <= EVENT_DEDUPE_MS);
        self.ledger
            .turn_categories
            .retain(|_, at| now_ms.saturating_sub(*at) <= EVENT_DEDUPE_MS);
        if self.ledger.event_ids.contains_key(&event.id) {
            return Vec::new();
        }
        self.ledger.event_ids.insert(event.id.clone(), now_ms);
        if event.kind == AgentEventKind::Working {
            let prefix = format!("{:?}:{}:", event.source, event.session_id);
            self.ledger
                .turn_categories
                .retain(|key, _| !key.starts_with(&prefix));
        } else if matches!(
            event.kind,
            AgentEventKind::Permission | AgentEventKind::Question | AgentEventKind::Completed
        ) {
            let key = format!(
                "{:?}:{}:{}:{:?}",
                event.source,
                event.session_id,
                event.turn_id.as_deref().unwrap_or("no-turn"),
                event.kind
            );
            if self.ledger.turn_categories.contains_key(&key) {
                self.persist();
                return Vec::new();
            }
            self.ledger.turn_categories.insert(key, now_ms);
        }
        self.persist();
        if matches!(
            event.kind,
            AgentEventKind::Working
                | AgentEventKind::Permission
                | AgentEventKind::Question
                | AgentEventKind::Error
        ) {
            self.pending.retain(|pending| {
                pending.source != event.source
                    || pending.session_id != event.session_id
                    || (pending.turn_id.is_some()
                        && event.turn_id.is_some()
                        && pending.turn_id != event.turn_id)
            });
        }
        if !source_enabled(settings, event.source) {
            return Vec::new();
        }
        let kind = match event.kind {
            AgentEventKind::Working => return Vec::new(),
            AgentEventKind::Permission if settings.events.permission => PushKind::Permission,
            AgentEventKind::Question if settings.events.question => PushKind::Question,
            AgentEventKind::Completed if settings.events.completed => PushKind::Completed,
            AgentEventKind::Error if settings.events.error => PushKind::Error,
            _ => return Vec::new(),
        };
        let candidate = PushCandidate {
            id: event.id,
            source: event.source,
            kind: kind.clone(),
            label: None,
            remaining_percent: None,
            due_at_ms: now_ms.saturating_add(if kind == PushKind::Completed {
                COMPLETE_DELAY_MS
            } else {
                0
            }),
            expires_at_ms: event.at_ms.saturating_add(age_limit),
        };
        if kind == PushKind::Completed {
            self.pending.retain(|pending| {
                pending.source != event.source || pending.session_id != event.session_id
            });
            self.pending.push(PendingCompletion {
                source: event.source,
                session_id: event.session_id,
                turn_id: event.turn_id,
                candidate,
            });
            return Vec::new();
        }
        if kind == PushKind::Error {
            let key = format!("{:?}:{}", event.source, event.session_id);
            if self
                .ledger
                .error_at
                .get(&key)
                .is_some_and(|at| now_ms.saturating_sub(*at) < ERROR_COOLDOWN_MS)
            {
                return Vec::new();
            }
            self.ledger.error_at.insert(key, now_ms);
            self.persist();
        }
        vec![candidate]
    }

    pub fn flush_due(
        &mut self,
        now_ms: u64,
        settings: &NotificationSettings,
    ) -> Vec<PushCandidate> {
        let mut due = Vec::new();
        self.pending.retain(|pending| {
            if now_ms >= pending.candidate.expires_at_ms
                || !source_enabled(settings, pending.source)
                || !settings.events.completed
            {
                return false;
            }
            if now_ms >= pending.candidate.due_at_ms {
                due.push(pending.candidate.clone());
                return false;
            }
            true
        });
        due
    }

    pub fn on_quota(
        &mut self,
        window: QuotaWindow,
        now_ms: u64,
        settings: &NotificationSettings,
    ) -> Vec<PushCandidate> {
        if !window.used_percent.is_finite()
            || !(0.0..=100.0).contains(&window.used_percent)
            || window.duration_mins == 0
            || window.resets_at == 0
        {
            return Vec::new();
        }
        let remaining = 100.0 - window.used_percent;
        let key = format!(
            "{:?}:{}:{}",
            window.source, window.bucket_id, window.duration_mins
        );
        let Some(mut state) = self.ledger.quotas.get(&key).cloned() else {
            self.ledger.quotas.insert(
                key,
                QuotaState {
                    previous_remaining: remaining,
                    resets_at: window.resets_at,
                    ..Default::default()
                },
            );
            self.persist();
            return Vec::new();
        };
        let mut output = Vec::new();
        let reset_ready = now_ms >= state.resets_at.saturating_mul(1_000)
            && window.resets_at != state.resets_at
            && window.resets_at.saturating_sub(state.resets_at)
                >= window.duration_mins.saturating_mul(60) / 2
            && (!state.alerted
                || state
                    .lowest_alerted
                    .is_some_and(|level| remaining > level as f64));
        if reset_ready {
            if state.alerted && source_enabled(settings, window.source) && settings.quota.recovered
            {
                output.push(quota_candidate(
                    &window,
                    PushKind::QuotaRecovered,
                    remaining,
                    now_ms,
                ));
            }
            state.crossed.clear();
            state.alerted = false;
            state.lowest_alerted = None;
        }
        let crossed: Vec<u8> = [80, 50, 20, 0]
            .into_iter()
            .filter(|level| {
                !state.crossed.contains(level)
                    && state.previous_remaining > *level as f64
                    && (remaining <= *level as f64 || (*level == 0 && window.reached))
            })
            .collect();
        let selected = crossed
            .iter()
            .filter(|level| quota_switch(settings, **level))
            .min()
            .copied();
        state.crossed.extend(crossed);
        if source_enabled(settings, window.source) {
            if let Some(level) = selected {
                output.push(quota_candidate(
                    &window,
                    PushKind::QuotaThreshold(level),
                    remaining,
                    now_ms,
                ));
                state.alerted = true;
                state.lowest_alerted = Some(
                    state
                        .lowest_alerted
                        .map_or(level, |previous| previous.min(level)),
                );
            }
        }
        state.previous_remaining = remaining;
        if reset_ready || window.resets_at == state.resets_at {
            state.resets_at = window.resets_at;
        }
        self.ledger.quotas.insert(key, state);
        self.persist();
        output
    }
}

fn source_enabled(settings: &NotificationSettings, source: AgentSource) -> bool {
    settings.enabled
        && match source {
            AgentSource::Claude => settings.sources.claude,
            AgentSource::Codex => settings.sources.codex,
        }
}

fn quota_switch(settings: &NotificationSettings, level: u8) -> bool {
    match level {
        80 => settings.quota.at80,
        50 => settings.quota.at50,
        20 => settings.quota.at20,
        0 => settings.quota.at0,
        _ => false,
    }
}

fn quota_candidate(
    window: &QuotaWindow,
    kind: PushKind,
    remaining: f64,
    now_ms: u64,
) -> PushCandidate {
    PushCandidate {
        id: format!(
            "quota:{:?}:{}:{}:{}:{kind:?}",
            window.source, window.bucket_id, window.duration_mins, window.resets_at
        ),
        source: window.source,
        kind,
        label: Some(format!(
            "{} · {} min",
            window.bucket_label, window.duration_mins
        )),
        remaining_percent: Some(remaining),
        due_at_ms: now_ms,
        expires_at_ms: now_ms.saturating_add(CANDIDATE_TTL_MS),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> NotificationSettings {
        let mut s = NotificationSettings::default();
        s.enabled = true;
        s.quota.at80 = true;
        s.quota.at50 = true;
        s.quota.at20 = true;
        s.quota.at0 = true;
        s.quota.recovered = true;
        s
    }

    fn event(id: &str, session: &str, kind: AgentEventKind, at: u64) -> AgentEvent {
        AgentEvent {
            id: id.into(),
            source: AgentSource::Claude,
            session_id: session.into(),
            turn_id: Some("turn-1".into()),
            kind,
            at_ms: at,
        }
    }

    fn quota(bucket: &str, duration: u64, remaining: f64, reset: u64) -> QuotaWindow {
        QuotaWindow {
            source: AgentSource::Codex,
            bucket_id: bucket.into(),
            bucket_label: bucket.into(),
            duration_mins: duration,
            used_percent: 100.0 - remaining,
            resets_at: reset,
            reached: remaining == 0.0,
        }
    }

    #[test]
    fn turn_completion_canceled_by_following_work() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = NotificationEngine::load(dir.path().join("ledger.json"));
        let s = settings();
        assert!(e
            .on_event(event("a", "s", AgentEventKind::Completed, 1_000), 1_000, &s)
            .is_empty());
        assert!(e.flush_due(3_999, &s).is_empty());
        e.on_event(event("b", "s", AgentEventKind::Working, 2_000), 2_000, &s);
        assert!(e.flush_due(4_001, &s).is_empty());
    }

    #[test]
    fn interleaved_sessions_do_not_mask_completion() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = NotificationEngine::load(dir.path().join("ledger.json"));
        let s = settings();
        e.on_event(
            event("a", "s1", AgentEventKind::Completed, 1_000),
            1_000,
            &s,
        );
        e.on_event(event("b", "s2", AgentEventKind::Working, 2_000), 2_000, &s);
        let candidates = e.flush_due(4_000, &s);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].kind, PushKind::Completed);
        assert_eq!(candidates[0].due_at_ms, 4_000);
    }

    #[test]
    fn one_error_per_session_per_30_seconds() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = NotificationEngine::load(dir.path().join("ledger.json"));
        let s = settings();
        assert_eq!(
            e.on_event(event("a", "s", AgentEventKind::Error, 1_000), 1_000, &s)
                .len(),
            1
        );
        assert!(e
            .on_event(event("b", "s", AgentEventKind::Error, 29_000), 29_000, &s)
            .is_empty());
        assert_eq!(
            e.on_event(
                event("c", "other", AgentEventKind::Error, 29_000),
                29_000,
                &s
            )
            .len(),
            1
        );
        assert_eq!(
            e.on_event(event("d", "s", AgentEventKind::Error, 31_000), 31_000, &s)
                .len(),
            1
        );
    }

    #[test]
    fn first_quota_snapshot_is_baseline() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = NotificationEngine::load(dir.path().join("ledger.json"));
        assert!(e
            .on_quota(quota("primary", 300, 19.0, 9999), 1_000, &settings())
            .is_empty());
    }

    #[test]
    fn jump_from_85_to_45_sends_only_50() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = NotificationEngine::load(dir.path().join("ledger.json"));
        let s = settings();
        e.on_quota(quota("primary", 300, 85.0, 9999), 1_000, &s);
        let c = e.on_quota(quota("primary", 300, 45.0, 9999), 2_000, &s);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].kind, PushKind::QuotaThreshold(50));
        assert_eq!(c[0].remaining_percent, Some(45.0));
        assert!(c[0].label.as_deref().unwrap().contains("300"));
    }

    #[test]
    fn explicit_reached_triggers_zero() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = NotificationEngine::load(dir.path().join("ledger.json"));
        let s = settings();
        e.on_quota(quota("primary", 300, 45.0, 9999), 1_000, &s);
        let c = e.on_quota(quota("primary", 300, 0.0, 9999), 2_000, &s);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].kind, PushKind::QuotaThreshold(0));
    }

    #[test]
    fn each_bucket_and_window_is_independent() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = NotificationEngine::load(dir.path().join("ledger.json"));
        let s = settings();
        for (bucket, duration) in [("a", 300), ("b", 300), ("a", 10080)] {
            e.on_quota(quota(bucket, duration, 85.0, 9999), 1_000, &s);
        }
        for (bucket, duration) in [("a", 300), ("b", 300), ("a", 10080)] {
            assert_eq!(
                e.on_quota(quota(bucket, duration, 75.0, 9999), 2_000, &s)
                    .len(),
                1
            );
        }
    }

    #[test]
    fn reset_rearms_once_and_optional_recovery_fires_once() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = NotificationEngine::load(dir.path().join("ledger.json"));
        let s = settings();
        e.on_quota(quota("primary", 300, 85.0, 5), 1_000, &s);
        assert_eq!(
            e.on_quota(quota("primary", 300, 75.0, 5), 2_000, &s).len(),
            1
        );
        let recovered = e.on_quota(quota("primary", 300, 100.0, 18_005), 6_000, &s);
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].kind, PushKind::QuotaRecovered);
        assert!(e
            .on_quota(quota("primary", 300, 100.0, 18_005), 7_000, &s)
            .is_empty());
        assert_eq!(
            e.on_quota(quota("primary", 300, 75.0, 18_005), 8_000, &s)
                .len(),
            1
        );
    }

    #[test]
    fn ledger_survives_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ledger.json");
        let s = settings();
        let mut e = NotificationEngine::load(path.clone());
        e.on_quota(quota("primary", 300, 85.0, 9999), 1_000, &s);
        e.on_quota(quota("primary", 300, 75.0, 9999), 2_000, &s);
        e.on_event(
            event("x", "s", AgentEventKind::Permission, 3_000),
            3_000,
            &s,
        );
        let mut e = NotificationEngine::load(path);
        assert!(e
            .on_quota(quota("primary", 300, 74.0, 9999), 4_000, &s)
            .is_empty());
        assert!(e
            .on_event(
                event("x", "s", AgentEventKind::Permission, 4_000),
                4_000,
                &s
            )
            .is_empty());
    }

    #[test]
    fn disabled_source_or_category_yields_no_candidate() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = NotificationEngine::load(dir.path().join("ledger.json"));
        let mut s = settings();
        s.sources.claude = false;
        assert!(e
            .on_event(
                event("a", "s", AgentEventKind::Permission, 1_000),
                1_000,
                &s
            )
            .is_empty());
        s.sources.claude = true;
        s.events.permission = false;
        assert!(e
            .on_event(
                event("b", "s", AgentEventKind::Permission, 2_000),
                2_000,
                &s
            )
            .is_empty());
        s.sources.codex = false;
        e.on_quota(quota("primary", 300, 85.0, 9999), 1_000, &s);
        assert!(e
            .on_quota(quota("primary", 300, 75.0, 9999), 2_000, &s)
            .is_empty());
    }

    #[test]
    fn duplicate_hook_in_same_turn_does_not_push_twice() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = NotificationEngine::load(dir.path().join("ledger.json"));
        let s = settings();
        assert_eq!(
            e.on_event(
                event("a", "s", AgentEventKind::Permission, 1_000),
                1_000,
                &s
            )
            .len(),
            1
        );
        assert!(e
            .on_event(
                event("b", "s", AgentEventKind::Permission, 1_001),
                1_001,
                &s
            )
            .is_empty());
        e.on_event(event("c", "s", AgentEventKind::Working, 2_000), 2_000, &s);
        assert_eq!(
            e.on_event(
                event("d", "s", AgentEventKind::Permission, 3_000),
                3_000,
                &s
            )
            .len(),
            1
        );
    }

    #[test]
    fn stale_events_are_dropped_by_category_age() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = NotificationEngine::load(dir.path().join("ledger.json"));
        let s = settings();
        assert!(e
            .on_event(
                event("a", "s", AgentEventKind::Permission, 1_000),
                122_000,
                &s
            )
            .is_empty());
        assert!(e
            .on_event(
                event("b", "s", AgentEventKind::Completed, 1_000),
                602_000,
                &s
            )
            .is_empty());
        e.on_event(
            event("c", "s", AgentEventKind::Completed, 1_000),
            540_000,
            &s,
        );
        let candidate = e.flush_due(543_000, &s);
        assert_eq!(candidate.len(), 1);
        assert_eq!(candidate[0].expires_at_ms, 601_000);
    }

    #[test]
    fn reset_waits_until_remaining_exceeds_prior_alerted_level() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = NotificationEngine::load(dir.path().join("ledger.json"));
        let s = settings();
        e.on_quota(quota("primary", 300, 85.0, 5), 1_000, &s);
        assert_eq!(
            e.on_quota(quota("primary", 300, 75.0, 5), 2_000, &s).len(),
            1
        );
        assert!(e
            .on_quota(quota("primary", 300, 76.0, 18_005), 6_000, &s)
            .is_empty());
        let recovered = e.on_quota(quota("primary", 300, 85.0, 18_005), 7_000, &s);
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].kind, PushKind::QuotaRecovered);
    }

    #[test]
    fn small_reset_timestamp_drift_does_not_rearm() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = NotificationEngine::load(dir.path().join("ledger.json"));
        let s = settings();
        e.on_quota(quota("primary", 300, 85.0, 5), 1_000, &s);
        assert_eq!(
            e.on_quota(quota("primary", 300, 75.0, 5), 2_000, &s).len(),
            1
        );
        assert!(e
            .on_quota(quota("primary", 300, 90.0, 6), 6_000, &s)
            .is_empty());
    }
}
