use super::model::AgentEvent;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_FILE_BYTES: u64 = 16_384;
const MAX_AGE_MS: u64 = 600_000;

#[allow(dead_code)]
pub struct EventSpool {
    path: PathBuf,
}

#[allow(dead_code)]
impl EventSpool {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn baseline(&mut self) -> Result<(), String> {
        fs::create_dir_all(&self.path).map_err(|error| error.to_string())?;
        for entry in fs::read_dir(&self.path)
            .map_err(|error| error.to_string())?
            .flatten()
        {
            if entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "json")
            {
                let _ = fs::remove_file(entry.path());
            }
        }
        Ok(())
    }

    pub fn drain(&mut self, now_ms: u64) -> Vec<AgentEvent> {
        if fs::create_dir_all(&self.path).is_err() {
            return Vec::new();
        }
        let Ok(entries) = fs::read_dir(&self.path) else {
            return Vec::new();
        };
        let mut events = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_none_or(|extension| extension != "json") {
                continue;
            }
            if let Some(event) = Self::read_one(&path, now_ms) {
                events.push(event);
            }
            let _ = fs::remove_file(path);
        }
        events.sort_by(|a, b| a.at_ms.cmp(&b.at_ms).then_with(|| a.id.cmp(&b.id)));
        events
    }

    fn read_one(path: &Path, now_ms: u64) -> Option<AgentEvent> {
        let metadata = fs::metadata(path).ok()?;
        if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
            return None;
        }
        let bytes = fs::read(path).ok()?;
        let event: AgentEvent = serde_json::from_slice(&bytes).ok()?;
        if event.id.is_empty()
            || event.id.len() > 64
            || !event
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return None;
        }
        if path.file_stem()?.to_str()? != event.id {
            return None;
        }
        if event.session_id.is_empty()
            || event.session_id.len() > 128
            || !event
                .session_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return None;
        }
        if event.turn_id.as_ref().is_some_and(|id| {
            id.is_empty()
                || id.len() > 128
                || !id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        }) {
            return None;
        }
        if event.at_ms == 0
            || event.at_ms > now_ms.saturating_add(60_000)
            || now_ms.saturating_sub(event.at_ms) > MAX_AGE_MS
        {
            return None;
        }
        Some(event)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notifications::model::{AgentEvent, AgentEventKind, AgentSource};
    use std::fs;

    fn event(id: &str, at_ms: u64) -> AgentEvent {
        AgentEvent {
            id: id.into(),
            source: AgentSource::Claude,
            session_id: "s1".into(),
            turn_id: None,
            kind: AgentEventKind::Completed,
            at_ms,
        }
    }

    fn put(dir: &std::path::Path, name: &str, value: &str) {
        fs::write(dir.join(name), value).unwrap();
    }

    #[test]
    fn two_rapid_events_in_one_session_survive() {
        let dir = tempfile::tempdir().unwrap();
        put(
            dir.path(),
            "a.json",
            &serde_json::to_string(&event("a", 1000)).unwrap(),
        );
        put(
            dir.path(),
            "b.json",
            &serde_json::to_string(&event("b", 1001)).unwrap(),
        );
        let mut spool = EventSpool::new(dir.path().to_path_buf());
        let items = spool.drain(2000);
        assert_eq!(items.len(), 2);
        assert_eq!(
            items.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        assert!(spool.drain(2000).is_empty());
    }

    #[test]
    fn malformed_oversized_and_stale_files_do_not_block_valid_event() {
        let dir = tempfile::tempdir().unwrap();
        put(dir.path(), "bad.json", "{broken");
        put(dir.path(), "huge.json", &"x".repeat(20_000));
        put(
            dir.path(),
            "stale.json",
            &serde_json::to_string(&event("stale", 1000)).unwrap(),
        );
        put(
            dir.path(),
            "good.json",
            &serde_json::to_string(&event("good", 700_000)).unwrap(),
        );
        let mut spool = EventSpool::new(dir.path().to_path_buf());
        assert_eq!(spool.drain(701_000), vec![event("good", 700_000)]);
        assert!(fs::read_dir(dir.path()).unwrap().next().is_none());
    }

    #[test]
    fn startup_baseline_ignores_old_files_and_accepts_new_files() {
        let dir = tempfile::tempdir().unwrap();
        put(
            dir.path(),
            "old.json",
            &serde_json::to_string(&event("old", 1000)).unwrap(),
        );
        let mut spool = EventSpool::new(dir.path().to_path_buf());
        spool.baseline().unwrap();
        put(
            dir.path(),
            "new.json",
            &serde_json::to_string(&event("new", 2000)).unwrap(),
        );
        assert_eq!(spool.drain(3000), vec![event("new", 2000)]);
    }
}
