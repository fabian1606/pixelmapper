//! Native open/save dialogs for `.pmproject` files (File → Open / Export).
//!
//! The frontend builds and reads the archive bytes; these commands only pick
//! a path and move the bytes. Bytes travel as raw IPC bodies both ways.

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

// ── Helpers ──────────────────────────────────────────

/// Label and extension of the project file filter.
const FILTER_NAME: &str = "Pixelmapper Project";
const EXTENSIONS: &[&str] = &["pmproject"];

/// Decodes a `encodeURIComponent` string (header values must be ASCII).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            // Parse on bytes: slicing the str could split a multi-byte char.
            let hex = |b: u8| (b as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ── Commands ─────────────────────────────────────────

/// Asks for a target path and writes the raw request body there.
/// Header `x-file-name`: suggested name (URI-encoded). Returns `false` if cancelled.
#[tauri::command]
pub async fn save_project_file(app: AppHandle, request: Request<'_>) -> Result<bool, String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected a raw byte body".into());
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_else(|| "project.pmproject".into());
    let picked = app
        .dialog()
        .file()
        .set_file_name(name)
        .add_filter(FILTER_NAME, EXTENSIONS)
        .blocking_save_file();
    let Some(path) = picked else { return Ok(false) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Asks for a project file and returns its bytes (empty if cancelled).
#[tauri::command]
pub async fn open_project_file(app: AppHandle) -> Result<Response, String> {
    let picked = app.dialog().file().add_filter(FILTER_NAME, EXTENSIONS).blocking_pick_file();
    let Some(path) = picked else { return Ok(Response::new(Vec::new())) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

// ── Tests ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_uri_components() {
        assert_eq!(percent_decode("B%C3%BChne%20A.pmproject"), "Bühne A.pmproject");
        assert_eq!(percent_decode("plain"), "plain");
        assert_eq!(percent_decode("bad%zz%"), "bad%zz%");
    }
}
