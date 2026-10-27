use semver::Version;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

const RELEASES_API: &str =
    "https://api.github.com/repos/TJU-ICLearner/vibe-coding-light/releases?per_page=30";
const RELEASE_BASE: &str = "https://github.com/TJU-ICLearner/vibe-coding-light/releases/tag/";
const CHECK_INTERVAL_SECS: u64 = 86_400;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReleaseInfo {
    pub version: String,
    pub url: String,
}

#[derive(Deserialize)]
struct ApiRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
}

pub fn select_release(body: &str, current_version: &str) -> Result<Option<ReleaseInfo>, String> {
    let current = Version::parse(current_version).map_err(|error| error.to_string())?;
    let releases: Vec<ApiRelease> =
        serde_json::from_str(body).map_err(|error| error.to_string())?;
    let allow_prerelease = !current.pre.is_empty();
    let mut selected: Option<(Version, String)> = None;
    for release in releases {
        if release.draft || (release.prerelease && !allow_prerelease) {
            continue;
        }
        let tag = release.tag_name;
        if !tag
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'))
        {
            continue;
        }
        let Some(number) = tag.strip_prefix('v') else {
            continue;
        };
        let Ok(version) = Version::parse(number) else {
            continue;
        };
        if version <= current {
            continue;
        }
        if selected.as_ref().is_none_or(|(best, _)| version > *best) {
            selected = Some((version, tag));
        }
    }
    Ok(selected.map(|(version, tag)| ReleaseInfo {
        version: version.to_string(),
        url: format!("{RELEASE_BASE}{tag}"),
    }))
}

pub fn fetch_release(current_version: &str) -> Result<Option<ReleaseInfo>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(RELEASES_API)
        .header(
            reqwest::header::USER_AGENT,
            "Vibe-Coding-Light-update-check",
        )
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let body = response.text().map_err(|error| error.to_string())?;
    if body.len() > 2_000_000 {
        return Err("Release response too large".into());
    }
    select_release(&body, current_version)
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct UpdatePreferences {
    pub auto_check: bool,
    pub last_checked_at: u64,
    pub checked_successfully: bool,
    pub last_release_version: Option<String>,
}

pub struct UpdatePreferencesStore {
    path: PathBuf,
    value: UpdatePreferences,
}

impl UpdatePreferencesStore {
    pub fn load(path: PathBuf) -> Self {
        let value = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self { path, value }
    }

    pub fn get(&self) -> UpdatePreferences {
        self.value.clone()
    }

    pub fn should_check(&self, now: u64) -> bool {
        self.value.auto_check
            && (self.value.last_checked_at == 0
                || now.saturating_sub(self.value.last_checked_at) >= CHECK_INTERVAL_SECS)
    }

    pub fn set_auto_check(&mut self, enabled: bool) -> Result<(), String> {
        let mut next = self.value.clone();
        next.auto_check = enabled;
        self.save(next)
    }

    pub fn mark_checked(&mut self, at: u64) -> Result<(), String> {
        let mut next = self.value.clone();
        next.last_checked_at = at;
        self.save(next)
    }

    pub fn save_result(&mut self, release: Option<&ReleaseInfo>) -> Result<(), String> {
        let mut next = self.value.clone();
        next.checked_successfully = true;
        next.last_release_version = release.map(|item| item.version.clone());
        self.save(next)
    }

    pub fn cached_release(&self, current_version: &str) -> Option<ReleaseInfo> {
        if !self.value.checked_successfully {
            return None;
        }
        let current = Version::parse(current_version).ok()?;
        let release = Version::parse(self.value.last_release_version.as_deref()?).ok()?;
        if release <= current {
            return None;
        }
        let version = release.to_string();
        Some(ReleaseInfo {
            url: format!("{RELEASE_BASE}v{version}"),
            version,
        })
    }

    fn save(&mut self, next: UpdatePreferences) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or("Invalid update preferences path")?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let mut temp =
            tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
        serde_json::to_writer(&mut temp, &next).map_err(|error| error.to_string())?;
        temp.flush().map_err(|error| error.to_string())?;
        temp.persist(&self.path)
            .map_err(|error| error.to_string())?;
        self.value = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_selection_respects_channel_and_semver() {
        let body = r#"[
          {"tag_name":"v1.7.0-rc.1","draft":false,"prerelease":true},
          {"tag_name":"v1.6.0","draft":false,"prerelease":false},
          {"tag_name":"v9.0.0","draft":true,"prerelease":false},
          {"tag_name":"bad/tag","draft":false,"prerelease":false}
        ]"#;
        let prerelease = select_release(body, "1.6.0-rc.3").unwrap().unwrap();
        assert_eq!(prerelease.version, "1.7.0-rc.1");
        assert_eq!(
            prerelease.url,
            "https://github.com/TJU-ICLearner/vibe-coding-light/releases/tag/v1.7.0-rc.1"
        );
        let stable = select_release(body, "1.5.0").unwrap().unwrap();
        assert_eq!(stable.version, "1.6.0");
        assert!(select_release(body, "1.6.0").unwrap().is_none());
    }

    #[test]
    fn malformed_response_fails_without_a_false_update() {
        assert!(select_release("not json", "1.6.0").is_err());
        assert!(select_release("[]", "not-a-version").is_err());
    }

    #[test]
    fn preferences_default_off_persist_and_throttle_daily_checks() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("updates.json");
        let mut store = UpdatePreferencesStore::load(path.clone());
        assert!(!store.get().auto_check);
        assert!(!store.should_check(100_000));
        store.set_auto_check(true).unwrap();
        assert!(store.should_check(100_000));
        store.mark_checked(100_000).unwrap();
        assert!(!store.should_check(100_000 + 86_399));
        assert!(store.should_check(100_000 + 86_400));
        let loaded = UpdatePreferencesStore::load(path);
        assert!(loaded.get().auto_check);
        assert!(!loaded.should_check(100_001));
    }

    #[test]
    fn cached_valid_release_survives_restart_without_another_daily_request() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("updates.json");
        let mut store = UpdatePreferencesStore::load(path.clone());
        store.set_auto_check(true).unwrap();
        store.mark_checked(100_000).unwrap();
        let release = ReleaseInfo {
            version: "1.8.0-rc.1".into(),
            url: "https://github.com/TJU-ICLearner/vibe-coding-light/releases/tag/v1.8.0-rc.1"
                .into(),
        };
        store.save_result(Some(&release)).unwrap();
        let loaded = UpdatePreferencesStore::load(path);
        assert!(!loaded.should_check(100_001));
        assert_eq!(loaded.cached_release("1.7.0-rc.1").unwrap(), release);
        assert!(loaded.cached_release("1.8.0-rc.1").is_none());
    }
}
