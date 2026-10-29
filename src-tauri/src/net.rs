//! Native HTTP and bundled resources (ADR 0004 D19, platform API 1.3).
//!
//! `http_get_bytes` downloads firmware releases without the browser's CORS
//! restrictions (replaces the web app's `/api/firmware-proxy`). It only
//! accepts HTTPS URLs on the GitHub release hosts. `resource_read` returns
//! files bundled under the app's `resources/` directory (e.g. the firmware
//! matching the app release). Bytes travel as raw IPC bodies.

use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use tauri::ipc::Response;
use tauri::{AppHandle, Manager};

// ── Constants ────────────────────────────────────────

/// Hosts `http_get_bytes` may start a request on (redirects are followed).
const ALLOWED_HOSTS: &[&str] = &["github.com", "api.github.com", "objects.githubusercontent.com"];

/// Folder inside the bundle's resource dir that holds bundled files.
const RESOURCE_ROOT: &str = "resources";

/// Error text for a missing bundled file (mapped to `null` by the frontend).
const NOT_BUNDLED: &str = "not_bundled";

/// Max time to establish the TCP/TLS connection. A stalled network (captive
/// portal, lighting LAN without gateway) must fail fast so the frontend can
/// fall back to the bundled firmware instead of hanging forever.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Max time for the whole request incl. body (firmware is a few MB).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

// ── Helpers ──────────────────────────────────────────

/// Maps a reqwest error to a message; timeouts start with `timeout:` so they
/// are recognisable in logs (the frontend falls back on any rejection).
fn describe_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        format!("timeout: {e}")
    } else {
        e.to_string()
    }
}

/// HTTP client with connect + total timeouts (never waits forever).
fn build_client(connect: Duration, total: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("Pixelmapper/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(connect)
        .timeout(total)
        .build()
        .map_err(describe_error)
}

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

/// Downloads `url` and returns the body bytes; errors on non-2xx answers
/// and after `CONNECT_TIMEOUT` / `REQUEST_TIMEOUT`.
#[tauri::command]
pub async fn http_get_bytes(url: String) -> Result<Response, String> {
    if !is_allowed_url(&url) {
        return Err(format!("host not allowed: {url}"));
    }
    let client = build_client(CONNECT_TIMEOUT, REQUEST_TIMEOUT)?;
    let res = client.get(&url).send().await.map_err(describe_error)?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    let bytes = res.bytes().await.map_err(describe_error)?;
    Ok(Response::new(bytes.to_vec()))
}

/// Reads `resources/<path>` from the app bundle; `Err("not_bundled")` if absent.
/// Async + `spawn_blocking`: reading the firmware must not block the main
/// (UI) thread, which sync commands run on.
#[tauri::command]
pub async fn resource_read(app: AppHandle, path: String) -> Result<Response, String> {
    let rel = safe_relative(&path).ok_or_else(|| format!("invalid resource path: {path}"))?;
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let file = dir.join(RESOURCE_ROOT).join(rel);
    let read = tauri::async_runtime::spawn_blocking(move || std::fs::read(&file))
        .await
        .map_err(|e| e.to_string())?;
    match read {
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

    #[test]
    fn stalled_server_times_out() {
        // A server that accepts but never answers (captive portal / dead LAN).
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let _hold = std::thread::spawn(move || {
            let conn = listener.accept();
            std::thread::sleep(Duration::from_secs(5));
            drop(conn);
        });
        let err = tauri::async_runtime::block_on(async move {
            // Built inside the runtime: reqwest's timers need a Tokio reactor.
            let client = build_client(Duration::from_millis(500), Duration::from_millis(300)).unwrap();
            client.get(format!("http://{addr}/")).send().await
        })
        .expect_err("stalled request must fail");
        assert!(describe_error(err).starts_with("timeout:"));
    }
}
