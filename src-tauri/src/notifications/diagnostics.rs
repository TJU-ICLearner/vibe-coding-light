use super::model::{
    AgentEvent, AgentEventKind, AgentSource, NotificationSettings, PushCandidate, PushKind,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

const MAX_ENTRIES: usize = 100;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticOutcome {
    Observed,
    Deferred,
    Sent,
    Skipped,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticReason {
    NotificationsDisabled,
    StateOnly,
    Duplicate,
    Expired,
    SourceDisabled,
    TypeDisabled,
    Cooldown,
    QuietHours,
    Superseded,
    KeyMissing,
    Rejected,
    Network,
    Unconfirmed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEntry {
    pub at_ms: u64,
    pub source: Option<AgentSource>,
    pub kind: String,
    pub outcome: DiagnosticOutcome,
    pub reason: Option<DiagnosticReason>,
}

impl DiagnosticEntry {
    pub fn from_event_decision(
        event: &AgentEvent,
        at_ms: u64,
        outcome: DiagnosticOutcome,
        reason: Option<DiagnosticReason>,
    ) -> Self {
        let kind = match event.kind {
            AgentEventKind::Working => "working",
            AgentEventKind::Permission => "permission",
            AgentEventKind::Question => "question",
            AgentEventKind::Completed => "completed",
            AgentEventKind::Error => "error",
        };
        Self {
            at_ms,
            source: Some(event.source),
            kind: kind.into(),
            outcome,
            reason,
        }
    }

    pub fn from_event(event: &AgentEvent, at_ms: u64, settings: &NotificationSettings) -> Self {
        let (kind, selected) = match event.kind {
            AgentEventKind::Working => ("working", false),
            AgentEventKind::Permission => ("permission", settings.events.permission),
            AgentEventKind::Question => ("question", settings.events.question),
            AgentEventKind::Completed => ("completed", settings.events.completed),
            AgentEventKind::Error => ("error", settings.events.error),
        };
        let source_on = match event.source {
            AgentSource::Claude => settings.sources.claude,
            AgentSource::Codex => settings.sources.codex,
        };
        let (outcome, reason) = if !settings.enabled {
            (
                DiagnosticOutcome::Skipped,
                Some(DiagnosticReason::NotificationsDisabled),
            )
        } else if !source_on {
            (
                DiagnosticOutcome::Skipped,
                Some(DiagnosticReason::SourceDisabled),
            )
        } else if event.kind == AgentEventKind::Working {
            (
                DiagnosticOutcome::Observed,
                Some(DiagnosticReason::StateOnly),
            )
        } else if !selected {
            (
                DiagnosticOutcome::Skipped,
                Some(DiagnosticReason::TypeDisabled),
            )
        } else if event.kind == AgentEventKind::Completed {
            (DiagnosticOutcome::Deferred, None)
        } else {
            (DiagnosticOutcome::Observed, None)
        };
        Self {
            at_ms,
            source: Some(event.source),
            kind: kind.into(),
            outcome,
            reason,
        }
    }

    pub fn from_candidate(
        candidate: &PushCandidate,
        at_ms: u64,
        outcome: DiagnosticOutcome,
        reason: Option<DiagnosticReason>,
    ) -> Self {
        let kind = match candidate.kind {
            PushKind::Permission => "permission",
            PushKind::Question => "question",
            PushKind::Completed => "completed",
            PushKind::Error => "error",
            PushKind::QuotaThreshold(80) => "quota80",
            PushKind::QuotaThreshold(50) => "quota50",
            PushKind::QuotaThreshold(20) => "quota20",
            PushKind::QuotaThreshold(0) => "quota0",
            PushKind::QuotaThreshold(_) => "quota_other",
            PushKind::QuotaRecovered => "recovered",
            PushKind::Test => "test",
        };
        Self {
            at_ms,
            source: Some(candidate.source),
            kind: kind.into(),
            outcome,
            reason,
        }
    }
}

pub struct DiagnosticStore {
    path: PathBuf,
    entries: Vec<DiagnosticEntry>,
}

impl DiagnosticStore {
    pub fn load(path: PathBuf) -> Self {
        let mut entries: Vec<DiagnosticEntry> = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        if entries.len() > MAX_ENTRIES {
            entries.drain(..entries.len() - MAX_ENTRIES);
        }
        Self { path, entries }
    }

    pub fn entries(&self) -> Vec<DiagnosticEntry> {
        self.entries.clone()
    }

    pub fn append(&mut self, entry: DiagnosticEntry) -> Result<(), String> {
        self.entries.push(entry);
        if self.entries.len() > MAX_ENTRIES {
            self.entries.remove(0);
        }
        self.persist()
    }

    pub fn clear(&mut self) -> Result<(), String> {
        self.entries.clear();
        self.persist()
    }

    fn persist(&self) -> Result<(), String> {
        let parent = self.path.parent().ok_or("Diagnostics path has no parent")?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let mut temp =
            tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
        serde_json::to_writer(&mut temp, &self.entries).map_err(|error| error.to_string())?;
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
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notifications::model::{EventDetails, PushCandidate};

    fn candidate() -> PushCandidate {
        PushCandidate {
            id: "secret-id".into(),
            source: AgentSource::Codex,
            kind: PushKind::Error,
            label: Some("private label".into()),
            quota_duration_mins: None,
            remaining_percent: None,
            details: EventDetails {
                error: Some("SECRET_ERROR_TEXT".into()),
                ..Default::default()
            },
            due_at_ms: 0,
            expires_at_ms: 1000,
        }
    }

    #[test]
    fn keeps_only_recent_metadata_and_never_persists_payload_text() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("diagnostics.json");
        let mut store = DiagnosticStore::load(path.clone());
        for at_ms in 0..110 {
            store
                .append(DiagnosticEntry::from_candidate(
                    &candidate(),
                    at_ms,
                    DiagnosticOutcome::Failed,
                    Some(DiagnosticReason::Network),
                ))
                .unwrap();
        }
        let entries = DiagnosticStore::load(path.clone()).entries();
        assert_eq!(entries.len(), MAX_ENTRIES);
        assert_eq!(entries[0].at_ms, 10);
        assert_eq!(entries[99].kind, "error");
        let stored = std::fs::read_to_string(path).unwrap();
        assert!(!stored.contains("SECRET_ERROR_TEXT"));
        assert!(!stored.contains("private label"));
        assert!(!stored.contains("secret-id"));
    }

    #[test]
    fn clear_removes_visible_and_persisted_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("diagnostics.json");
        let mut store = DiagnosticStore::load(path.clone());
        store
            .append(DiagnosticEntry::from_candidate(
                &candidate(),
                1,
                DiagnosticOutcome::Sent,
                None,
            ))
            .unwrap();
        store.clear().unwrap();
        assert!(store.entries().is_empty());
        assert!(DiagnosticStore::load(path).entries().is_empty());
    }

    #[test]
    fn classifies_disabled_and_deferred_events_without_copying_details() {
        let event = AgentEvent {
            id: "secret-id".into(),
            source: AgentSource::Claude,
            session_id: "secret-session".into(),
            turn_id: None,
            kind: AgentEventKind::Completed,
            at_ms: 1,
            new_turn: false,
            details: EventDetails {
                task: Some("PRIVATE TASK".into()),
                ..Default::default()
            },
        };
        let mut settings = NotificationSettings::default();
        let off = DiagnosticEntry::from_event(&event, 2, &settings);
        assert_eq!(
            (off.outcome, off.reason),
            (
                DiagnosticOutcome::Skipped,
                Some(DiagnosticReason::NotificationsDisabled)
            )
        );
        settings.enabled = true;
        let pending = DiagnosticEntry::from_event(&event, 2, &settings);
        assert_eq!(
            (pending.outcome, pending.reason),
            (DiagnosticOutcome::Deferred, None)
        );
        assert_eq!(pending.kind, "completed");
        assert!(!serde_json::to_string(&pending)
            .unwrap()
            .contains("PRIVATE TASK"));
    }
}
