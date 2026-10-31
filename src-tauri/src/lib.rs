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
mod lifecycle;
mod mcp;
mod menu;
mod midi;
mod net;

/// Builds and runs the Tauri app.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Built-in Art-Net bridge; started on the first `artnet_connect`.
        .manage(artnet::ArtNetBridge::default())
        .manage(lifecycle::QuitGuard::default())
        .manage(midi::MidiConnections::default())
        // Native menu bar (clicks forwarded as `app-menu` events) and the
        // main-thread MIDI client that receives hot-plug notifications.
        .setup(|app| {
            midi::warm_up();
            Ok(menu::setup(app.handle())?)
        })
        // Closing the window lets the frontend flush pending writes first.
        .on_window_event(lifecycle::on_window_event)
        .invoke_handler(tauri::generate_handler![
            artnet::artnet_connect,
            artnet::artnet_send_text,
            artnet::artnet_send_binary,
            artnet::artnet_disconnect,
            midi::midi_list,
            midi::midi_open_input,
            midi::midi_open_output,
            midi::midi_send,
            midi::midi_close,
            menu::menu_set_recent,
            menu::menu_set_project_open,
            files::save_project_file,
            files::open_project_file,
            net::http_get_bytes,
            net::resource_read,
            lifecycle::app_quit_ready,
            mcp::mcp_setup_info,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the Pixelmapper desktop app")
        // Quitting (⌘Q, menu Quit) also waits for the frontend flush.
        .run(|app, event| lifecycle::on_run_event(app, &event));
}
