use super::bark::PushPayload;
use super::diagnostics::DiagnosticReason;
use super::model::{AgentSource, EventDetails, NotificationSettings, PushCandidate, PushKind};
use crate::ui_locale::AppLocale;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TestEvent {
    Permission,
    Question,
    Completed,
    Error,
    Quota80,
    Quota50,
    Quota20,
    Quota0,
    QuotaWeek0,
    Recovered,
}

#[derive(Clone, Debug, Deserialize)]
pub struct TestRequest {
    pub source: AgentSource,
    pub event: TestEvent,
    pub duration_mins: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TestOutcome {
    Sent,
    Skipped,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct TestResult {
    pub outcome: TestOutcome,
    pub reason: Option<DiagnosticReason>,
}

pub fn rc_available(version: &str) -> bool {
    version.contains("-rc.")
}

pub fn candidate(
    request: &TestRequest,
    now_ms: u64,
    locale: AppLocale,
) -> Result<PushCandidate, String> {
    let (kind, remaining_percent) = match request.event {
        TestEvent::Permission => (PushKind::Permission, None),
        TestEvent::Question => (PushKind::Question, None),
        TestEvent::Completed => (PushKind::Completed, None),
        TestEvent::Error => (PushKind::Error, None),
        TestEvent::Quota80 => (PushKind::QuotaThreshold(80), Some(80.0)),
        TestEvent::Quota50 => (PushKind::QuotaThreshold(50), Some(50.0)),
        TestEvent::Quota20 => (PushKind::QuotaThreshold(20), Some(20.0)),
        TestEvent::Quota0 => (PushKind::QuotaThreshold(0), Some(0.0)),
        TestEvent::QuotaWeek0 => (PushKind::QuotaThreshold(0), Some(0.0)),
        TestEvent::Recovered => (PushKind::QuotaRecovered, Some(100.0)),
    };
    let quota = matches!(kind, PushKind::QuotaThreshold(_) | PushKind::QuotaRecovered);
    let label = match (quota, request.event, request.duration_mins) {
        (true, TestEvent::QuotaWeek0, Some(10080)) => Some("10080 min".into()),
        (true, TestEvent::QuotaWeek0, _) => {
            return Err("Weekly zero test needs seven-day period".into())
        }
        (true, TestEvent::Quota0, Some(300)) => Some("300 min".into()),
        (true, TestEvent::Quota0, _) => return Err("Other zero test needs five-hour period".into()),
        (true, _, Some(duration @ (300 | 10080))) => Some(format!("{duration} min")),
        (false, _, None) => None,
        _ => return Err("Invalid simulated quota period".into()),
    };
    let details = match locale {
        AppLocale::ZhCn => EventDetails {
            task: Some("模拟任务（测试）".into()),
            command: Some("echo '模拟命令（测试）'".into()),
            error: Some("模拟错误（测试）".into()),
            reply: Some("模拟回复（测试）".into()),
            question: Some("模拟问题（测试）".into()),
        },
        AppLocale::En => EventDetails {
            task: Some("Example task (test)".into()),
            command: Some("echo 'example command (test)'".into()),
            error: Some("Example error (test)".into()),
            reply: Some("Example reply (test)".into()),
            question: Some("Example question (test)".into()),
        },
    };
    Ok(PushCandidate {
        id: format!("simulated:{}", uuid::Uuid::new_v4()),
        source: request.source,
        kind,
        label,
        quota_duration_mins: request.duration_mins,
        remaining_percent,
        details,
        due_at_ms: now_ms,
        expires_at_ms: now_ms.saturating_add(30_000),
    })
}

pub fn decision(
    candidate: &PushCandidate,
    settings: &NotificationSettings,
    now_ms: u64,
    minute: u16,
) -> TestResult {
    if !super::candidate_allowed(candidate, settings, now_ms) {
        return TestResult {
            outcome: TestOutcome::Skipped,
            reason: Some(super::candidate_skip_reason(candidate, settings, now_ms)),
        };
    }
    if settings.quiet_hours.contains(minute) {
        return TestResult {
            outcome: TestOutcome::Skipped,
            reason: Some(DiagnosticReason::QuietHours),
        };
    }
    TestResult {
        outcome: TestOutcome::Sent,
        reason: None,
    }
}

pub fn connection_test_quiet(settings: &NotificationSettings, minute: u16) -> bool {
    settings.quiet_hours.contains(minute)
}

pub fn marked_payload(mut payload: PushPayload, locale: AppLocale) -> PushPayload {
    let marker = match locale {
        AppLocale::ZhCn => "[测试]",
        AppLocale::En => "[TEST]",
    };
    payload.title = format!("{marker} {}", payload.title);
    payload
}

pub fn diagnostic_kind(event: TestEvent) -> String {
    let suffix = match event {
        TestEvent::Permission => "permission",
        TestEvent::Question => "question",
        TestEvent::Completed => "completed",
        TestEvent::Error => "error",
        TestEvent::Quota80 => "quota80",
        TestEvent::Quota50 => "quota50",
        TestEvent::Quota20 => "quota20",
        TestEvent::Quota0 => "quota0",
        TestEvent::QuotaWeek0 => "quota_week0",
        TestEvent::Recovered => "recovered",
    };
    format!("test_{suffix}")
}

#[cfg(test)]
mod tests {
    use super::super::model::PushKind;
    use super::*;

    fn request(event: TestEvent, duration_mins: Option<u64>) -> TestRequest {
        TestRequest {
            source: AgentSource::Codex,
            event,
            duration_mins,
        }
    }

    #[test]
    fn maps_all_events_and_periods() {
        assert_eq!(
            serde_json::from_str::<TestEvent>("\"quota_week0\"").unwrap(),
            TestEvent::QuotaWeek0
        );
        let cases = [
            (TestEvent::Permission, PushKind::Permission),
            (TestEvent::Question, PushKind::Question),
            (TestEvent::Completed, PushKind::Completed),
            (TestEvent::Error, PushKind::Error),
            (TestEvent::Quota80, PushKind::QuotaThreshold(80)),
            (TestEvent::Quota50, PushKind::QuotaThreshold(50)),
            (TestEvent::Quota20, PushKind::QuotaThreshold(20)),
            (TestEvent::Quota0, PushKind::QuotaThreshold(0)),
            (TestEvent::QuotaWeek0, PushKind::QuotaThreshold(0)),
            (TestEvent::Recovered, PushKind::QuotaRecovered),
        ];
        for (event, expected) in cases {
            let duration = matches!(
                event,
                TestEvent::Quota80
                    | TestEvent::Quota50
                    | TestEvent::Quota20
                    | TestEvent::Quota0
                    | TestEvent::QuotaWeek0
                    | TestEvent::Recovered
            )
            .then_some(if event == TestEvent::QuotaWeek0 {
                10080
            } else {
                300
            });
            let made = candidate(&request(event, duration), 1_000, AppLocale::ZhCn).unwrap();
            assert_eq!(made.kind, expected);
            assert_eq!(made.source, AgentSource::Codex);
            assert_eq!(made.quota_duration_mins, duration);
            if let Some(minutes) = duration {
                assert!(made
                    .label
                    .as_deref()
                    .unwrap()
                    .contains(&format!("{minutes} min")));
            }
            assert!(diagnostic_kind(event).starts_with("test_"));
        }
        assert!(candidate(
            &request(TestEvent::Quota20, Some(10080)),
            1_000,
            AppLocale::En
        )
        .unwrap()
        .label
        .unwrap()
        .contains("10080 min"));
        assert!(candidate(&request(TestEvent::Quota20, Some(60)), 1_000, AppLocale::En).is_err());
        assert!(candidate(
            &request(TestEvent::QuotaWeek0, Some(300)),
            1_000,
            AppLocale::En
        )
        .is_err());
        assert!(candidate(
            &request(TestEvent::Quota0, Some(10080)),
            1_000,
            AppLocale::En
        )
        .is_err());
        assert!(candidate(
            &request(TestEvent::Permission, Some(300)),
            1_000,
            AppLocale::En
        )
        .is_err());
    }

    #[test]
    fn simulated_payload_is_marked_and_contains_only_examples() {
        let made = candidate(&request(TestEvent::Error, None), 1_000, AppLocale::ZhCn).unwrap();
        let mut settings = NotificationSettings::default();
        settings.include_details = true;
        let payload = marked_payload(
            crate::ui_copy::notification_payload_with_settings(&made, AppLocale::ZhCn, &settings),
            AppLocale::ZhCn,
        );
        assert!(payload.title.starts_with("[测试]"));
        assert!(payload.body.contains("模拟"));
        assert!(!payload.body.contains("real private task"));
        let english = marked_payload(
            crate::ui_copy::notification_payload_with_settings(
                &candidate(&request(TestEvent::Completed, None), 1_000, AppLocale::En).unwrap(),
                AppLocale::En,
                &settings,
            ),
            AppLocale::En,
        );
        assert!(english.title.starts_with("[TEST]"));
    }

    #[test]
    fn simulated_decision_reports_disabled_and_quiet_hours() {
        let made = candidate(
            &request(TestEvent::Quota20, Some(300)),
            1_000,
            AppLocale::En,
        )
        .unwrap();
        let mut settings = NotificationSettings::default();
        assert_eq!(
            decision(&made, &settings, 1_000, 23 * 60).reason,
            Some(DiagnosticReason::NotificationsDisabled)
        );
        settings.enabled = true;
        settings.sources.codex = false;
        assert_eq!(
            decision(&made, &settings, 1_000, 23 * 60).reason,
            Some(DiagnosticReason::SourceDisabled)
        );
        settings.sources.codex = true;
        assert_eq!(
            decision(&made, &settings, 1_000, 23 * 60).reason,
            Some(DiagnosticReason::TypeDisabled)
        );
        settings.quota.at20 = true;
        settings.quiet_hours.enabled = true;
        assert_eq!(
            decision(&made, &settings, 1_000, 23 * 60).reason,
            Some(DiagnosticReason::QuietHours)
        );
        assert_eq!(
            decision(&made, &settings, 1_000, 12 * 60).outcome,
            TestOutcome::Sent
        );
        settings.quiet_hours.bypass.quota = true;
        assert_eq!(
            decision(&made, &settings, 1_000, 23 * 60).reason,
            Some(DiagnosticReason::QuietHours)
        );
    }

    #[test]
    fn connection_test_is_skipped_during_quiet_hours_even_with_bypasses() {
        let mut settings = NotificationSettings::default();
        settings.enabled = true;
        settings.quiet_hours.enabled = true;
        settings.quiet_hours.bypass.permission = true;
        settings.quiet_hours.bypass.quota = true;
        assert!(connection_test_quiet(&settings, 23 * 60));
        assert!(!connection_test_quiet(&settings, 12 * 60));
    }

    #[test]
    fn rc_guard_rejects_stable_version() {
        assert!(rc_available("1.7.0-rc.4"));
        assert!(!rc_available("1.7.0"));
    }
}
