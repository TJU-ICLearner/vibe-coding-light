use serde::{Deserialize, Serialize};

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
    pub recovered: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct NotificationSettings {
    pub enabled: bool,
    pub sources: SourceSwitches,
    pub events: EventSwitches,
    pub quota: QuotaSwitches,
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
    pub remaining_percent: Option<f64>,
    pub due_at_ms: u64,
    pub expires_at_ms: u64,
}
