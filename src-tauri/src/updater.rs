//! In-app update notifier: reads the latest GitHub release, compares versions,
//! and (Phase 2) installs the new bundle. Network I/O shells out to `curl`,
//! mirroring `install.sh`, so the webview needs no GitHub CSP allowlist.

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};

/// A semantic version `major.minor.patch` with an optional prerelease tag.
#[derive(Debug, PartialEq, Eq)]
struct SemVer {
    major: u64,
    minor: u64,
    patch: u64,
    prerelease: Option<String>,
}

/// Parse `MAJOR.MINOR.PATCH[-prerelease]`, tolerating a leading `v`.
fn parse_version(raw: &str) -> Option<SemVer> {
    let trimmed = raw.trim().trim_start_matches('v');
    let (core, prerelease) = match trimmed.split_once('-') {
        Some((c, p)) => (c, Some(p.to_string())),
        None => (trimmed, None),
    };
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some(SemVer {
        major,
        minor,
        patch,
        prerelease,
    })
}

fn version_ordering(a: &SemVer, b: &SemVer) -> Ordering {
    (a.major, a.minor, a.patch)
        .cmp(&(b.major, b.minor, b.patch))
        .then_with(|| match (&a.prerelease, &b.prerelease) {
            (None, None) => Ordering::Equal,
            (None, Some(_)) => Ordering::Greater, // a release outranks a prerelease
            (Some(_), None) => Ordering::Less,
            (Some(x), Some(y)) => x.cmp(y),
        })
}

/// True iff `latest` is strictly newer than `current`. Unparseable input is
/// treated as "no update" so a malformed tag never nags the user.
fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(l), Some(c)) => version_ordering(&l, &c) == Ordering::Greater,
        _ => false,
    }
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

/// The update status surfaced to the frontend. camelCase to match the TS
/// `UpdateInfo` interface.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub dmg_url: Option<String>,
    pub release_url: String,
    pub notes: String,
}

fn universal_dmg_url(release: &GithubRelease) -> Option<String> {
    release
        .assets
        .iter()
        .find(|asset| asset.name.ends_with("_universal.dmg"))
        .map(|asset| asset.browser_download_url.clone())
}

/// Pure: turn the GitHub release JSON + the running version into `UpdateInfo`.
fn build_update_info(current_version: &str, release_json: &str) -> Result<UpdateInfo, String> {
    let release: GithubRelease =
        serde_json::from_str(release_json).map_err(|e| format!("Failed to parse release JSON: {e}"))?;
    let latest = release.tag_name.trim_start_matches('v').to_string();
    Ok(UpdateInfo {
        available: is_newer(&latest, current_version),
        current_version: current_version.to_string(),
        latest_version: latest,
        dmg_url: universal_dmg_url(&release),
        release_url: release.html_url,
        notes: release.body,
    })
}

const RELEASES_LATEST_API: &str =
    "https://api.github.com/repos/channprj/markdowner/releases/latest";

/// Fetch the latest-release JSON via `curl` (guaranteed present on macOS and
/// already an `install.sh` dependency).
fn fetch_latest_release_json() -> Result<String, String> {
    let output = std::process::Command::new("curl")
        .args([
            "-fsSL",
            "-H",
            "Accept: application/vnd.github+json",
            "-H",
            "User-Agent: markdowner",
            RELEASES_LATEST_API,
        ])
        .output()
        .map_err(|e| format!("Failed to run curl: {e}"))?;
    if !output.status.success() {
        return Err(format!("curl exited with status {}", output.status));
    }
    String::from_utf8(output.stdout).map_err(|e| format!("Invalid UTF-8 from curl: {e}"))
}

#[tauri::command]
pub fn check_for_update(app_handle: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let current = app_handle.package_info().version.to_string();
    let json = fetch_latest_release_json()?;
    build_update_info(&current, &json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_patch_minor_and_major_are_detected() {
        assert!(is_newer("0.260528.3", "0.260528.2"));
        assert!(is_newer("0.260601.0", "0.260528.2"));
        assert!(is_newer("1.0.0", "0.260528.2"));
    }

    #[test]
    fn equal_or_older_is_not_newer() {
        assert!(!is_newer("0.260528.2", "0.260528.2"));
        assert!(!is_newer("0.260528.1", "0.260528.2"));
    }

    #[test]
    fn leading_v_is_tolerated() {
        assert!(is_newer("v0.260601.0", "0.260528.2"));
    }

    #[test]
    fn release_outranks_prerelease() {
        assert!(is_newer("0.260601.0", "0.260601.0-beta.1"));
        assert!(!is_newer("0.260601.0-beta.1", "0.260601.0"));
    }

    #[test]
    fn unparseable_versions_are_not_newer() {
        assert!(!is_newer("not-a-version", "0.260528.2"));
        assert!(!is_newer("0.260601.0", "garbage"));
    }

    const SAMPLE_RELEASE: &str = r#"{
        "tag_name": "v0.260601.0",
        "html_url": "https://github.com/channprj/markdowner/releases/tag/v0.260601.0",
        "body": "Release notes here",
        "assets": [
            {"name": "Markdowner_0.260601.0_universal.dmg",
             "browser_download_url": "https://example.com/Markdowner_0.260601.0_universal.dmg"},
            {"name": "other.txt",
             "browser_download_url": "https://example.com/other.txt"}
        ]
    }"#;

    #[test]
    fn build_update_info_flags_available_and_picks_universal_dmg() {
        let info = build_update_info("0.260528.2", SAMPLE_RELEASE).unwrap();
        assert!(info.available);
        assert_eq!(info.latest_version, "0.260601.0");
        assert_eq!(info.current_version, "0.260528.2");
        assert_eq!(
            info.dmg_url.as_deref(),
            Some("https://example.com/Markdowner_0.260601.0_universal.dmg")
        );
        assert_eq!(
            info.release_url,
            "https://github.com/channprj/markdowner/releases/tag/v0.260601.0"
        );
        assert_eq!(info.notes, "Release notes here");
    }

    #[test]
    fn build_update_info_reports_no_update_for_same_version() {
        let info = build_update_info("0.260601.0", SAMPLE_RELEASE).unwrap();
        assert!(!info.available);
    }

    #[test]
    fn build_update_info_handles_missing_dmg() {
        let json = r#"{"tag_name":"v0.260601.0","html_url":"u","body":"","assets":[]}"#;
        let info = build_update_info("0.260528.2", json).unwrap();
        assert!(info.available);
        assert_eq!(info.dmg_url, None);
    }
}
