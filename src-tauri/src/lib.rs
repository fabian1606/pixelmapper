//! Pixelmapper desktop app (ADR 0003).
//!
//! Registers the native capabilities the frontend's Tauri platform
//! (`app/platform/tauri`) calls. Protocol logic stays in TypeScript; the
//! commands here only move bytes.

mod files;
mod lifecycle;
mod menu;
mod net;
mod udp;

/// Builds and runs the Tauri app.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(udp::UdpSockets::default())
        .manage(lifecycle::QuitGuard::default())
        // Native menu bar; clicks are forwarded to the frontend as `app-menu` events.
        .setup(|app| Ok(menu::setup(app.handle())?))
        // Closing the window lets the frontend flush pending writes first.
        .on_window_event(lifecycle::on_window_event)
        .invoke_handler(tauri::generate_handler![
            udp::udp_bind,
            udp::udp_send,
            udp::udp_close,
            menu::menu_set_recent,
            menu::menu_set_project_open,
            files::save_project_file,
            files::open_project_file,
            net::http_get_bytes,
            net::resource_read,
            lifecycle::app_quit_ready,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the Pixelmapper desktop app")
        // Quitting (⌘Q, menu Quit) also waits for the frontend flush.
        .run(|app, event| lifecycle::on_run_event(app, &event));
}
