use super::model::{AgentSource, QuotaWindow};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProxyConfig {
    pub snapshot_path: PathBuf,
    pub previous_command: Option<String>,
}

pub struct ClaudeQuota;

impl ClaudeQuota {
    pub fn install(settings_path: &Path, executable: &Path, data_dir: &Path) -> Result<(), String> {
        let mut settings = read_settings(settings_path)?;
        let command = proxy_command(executable, data_dir);
        if settings["statusLine"]["command"].as_str() == Some(&command) {
            if config_path(data_dir).is_file() && original_path(data_dir).is_file() {
                return Ok(());
            }
            return Err("Owned status line configuration is incomplete".into());
        }
        let previous = settings.get("statusLine").cloned();
        let previous_command = match previous.as_ref() {
            None => None,
            Some(value) if value["type"] == "command" => Some(
                value["command"]
                    .as_str()
                    .map(str::to_owned)
                    .ok_or("Unsupported status line command")?,
            ),
            Some(_) => return Err("Unsupported or managed status line configuration".into()),
        };
        fs::create_dir_all(data_dir).map_err(|error| error.to_string())?;
        atomic_json(&original_path(data_dir), &json!({"original": previous}))?;
        atomic_json(
            &config_path(data_dir),
            &ProxyConfig {
                snapshot_path: data_dir.join("claude-quota-snapshot.json"),
                previous_command,
            },
        )?;
        settings["statusLine"] = json!({"type":"command", "command":command});
        atomic_json(settings_path, &settings)
    }

    pub fn remove(settings_path: &Path, executable: &Path, data_dir: &Path) -> Result<(), String> {
        let mut settings = read_settings(settings_path)?;
        if settings["statusLine"]["command"].as_str() != Some(&proxy_command(executable, data_dir))
        {
            return Ok(());
        }
        let original: Value = serde_json::from_slice(
            &fs::read(original_path(data_dir)).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        let original = original
            .get("original")
            .ok_or("Missing original status line")?;
        if original.is_null() {
            settings
                .as_object_mut()
                .ok_or("Invalid settings")?
                .remove("statusLine");
        } else {
            settings["statusLine"] = original.clone();
        }
        atomic_json(settings_path, &settings)?;
        let _ = fs::remove_file(config_path(data_dir));
        let _ = fs::remove_file(original_path(data_dir));
        let _ = fs::remove_file(data_dir.join("claude-quota-snapshot.json"));
        Ok(())
    }

    pub fn read_snapshot(path: &Path) -> Result<Vec<QuotaWindow>, String> {
        let windows: Vec<QuotaWindow> =
            serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        if windows.is_empty() {
            return Err("Claude quota unavailable".into());
        }
        Ok(windows)
    }
}

pub fn run_statusline_proxy(
    mut stdin: impl Read,
    mut stdout: impl Write,
    config: &ProxyConfig,
) -> Result<(), String> {
    let mut input = Vec::new();
    stdin
        .read_to_end(&mut input)
        .map_err(|error| error.to_string())?;
    let windows = serde_json::from_slice::<Value>(&input)
        .ok()
        .map(|value| parse_snapshot(&value))
        .unwrap_or_default();
    if windows.is_empty() {
        let _ = fs::remove_file(&config.snapshot_path);
    } else {
        atomic_json(&config.snapshot_path, &windows)?;
    }
    if let Some(command) = &config.previous_command {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg(command)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| error.to_string())?;
        child
            .stdin
            .take()
            .ok_or("Status line stdin unavailable")?
            .write_all(&input)
            .map_err(|error| error.to_string())?;
        let output = child
            .wait_with_output()
            .map_err(|error| error.to_string())?;
        stdout
            .write_all(&output.stdout)
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err("Previous status line command failed".into());
        }
    }
    Ok(())
}

pub fn run_proxy_from_args() -> bool {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) != Some("--statusline-proxy") {
        return false;
    }
    let result = args
        .get(2)
        .ok_or("Missing proxy configuration".to_string())
        .and_then(|path| fs::read(path).map_err(|error| error.to_string()))
        .and_then(|bytes| {
            serde_json::from_slice::<ProxyConfig>(&bytes).map_err(|error| error.to_string())
        })
        .and_then(|config| run_statusline_proxy(std::io::stdin(), std::io::stdout(), &config));
    if result.is_err() {
        std::process::exit(1);
    }
    true
}

fn parse_snapshot(value: &Value) -> Vec<QuotaWindow> {
    [
        ("five_hour", "5 hours", 300),
        ("seven_day", "7 days", 10080),
    ]
    .into_iter()
    .filter_map(|(id, label, duration)| {
        let entry = value.get("rate_limits")?.get(id)?;
        let used = entry.get("used_percentage")?.as_f64()?;
        let reset = entry.get("resets_at")?.as_str()?;
        let reset_epoch = chrono::DateTime::parse_from_rfc3339(reset)
            .ok()?
            .timestamp();
        if !used.is_finite() || !(0.0..=100.0).contains(&used) || reset_epoch <= 0 {
            return None;
        }
        Some(QuotaWindow {
            source: AgentSource::Claude,
            bucket_id: id.into(),
            bucket_label: label.into(),
            duration_mins: duration,
            used_percent: used,
            resets_at: reset_epoch as u64,
            reached: used == 100.0,
        })
    })
    .collect()
}

