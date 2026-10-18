//! Native HTTP and bundled resources (ADR 0004 D19, platform API 1.3).
//!
//! `http_get_bytes` downloads firmware releases without the browser's CORS
//! restrictions (replaces the web app's `/api/firmware-proxy`). It only
//! accepts HTTPS URLs on the GitHub release hosts. `resource_read` returns
//! files bundled under the app's `resources/` directory (e.g. the firmware
//! matching the app release). Bytes travel as raw IPC bodies.

use std::path::{Component, Path, PathBuf};

use tauri::ipc::Response;
use tauri::{AppHandle, Manager};

// ── Constants ────────────────────────────────────────

/// Hosts `http_get_bytes` may start a request on (redirects are followed).
const ALLOWED_HOSTS: &[&str] = &["github.com", "api.github.com", "objects.githubusercontent.com"];

/// Folder inside the bundle's resource dir that holds bundled files.
const RESOURCE_ROOT: &str = "resources";

/// Error text for a missing bundled file (mapped to `null` by the frontend).
const NOT_BUNDLED: &str = "not_bundled";

// ── Helpers ──────────────────────────────────────────

/// True for `https://<allowed host>/…` URLs.
fn is_allowed_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    ALLOWED_HOSTS.contains(&host)
}

/// Accepts only plain relative paths (no `..`, no absolute or prefixed parts).
fn safe_relative(path: &str) -> Option<PathBuf> {
    let p = Path::new(path);
    if path.is_empty() || !p.components().all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(p.to_path_buf())
}

// ── Commands ─────────────────────────────────────────

/// Downloads `url` and returns the body bytes; errors on non-2xx answers.
#[tauri::command]
pub async fn http_get_bytes(url: String) -> Result<Response, String> {
    if !is_allowed_url(&url) {
        return Err(format!("host not allowed: {url}"));
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("Pixelmapper/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    Ok(Response::new(bytes.to_vec()))
}

/// Reads `resources/<path>` from the app bundle; `Err("not_bundled")` if absent.
#[tauri::command]
pub fn resource_read(app: AppHandle, path: String) -> Result<Response, String> {
    let rel = safe_relative(&path).ok_or_else(|| format!("invalid resource path: {path}"))?;
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let file = dir.join(RESOURCE_ROOT).join(rel);
    match std::fs::read(&file) {
        Ok(bytes) => Ok(Response::new(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(NOT_BUNDLED.into()),
        Err(e) => Err(e.to_string()),
    }
}

// ── Tests ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_github_https() {
        assert!(is_allowed_url("https://github.com/fabian1606/pixelmapper/releases/download/v1.0.0/firmware.bin"));
        assert!(is_allowed_url("https://api.github.com/repos/x/y/releases/latest"));
        assert!(!is_allowed_url("http://github.com/x"));
        assert!(!is_allowed_url("https://github.com.evil.com/x"));
        assert!(!is_allowed_url("https://example.com/?github.com"));
    }

    #[test]
    fn rejects_escaping_paths() {
        assert!(safe_relative("firmware/firmware.bin").is_some());
        assert!(safe_relative("../secret").is_none());
        assert!(safe_relative("/etc/passwd").is_none());
        assert!(safe_relative("").is_none());
    }
}
