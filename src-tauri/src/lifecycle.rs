//! Quit guard: closing the window or quitting the app (⌘Q, menu Quit) first
//! lets the frontend flush pending IndexedDB writes (outbox rows, working
//! snapshot). `beforeunload` alone does not guarantee that async writes
//! finish before the webview is torn down.
//!
//! Flow: the close/exit request is prevented and `app-before-quit` is emitted
//! (payload `"close"` or `"exit"`). The frontend flushes (≤ ~3 s) and calls
//! `app_quit_ready`, which closes/exits for real. If the frontend never
//! answers (not loaded, crashed), `FALLBACK_TIMEOUT` forces it; a second
//! close/quit request while one is pending also goes through immediately.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};

// ── Constants ────────────────────────────────────────

/// Event the frontend listens to; payload = `"close"` or `"exit"`.
pub const BEFORE_QUIT_EVENT: &str = "app-before-quit";

/// Label of the main window.
const MAIN_WINDOW: &str = "main";

/// Max wait for the frontend before closing/exiting anyway.
const FALLBACK_TIMEOUT: Duration = Duration::from_secs(5);

// ── State ────────────────────────────────────────────

/// Whether a quit is pending / already approved.
#[derive(Debug, Default)]
pub struct QuitGuard {
    /// A request was intercepted and the frontend is flushing.
    pending: AtomicBool,
    /// The flush finished (or timed out): let close/exit requests through.
    allowed: AtomicBool,
}

/// What the user asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuitMode {
    /// Close the main window.
    Close,
    /// Exit the whole app.
    Exit,
}

impl QuitMode {
    /// Event payload / command argument.
    fn as_str(self) -> &'static str {
        match self {
            QuitMode::Close => "close",
            QuitMode::Exit => "exit",
        }
    }

    /// Parses the command argument (anything unknown = exit).
    fn parse(mode: &str) -> Self {
        if mode == "close" { QuitMode::Close } else { QuitMode::Exit }
    }
}

/// Decision for an incoming close/exit request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Decision {
    /// Let it through.
    Allow,
    /// Prevent it and ask the frontend to flush.
    Intercept,
    /// Second request while flushing: approve and perform it now.
    Force,
}

impl QuitGuard {
    /// Decides what to do with a close/exit request.
    fn decide(&self) -> Decision {
        if self.allowed.load(Ordering::SeqCst) {
            return Decision::Allow;
        }
        if self.pending.swap(true, Ordering::SeqCst) {
            Decision::Force
        } else {
            Decision::Intercept
        }
    }

    /// Approves all following close/exit requests.
    fn approve(&self) {
        self.allowed.store(true, Ordering::SeqCst);
    }
}

// ── Performing ───────────────────────────────────────

/// Approves and performs the close/exit (bypassing the interception).
fn perform(app: &AppHandle, mode: QuitMode) {
    app.state::<QuitGuard>().approve();
    match mode {
        QuitMode::Exit => app.exit(0),
        QuitMode::Close => match app.get_webview_window(MAIN_WINDOW) {
            // `destroy` skips CloseRequested; the last window closing then
            // raises ExitRequested, which is allowed now.
            Some(w) => {
                if let Err(e) = w.destroy() {
                    eprintln!("[quit] destroying the window failed: {e}");
                    app.exit(0);
                }
            }
            None => app.exit(0),
        },
    }
}

/// Handles an intercepted request: asks the frontend, arms the fallback.
fn intercept(app: &AppHandle, mode: QuitMode) {
    if let Err(e) = app.emit(BEFORE_QUIT_EVENT, mode.as_str()) {
        eprintln!("[quit] emitting {BEFORE_QUIT_EVENT} failed: {e}");
        perform(app, mode);
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(FALLBACK_TIMEOUT);
        if !handle.state::<QuitGuard>().allowed.load(Ordering::SeqCst) {
            eprintln!("[quit] frontend did not answer in time — quitting anyway");
            perform(&handle, mode);
        }
    });
}

// ── Hooks ────────────────────────────────────────────

/// Window hook: intercepts closing the main window.
pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else { return };
    if window.label() != MAIN_WINDOW {
        return;
    }
    let app = window.app_handle();
    match app.state::<QuitGuard>().decide() {
        Decision::Allow => {}
        Decision::Intercept => {
            api.prevent_close();
            intercept(app, QuitMode::Close);
        }
        Decision::Force => {
            api.prevent_close();
            perform(app, QuitMode::Close);
        }
    }
}

/// Run-loop hook: intercepts app exit requests (⌘Q, menu Quit).
pub fn on_run_event(app: &AppHandle, event: &RunEvent) {
    let RunEvent::ExitRequested { api, .. } = event else { return };
    match app.state::<QuitGuard>().decide() {
        Decision::Allow => {}
        Decision::Intercept => {
            api.prevent_exit();
            intercept(app, QuitMode::Exit);
        }
        Decision::Force => {
            api.prevent_exit();
            perform(app, QuitMode::Exit);
        }
    }
}

// ── Commands ─────────────────────────────────────────

/// Called by the frontend once its flush finished (or timed out).
#[tauri::command]
pub fn app_quit_ready(app: AppHandle, mode: String) {
    perform(&app, QuitMode::parse(&mode));
}

// ── Tests ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intercepts_once_then_forces_then_allows() {
        let guard = QuitGuard::default();
        assert_eq!(guard.decide(), Decision::Intercept);
        assert_eq!(guard.decide(), Decision::Force);
        guard.approve();
        assert_eq!(guard.decide(), Decision::Allow);
    }

    #[test]
    fn parses_modes() {
        assert_eq!(QuitMode::parse("close"), QuitMode::Close);
        assert_eq!(QuitMode::parse("exit"), QuitMode::Exit);
        assert_eq!(QuitMode::parse(QuitMode::Close.as_str()), QuitMode::Close);
    }
}