fn read_settings(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(json!({}));
    }
    let value: Value = serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    if !value.is_object() {
        return Err("Claude settings must be an object".into());
    }
    Ok(value)
}

fn config_path(data_dir: &Path) -> PathBuf {
    data_dir.join("claude-statusline-proxy.json")
}
fn original_path(data_dir: &Path) -> PathBuf {
    data_dir.join("claude-statusline-original.json")
}
fn shell_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}
fn proxy_command(executable: &Path, data_dir: &Path) -> String {
    format!(
        "{} --statusline-proxy {}",
        shell_quote(executable),
        shell_quote(&config_path(data_dir))
    )
}

fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing parent")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    serde_json::to_writer_pretty(&mut temp, value).map_err(|error| error.to_string())?;
    temp.flush().map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temp.as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    temp.persist(path).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn absent_rate_limits_is_unavailable() {
        let dir = tempfile::tempdir().unwrap();
        let config = ProxyConfig {
            snapshot_path: dir.path().join("snapshot.json"),
            previous_command: None,
        };
        let mut output = Vec::new();
        run_statusline_proxy(
            r#"{"model":{"display_name":"Claude"}}"#.as_bytes(),
            &mut output,
            &config,
        )
        .unwrap();
        assert!(ClaudeQuota::read_snapshot(&config.snapshot_path).is_err());
    }

    #[test]
    fn five_hour_and_seven_day_normalize_independently() {
        let dir = tempfile::tempdir().unwrap();
        let config = ProxyConfig {
            snapshot_path: dir.path().join("snapshot.json"),
            previous_command: None,
        };
        let input = r#"{"rate_limits":{"five_hour":{"used_percentage":35.5,"resets_at":"2030-01-01T05:00:00Z"},"seven_day":{"used_percentage":70,"resets_at":"2030-01-07T00:00:00Z"}}}"#;
        run_statusline_proxy(input.as_bytes(), &mut Vec::new(), &config).unwrap();
        let windows = ClaudeQuota::read_snapshot(&config.snapshot_path).unwrap();
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].bucket_id, "five_hour");
        assert_eq!(windows[0].duration_mins, 300);
        assert_eq!(windows[0].used_percent, 35.5);
        assert_eq!(windows[1].bucket_id, "seven_day");
        assert_eq!(windows[1].duration_mins, 10080);
        assert_ne!(windows[0].resets_at, windows[1].resets_at);
    }

    #[test]
    fn existing_statusline_output_is_preserved_byte_for_byte() {
        let dir = tempfile::tempdir().unwrap();
        let config = ProxyConfig {
            snapshot_path: dir.path().join("snapshot.json"),
            previous_command: Some("printf 'line 1\\nline 2\\n'".into()),
        };
        let mut output = Vec::new();
        run_statusline_proxy(&b"{}"[..], &mut output, &config).unwrap();
        assert_eq!(output, b"line 1\nline 2\n");
    }

    #[test]
    fn install_twice_is_idempotent_and_remove_restores_previous() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        fs::write(
            &settings,
            r#"{"theme":"dark","statusLine":{"type":"command","command":"printf old"}}"#,
        )
        .unwrap();
        let exe = dir.path().join("app");
        let data = dir.path().join("data");
        ClaudeQuota::install(&settings, &exe, &data).unwrap();
        let first = fs::read_to_string(&settings).unwrap();
        ClaudeQuota::install(&settings, &exe, &data).unwrap();
        assert_eq!(fs::read_to_string(&settings).unwrap(), first);
        ClaudeQuota::remove(&settings, &exe, &data).unwrap();
        let restored: serde_json::Value =
            serde_json::from_slice(&fs::read(&settings).unwrap()).unwrap();
        assert_eq!(restored["statusLine"]["command"], "printf old");
        assert_eq!(restored["theme"], "dark");
    }

    #[test]
    fn later_user_edits_survive_removal() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        let exe = dir.path().join("app");
        let data = dir.path().join("data");
        ClaudeQuota::install(&settings, &exe, &data).unwrap();
        fs::write(
            &settings,
            r#"{"statusLine":{"type":"command","command":"my new status"}}"#,
        )
        .unwrap();
        ClaudeQuota::remove(&settings, &exe, &data).unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(&settings).unwrap()).unwrap();
        assert_eq!(value["statusLine"]["command"], "my new status");
    }

    #[test]
    fn malformed_or_managed_configuration_is_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        let exe = dir.path().join("app");
        let data = dir.path().join("data");
        for raw in ["{bad", r#"{"statusLine":{"type":"managed","command":"x"}}"#] {
            fs::write(&settings, raw).unwrap();
            assert!(ClaudeQuota::install(&settings, &exe, &data).is_err());
            assert_eq!(fs::read_to_string(&settings).unwrap(), raw);
        }
    }
}
