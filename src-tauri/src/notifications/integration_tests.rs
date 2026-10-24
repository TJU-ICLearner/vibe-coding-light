use super::events::EventSpool;
use super::model::{AgentEvent, AgentEventKind, AgentSource, NotificationSettings, QuotaWindow};
use super::NotificationCore;
use crate::ui_locale::AppLocale;
use std::fs;

fn settings() -> NotificationSettings {
    let mut s = NotificationSettings::default();
    s.enabled = true;
    s.quota.at80 = true;
    s.quota.recovered = true;
    s
}

fn hook_file(
    dir: &std::path::Path,
    id: &str,
    source: AgentSource,
    session: &str,
    kind: AgentEventKind,
    at: u64,
) {
    let event = AgentEvent {
        id: id.into(),
        source,
        session_id: session.into(),
        turn_id: Some("turn-1".into()),
        kind,
        at_ms: at,
        new_turn: false,
        details: Default::default(),
    };
    fs::write(
        dir.join(format!("{id}.json")),
        serde_json::to_vec(&event).unwrap(),
    )
    .unwrap();
}

#[test]
fn hook_file_to_spool_to_engine_to_mock_bark_for_both_agents() {
    let dir = tempfile::tempdir().unwrap();
    let events = dir.path().join("events");
    fs::create_dir_all(&events).unwrap();
    hook_file(
        &events,
        "old",
        AgentSource::Claude,
        "old-session",
        AgentEventKind::Permission,
        500,
    );
    let mut spool = EventSpool::new(events.clone());
    spool.baseline().unwrap();
    hook_file(
        &events,
        "claude-permission",
        AgentSource::Claude,
        "c1",
        AgentEventKind::Permission,
        1_000,
    );
    hook_file(
        &events,
        "codex-completed",
        AgentSource::Codex,
        "x1",
        AgentEventKind::Completed,
        1_100,
    );
    hook_file(
        &events,
        "claude-working",
        AgentSource::Claude,
        "c2",
        AgentEventKind::Working,
        1_200,
    );
    let mut core = NotificationCore::new(dir.path().join("ledger.json"));
    let mut mock_bark = Vec::new();
    let s = settings();
    core.events(
        spool.drain(2_000),
        2_000,
        &s,
        || s.clone(),
        |candidate| {
            mock_bark.push(crate::ui_copy::notification_payload(
                &candidate,
                AppLocale::En,
            ));
            Ok(())
        },
    );
    assert_eq!(mock_bark.len(), 1);
    assert!(mock_bark[0].body.contains("Claude"));
    core.flush(
        5_000,
        &s,
        || s.clone(),
        |candidate| {
            mock_bark.push(crate::ui_copy::notification_payload(
                &candidate,
                AppLocale::En,
            ));
            Ok(())
        },
    );
    assert_eq!(mock_bark.len(), 2);
    assert!(mock_bark[1].body.contains("Codex"));
    assert!(mock_bark[1].body.contains("Current turn"));
    assert!(spool.drain(5_000).is_empty());
}

#[test]
fn quota_alert_ledger_survives_restart_and_reset() {
    let dir = tempfile::tempdir().unwrap();
    let ledger = dir.path().join("ledger.json");
    let s = settings();
    let window = |remaining, reset| QuotaWindow {
        source: AgentSource::Codex,
        bucket_id: "codex:primary".into(),
        bucket_label: "Coding primary".into(),
        duration_mins: 300,
        used_percent: 100.0 - remaining,
        resets_at: reset,
        reached: false,
    };
    let mut mock_bark = Vec::new();
    let mut core = NotificationCore::new(ledger.clone());
    core.quota(window(85.0, 5), 1_000, &s, || s.clone(), |_| Ok(()));
    core.quota(
        window(75.0, 5),
        2_000,
        &s,
        || s.clone(),
        |candidate| {
            mock_bark.push(candidate);
            Ok(())
        },
    );
    assert_eq!(mock_bark.len(), 1);
    let mut core = NotificationCore::new(ledger);
    core.quota(
        window(74.0, 5),
        3_000,
        &s,
        || s.clone(),
        |candidate| {
            mock_bark.push(candidate);
            Ok(())
        },
    );
    assert_eq!(mock_bark.len(), 1);
    core.quota(
        window(100.0, 18_005),
        6_000,
        &s,
        || s.clone(),
        |candidate| {
            mock_bark.push(candidate);
            Ok(())
        },
    );
    assert_eq!(mock_bark.len(), 2);
    assert_eq!(mock_bark[1].kind, super::model::PushKind::QuotaRecovered);
}
