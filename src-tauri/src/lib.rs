//! Pixelmapper desktop app (ADR 0003).
//!
//! Registers the native capabilities the frontend's Tauri platform
//! (`app/platform/tauri`) calls. Most commands only move bytes and leave
//! protocol logic to TypeScript; the exception is the built-in Art-Net
//! bridge (`artnet`), which embeds the Rust bridge core of `pmnet-bridge`
//! (the same code as `pmnet-bridge serve` for the browser) and only moves its
//! contract messages between that core and the webview.

mod artnet;
mod files;
mod menu;
mod udp;

/// Builds and runs the Tauri app.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(udp::UdpSockets::default())
        // Built-in Art-Net bridge; started on the first `artnet_connect`.
        .manage(artnet::ArtNetBridge::default())
        // Native menu bar; clicks are forwarded to the frontend as `app-menu` events.
        .setup(|app| Ok(menu::setup(app.handle())?))
        .invoke_handler(tauri::generate_handler![
            udp::udp_bind,
            udp::udp_send,
            udp::udp_close,
            artnet::artnet_connect,
            artnet::artnet_send_text,
            artnet::artnet_send_binary,
            artnet::artnet_disconnect,
            menu::menu_set_recent,
            menu::menu_set_project_open,
            files::save_project_file,
            files::open_project_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Pixelmapper desktop app");
}
