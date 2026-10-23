use super::model::{AgentSource, QuotaWindow};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub struct CodexQuota;

impl CodexQuota {
    pub fn read(timeout: Duration) -> Result<Vec<QuotaWindow>, String> {
        Self::read_with_binary(Path::new("codex"), timeout)
    }

    pub fn read_with_binary(binary: &Path, timeout: Duration) -> Result<Vec<QuotaWindow>, String> {
        let mut child = Command::new(binary)
            .arg("app-server")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Codex App Server unavailable".to_string())?;
        let result = (|| {
            let mut stdin = child.stdin.take().ok_or("Codex input unavailable")?;
            for message in [
                json!({"method":"initialize","id":0,"params":{"clientInfo":{"name":"vibe_coding_light","title":"Vibe Coding Light","version":env!("CARGO_PKG_VERSION")}}}),
                json!({"method":"initialized","params":{}}),
                json!({"method":"account/rateLimits/read","id":1}),
            ] {
                serde_json::to_writer(&mut stdin, &message).map_err(|_| "Codex request failed")?;
                stdin.write_all(b"\n").map_err(|_| "Codex request failed")?;
            }
            stdin.flush().map_err(|_| "Codex request failed")?;
            let stdout = child.stdout.take().ok_or("Codex output unavailable")?;
            let (tx, rx) = mpsc::channel();
            std::thread::spawn(move || {
                let mut reader = BufReader::new(stdout);
                loop {
                    let mut line = String::new();
                    match reader.read_line(&mut line) {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            if tx.send(line).is_err() {
                                break;
                            }
                        }
                    }
                }
            });
            let start = Instant::now();
            loop {
                let remaining = timeout
                    .checked_sub(start.elapsed())
                    .ok_or("Codex quota request timed out")?;
                let line = rx
                    .recv_timeout(remaining)
                    .map_err(|_| "Codex quota request timed out")?;
                if line.len() > 128 * 1024 {
                    return Err("Codex response too large".into());
                }
                let message: Value =
                    serde_json::from_str(&line).map_err(|_| "Invalid Codex response")?;
                if message.get("id") == Some(&json!(1)) {
                    return parse_rate_limits(&message);
                }
            }
        })();
        let _ = child.kill();
        let _ = child.wait();
        result
    }
}

pub fn parse_rate_limits(value: &Value) -> Result<Vec<QuotaWindow>, String> {
    let result = value.get("result").unwrap_or(value);
    let mut windows = Vec::new();
    if let Some(buckets) = result.get("rateLimitsByLimitId").and_then(Value::as_object) {
        for (key, bucket) in buckets {
            parse_bucket(bucket, key, &mut windows);
        }
    } else if let Some(bucket) = result.get("rateLimits") {
        let key = bucket
            .get("limitId")
            .and_then(Value::as_str)
            .unwrap_or("codex");
        parse_bucket(bucket, key, &mut windows);
    }
    if windows.is_empty() {
        return Err("Codex quota unavailable".into());
    }
    Ok(windows)
}

