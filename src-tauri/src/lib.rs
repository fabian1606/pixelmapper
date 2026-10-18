//! Pixelmapper desktop app (ADR 0003).
//!
//! Registers the native capabilities the frontend's Tauri platform
//! (`app/platform/tauri`) calls. Protocol logic stays in TypeScript; the
//! commands here only move bytes.

mod files;
mod menu;
mod net;
mod udp;

/// Builds and runs the Tauri app.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(udp::UdpSockets::default())
        // Native menu bar; clicks are forwarded to the frontend as `app-menu` events.
        .setup(|app| Ok(menu::setup(app.handle())?))
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Pixelmapper desktop app");
}
