use quick_xml::{events::Event, Reader};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

const RELEASES_API: &str =
    "https://api.github.com/repos/TJU-ICLearner/vibe-coding-light/releases?per_page=30";
const RELEASE_BASE: &str = "https://github.com/TJU-ICLearner/vibe-coding-light/releases/tag/";
const RELEASES_ATOM: &str = "https://github.com/TJU-ICLearner/vibe-coding-light/releases.atom";
const CHECK_INTERVAL_SECS: u64 = 86_400;

// These releases predate the first stable 1.0.0. Some have stable-looking tags,
// so the Atom fallback and an old cached result must not offer them as updates.
const PRE_1_0_TEST_TAGS: &[&str] = &[
    "v1.0.0-test.1",
    "v1.0.1",
    "v1.1.0",
    "v1.1.1",
    "v1.2.0",
    "v1.3.0",
    "v1.4.0",
    "v1.5.0",
    "v1.5.0-rc.1",
    "v1.5.0-rc.2",
    "v1.5.0-rc.3",
    "v1.6.0-rc.1",
    "v1.6.0-rc.2",
    "v1.6.0-rc.3",
    "v1.7.0-rc.1",
    "v1.7.0-rc.2",
    "v1.7.0-rc.3",
    "v1.7.0-rc.4",
    "v1.7.0-rc.5",
    "v1.7.0-rc.6",
    "v1.8.0-rc.1",
];

fn is_pre_1_0_test_tag(tag: &str) -> bool {
    PRE_1_0_TEST_TAGS.contains(&tag)
}

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
        if current.pre.is_empty() && is_pre_1_0_test_tag(&tag) {
            continue;
        }
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

pub fn select_atom_release(
    body: &str,
    current_version: &str,
) -> Result<Option<ReleaseInfo>, String> {
    let mut reader = Reader::from_str(body);
    let mut in_entry = false;
    let mut saw_feed = false;
    let mut releases = Vec::new();
    loop {
        match reader.read_event().map_err(|error| error.to_string())? {
            Event::Start(element) if element.name().as_ref() == b"feed" => saw_feed = true,
            Event::Start(element) if element.name().as_ref() == b"entry" => in_entry = true,
            Event::End(element) if element.name().as_ref() == b"entry" => in_entry = false,
            Event::Start(element) | Event::Empty(element)
                if in_entry && element.name().as_ref() == b"link" =>
            {
                let mut alternate = false;
                let mut href = None;
                for attribute in element.attributes().with_checks(false) {
                    let attribute = attribute.map_err(|error| error.to_string())?;
                    match attribute.key.as_ref() {
                        b"rel" => alternate = attribute.value.as_ref() == b"alternate",
                        b"href" => {
                            href = std::str::from_utf8(attribute.value.as_ref())
                                .ok()
                                .map(str::to_owned)
                        }
                        _ => {}
                    }
                }
                if alternate {
                    if let Some(tag) = href
                        .as_deref()
                        .and_then(|value| value.strip_prefix(RELEASE_BASE))
                    {
                        if let Some(version) = tag
                            .strip_prefix('v')
                            .and_then(|value| Version::parse(value).ok())
                        {
                            releases.push(serde_json::json!({"tag_name": tag, "draft": false, "prerelease": !version.pre.is_empty()}));
                        }
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !saw_feed {
        return Err("Invalid GitHub release feed".into());
    }
    select_release(
        &serde_json::to_string(&releases).map_err(|error| error.to_string())?,
        current_version,
    )
}

fn fetch_text(client: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            "Vibe-Coding-Light-update-check",
        )
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let body = response.text().map_err(|error| error.to_string())?;
    if body.len() > 2_000_000 {
        return Err("Release response too large".into());
    }
    Ok(body)
}

pub fn fetch_release(current_version: &str) -> Result<Option<ReleaseInfo>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| error.to_string())?;
    fetch_release_from(&client, current_version, RELEASES_API, RELEASES_ATOM)
}

fn fetch_release_from(
    client: &reqwest::blocking::Client,
    current_version: &str,
    api_url: &str,
    atom_url: &str,
) -> Result<Option<ReleaseInfo>, String> {
    match fetch_text(client, api_url).and_then(|body| select_release(&body, current_version)) {
        Ok(release) => Ok(release),
        Err(primary) => fetch_text(client, atom_url)
            .and_then(|body| select_atom_release(&body, current_version))
            .map_err(|fallback| format!("GitHub API: {primary}; release feed: {fallback}")),
    }
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
        if current.pre.is_empty() && is_pre_1_0_test_tag(&format!("v{version}")) {
            return None;
        }
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
    fn atom_feed_can_supply_release_when_api_is_unavailable() {
        let feed = r#"<?xml version="1.0"?><feed><entry><link rel="alternate" type="text/html" href="https://github.com/TJU-ICLearner/vibe-coding-light/releases/tag/v1.7.0-rc.2"/></entry><entry><link rel="alternate" href="https://github.com/TJU-ICLearner/vibe-coding-light/releases/tag/v1.6.0"/></entry></feed>"#;
        assert_eq!(
            select_atom_release(feed, "1.7.0-rc.1")
                .unwrap()
                .unwrap()
                .version,
            "1.7.0-rc.2"
        );
        assert_eq!(
            select_atom_release(feed, "1.5.0").unwrap().unwrap().version,
            "1.6.0"
        );
        assert!(select_atom_release("<broken", "1.5.0").is_err());
    }

    #[test]
    fn http_failure_uses_atom_endpoint_before_reporting_failure() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let feed = "<feed><entry><link rel=\"alternate\" href=\"https://github.com/TJU-ICLearner/vibe-coding-light/releases/tag/v1.7.0-rc.2\"/></entry></feed>";
            for response in [
                "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    .to_string(),
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    feed.len(),
                    feed
                ),
            ] {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0u8; 2048];
                let _ = stream.read(&mut request);
                stream.write_all(response.as_bytes()).unwrap();
            }
        });
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let result = fetch_release_from(
            &client,
            "1.7.0-rc.1",
            &format!("http://{address}/api"),
            &format!("http://{address}/feed"),
        )
        .unwrap();
        assert_eq!(result.unwrap().version, "1.7.0-rc.2");
        server.join().unwrap();
    }

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
    fn stable_one_does_not_offer_earlier_test_releases_from_api_or_atom() {
        let body = r#"[
          {"tag_name":"v1.8.0-rc.1","draft":false,"prerelease":true},
          {"tag_name":"v1.5.0","draft":false,"prerelease":false},
          {"tag_name":"v1.1.1","draft":false,"prerelease":false}
        ]"#;
        assert!(select_release(body, "1.0.0").unwrap().is_none());
        let feed = r#"<feed><entry><link rel="alternate" href="https://github.com/TJU-ICLearner/vibe-coding-light/releases/tag/v1.5.0"/></entry></feed>"#;
        assert!(select_atom_release(feed, "1.0.0").unwrap().is_none());
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
        assert!(loaded.cached_release("1.0.0").is_none());
    }
}
