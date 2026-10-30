//! MCP setup info for the desktop app (Settings → MCP Server).
//!
//! The desktop app runs on the same machine as `pixelmapper-mcp`, so it can
//! read the pairing token the CLI wrote and point at the CLI of the checkout
//! it was built from. The browser build has no such access and asks the user
//! to paste the token instead.

use serde::Serialize;
use std::path::PathBuf;

// ── Types ────────────────────────────────────────────────

/// What the settings panel needs to pair and to print setup snippets.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSetupInfo {
    /// Path of the pairing token file (`~/.pixelmapper/mcp-token` by default).
    pub token_file: Option<String>,
    /// Token from that file, if `pixelmapper-mcp` has created it yet.
    pub token: Option<String>,
    /// Absolute path of `packages/mcp-bridge/src/cli.ts` of the checkout this
    /// app was built from, if it still exists.
    pub cli_path: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────

/// Token file path: `PIXELMAPPER_MCP_TOKEN_FILE`, else `~/.pixelmapper/mcp-token`
/// (same rule as `packages/mcp-bridge/src/config.ts`).
fn token_file() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("PIXELMAPPER_MCP_TOKEN_FILE") {
        if !path.is_empty() {
            return Some(PathBuf::from(path));
        }
    }
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok()?;
    Some(PathBuf::from(home).join(".pixelmapper").join("mcp-token"))
}

/// Reads and trims the token; `None` when missing or empty.
fn read_token(path: &PathBuf) -> Option<String> {
    let token = std::fs::read_to_string(path).ok()?.trim().to_string();
    if token.is_empty() { None } else { Some(token) }
}

/// CLI of the checkout this binary was built from (`src-tauri/..`).
fn cli_path() -> Option<String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let cli = manifest_dir.parent()?.join("packages").join("mcp-bridge").join("src").join("cli.ts");
    if cli.is_file() { Some(cli.to_string_lossy().into_owned()) } else { None }
}

// ── Commands ─────────────────────────────────────────────

/// Returns token file, token and CLI path for Settings → MCP Server.
#[tauri::command]
pub fn mcp_setup_info() -> McpSetupInfo {
    let file = token_file();
    McpSetupInfo {
        token: file.as_ref().and_then(read_token),
        token_file: file.map(|p| p.to_string_lossy().into_owned()),
        cli_path: cli_path(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_path_points_at_the_bridge_cli_of_this_checkout() {
        let path = cli_path().expect("checkout has packages/mcp-bridge/src/cli.ts");
        assert!(path.ends_with("cli.ts"));
    }

    #[test]
    fn read_token_trims_and_rejects_empty_files() {
        let dir = std::env::temp_dir().join(format!("pm-mcp-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("mcp-token");
        std::fs::write(&file, "abc123\n").unwrap();
        assert_eq!(read_token(&file).as_deref(), Some("abc123"));
        std::fs::write(&file, "  \n").unwrap();
        assert_eq!(read_token(&file), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
