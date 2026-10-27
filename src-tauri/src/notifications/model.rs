use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct SourceSwitches {
    pub claude: bool,
    pub codex: bool,
}

impl Default for SourceSwitches {
    fn default() -> Self {
        Self {
            claude: true,
            codex: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct EventSwitches {
    pub permission: bool,
    pub question: bool,
    pub completed: bool,
    pub error: bool,
}

impl Default for EventSwitches {
    fn default() -> Self {
        Self {
            permission: true,
            question: true,
            completed: true,
            error: true,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct QuotaSwitches {
    pub at80: bool,
    pub at50: bool,
    pub at20: bool,
    pub at0: bool,
    pub at_week0: bool,
    pub recovered: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct NotificationSettings {
    pub enabled: bool,
    pub sources: SourceSwitches,
    pub events: EventSwitches,
    pub quota: QuotaSwitches,
    pub include_details: bool,
    pub templates: HashMap<String, NotificationTemplate>,
    pub quiet_hours: QuietHours,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct QuietHours {
    pub enabled: bool,
    pub start_minute: u16,
    pub end_minute: u16,
    pub bypass: QuietBypass,
}

impl Default for QuietHours {
    fn default() -> Self {
        Self {
            enabled: false,
            start_minute: 22 * 60,
            end_minute: 8 * 60,
            bypass: QuietBypass::default(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct QuietBypass {
    pub permission: bool,
    pub question: bool,
    pub completed: bool,
    pub error: bool,
    pub quota: bool,
}

impl Default for QuietBypass {
    fn default() -> Self {
        Self {
            permission: true,
            question: true,
            completed: false,
            error: true,
            quota: false,
        }
    }
}

impl QuietHours {
    pub fn contains(&self, local_minute: u16) -> bool {
        if !self.enabled
            || self.start_minute >= 1440
            || self.end_minute >= 1440
            || self.start_minute == self.end_minute
            || local_minute >= 1440
        {
            return false;
        }
        if self.start_minute < self.end_minute {
            local_minute >= self.start_minute && local_minute < self.end_minute
        } else {
            local_minute >= self.start_minute || local_minute < self.end_minute
        }
    }

    pub fn blocks(&self, kind: &PushKind, local_minute: u16) -> bool {
        if !self.contains(local_minute) {
            return false;
        }
        let bypass = match kind {
            PushKind::Permission => self.bypass.permission,
            PushKind::Question => self.bypass.question,
            PushKind::Completed => self.bypass.completed,
            PushKind::Error => self.bypass.error,
            PushKind::QuotaThreshold(_) | PushKind::QuotaRecovered => self.bypass.quota,
            PushKind::Test => true,
        };
        !bypass
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct NotificationTemplate {
    pub title: String,
    pub body: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct EventDetails {
    pub task: Option<String>,
    pub command: Option<String>,
    pub error: Option<String>,
    pub reply: Option<String>,
    pub question: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentSource {
    Claude,
    Codex,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentEventKind {
    Working,
    Permission,
    Question,
    Completed,
    Error,
}

#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentEvent {
    pub id: String,
    pub source: AgentSource,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub kind: AgentEventKind,
    pub at_ms: u64,
    #[serde(default)]
    pub new_turn: bool,
    #[serde(default)]
    pub details: EventDetails,
}

#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct QuotaWindow {
    pub source: AgentSource,
    pub bucket_id: String,
    pub bucket_label: String,
    pub duration_mins: u64,
    pub used_percent: f64,
    pub resets_at: u64,
    pub reached: bool,
}

#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq)]
pub enum PushKind {
    Permission,
    Question,
    Completed,
    Error,
    QuotaThreshold(u8),
    QuotaRecovered,
    Test,
}

#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq)]
pub struct PushCandidate {
    pub id: String,
    pub source: AgentSource,
    pub kind: PushKind,
    pub label: Option<String>,
    pub quota_duration_mins: Option<u64>,
    pub remaining_percent: Option<f64>,
    pub details: EventDetails,
    pub due_at_ms: u64,
    pub expires_at_ms: u64,
}

#[cfg(test)]
mod quiet_tests {
    use super::*;

    #[test]
    fn cross_midnight_interval_blocks_selected_events_and_keeps_priority_events() {
        let mut quiet = QuietHours::default();
        quiet.enabled = true;
        assert!(quiet.blocks(&PushKind::Completed, 23 * 60));
        assert!(quiet.blocks(&PushKind::QuotaThreshold(20), 7 * 60 + 59));
        assert!(!quiet.blocks(&PushKind::Completed, 8 * 60));
        assert!(!quiet.blocks(&PushKind::Completed, 21 * 60 + 59));
        assert!(!quiet.blocks(&PushKind::Permission, 23 * 60));
        assert!(!quiet.blocks(&PushKind::Question, 23 * 60));
        assert!(!quiet.blocks(&PushKind::Error, 23 * 60));
        assert!(!quiet.blocks(&PushKind::Test, 23 * 60));
    }

    #[test]
    fn same_day_interval_and_disabled_interval_use_local_wall_minutes() {
        let mut quiet = QuietHours::default();
        quiet.enabled = true;
        quiet.start_minute = 9 * 60;
        quiet.end_minute = 17 * 60;
        assert!(!quiet.blocks(&PushKind::Completed, 8 * 60 + 59));
        assert!(quiet.blocks(&PushKind::Completed, 9 * 60));
        assert!(quiet.blocks(&PushKind::Completed, 16 * 60 + 59));
        assert!(!quiet.blocks(&PushKind::Completed, 17 * 60));
        quiet.enabled = false;
        assert!(!quiet.blocks(&PushKind::Completed, 12 * 60));
    }
}