fn parse_bucket(bucket: &Value, fallback_id: &str, output: &mut Vec<QuotaWindow>) {
    let id = bucket
        .get("limitId")
        .and_then(Value::as_str)
        .unwrap_or(fallback_id);
    let label = bucket
        .get("limitName")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or(id);
    let reached_type = bucket
        .get("rateLimitReachedType")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    for kind in ["primary", "secondary"] {
        let Some(window) = bucket.get(kind) else {
            continue;
        };
        let Some(used) = window.get("usedPercent").and_then(Value::as_f64) else {
            continue;
        };
        let Some(duration) = window.get("windowDurationMins").and_then(Value::as_u64) else {
            continue;
        };
        let Some(reset) = window.get("resetsAt").and_then(Value::as_u64) else {
            continue;
        };
        if !used.is_finite() || !(0.0..=100.0).contains(&used) || duration == 0 || reset == 0 {
            continue;
        }
        output.push(QuotaWindow {
            source: AgentSource::Codex,
            bucket_id: format!("{id}:{kind}"),
            bucket_label: format!("{label} {kind}"),
            duration_mins: duration,
            used_percent: used,
            resets_at: reset,
            reached: used == 100.0 || reached_type.contains(kind),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    #[test]
    fn multi_bucket_primary_secondary_are_distinct() {
        let value = json!({"result":{"rateLimitsByLimitId":{"codex":{"limitId":"codex","limitName":"Coding","primary":{"usedPercent":20,"windowDurationMins":300,"resetsAt":2000000000},"secondary":{"usedPercent":40,"windowDurationMins":10080,"resetsAt":2000001000}},"other":{"limitId":"other","primary":{"usedPercent":10,"windowDurationMins":60,"resetsAt":2000002000}}},"rateLimits":{"limitId":"ignored","primary":{"usedPercent":99,"windowDurationMins":1,"resetsAt":2000000000}}}});
        let windows = parse_rate_limits(&value).unwrap();
        assert_eq!(windows.len(), 3);
        assert!(windows.iter().any(|w| w.bucket_id == "codex:primary"
            && w.bucket_label.contains("Coding")
            && w.duration_mins == 300));
        assert!(windows
            .iter()
            .any(|w| w.bucket_id == "codex:secondary" && w.duration_mins == 10080));
        assert!(!windows.iter().any(|w| w.bucket_id == "ignored:primary"));
    }

    #[test]
    fn single_bucket_fallback_and_invalid_data() {
        let value = json!({"result":{"rateLimits":{"limitId":"codex","primary":{"usedPercent":25,"windowDurationMins":300,"resetsAt":2000000000}}}});
        let windows = parse_rate_limits(&value).unwrap();
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].used_percent, 25.0);
        for bad in [
            json!({"error":{"message":"unauthorized"}}),
            json!({"result":{"rateLimits":{"primary":{"windowDurationMins":300,"resetsAt":2000000000}}}}),
            json!({"result":{"rateLimits":{"primary":{"usedPercent":101,"windowDurationMins":300,"resetsAt":2000000000}}}}),
        ] {
            assert!(parse_rate_limits(&bad).is_err());
        }
        assert!(serde_json::from_str::<serde_json::Value>("{broken").is_err());
    }

    #[test]
    fn absent_binary_is_unavailable() {
        assert!(CodexQuota::read_with_binary(
            std::path::Path::new("/path/that/does/not/exist"),
            Duration::from_millis(100)
        )
        .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn fake_app_server_proves_exchange_and_timeout_cleanup() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("fake-server");
        let log = dir.path().join("requests");
        fs::write(&script, format!("#!/bin/sh\nread a\nread b\nread c\nprintf '%s\\n%s\\n%s\\n' \"$a\" \"$b\" \"$c\" > '{}'\nprintf '%s\\n' '{{\"id\":0,\"result\":{{}}}}' '{{\"id\":1,\"result\":{{\"rateLimits\":{{\"limitId\":\"codex\",\"primary\":{{\"usedPercent\":50,\"windowDurationMins\":300,\"resetsAt\":2000000000}}}}}}}}'\nsleep 1\n", log.display())).unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
        let windows = CodexQuota::read_with_binary(&script, Duration::from_millis(500)).unwrap();
        assert_eq!(windows[0].used_percent, 50.0);
        let sent = fs::read_to_string(log).unwrap();
        assert!(sent.contains("\"method\":\"initialize\""));
        assert!(sent.contains("\"method\":\"initialized\""));
        assert!(sent.contains("\"method\":\"account/rateLimits/read\""));
        let hanging = dir.path().join("hanging-server");
        fs::write(&hanging, "#!/bin/sh\nsleep 10\n").unwrap();
        fs::set_permissions(&hanging, fs::Permissions::from_mode(0o700)).unwrap();
        let began = std::time::Instant::now();
        assert!(CodexQuota::read_with_binary(&hanging, Duration::from_millis(100)).is_err());
        assert!(began.elapsed() < Duration::from_secs(2));
    }
}
