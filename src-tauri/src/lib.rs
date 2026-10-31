//! Pixelmapper desktop app (ADR 0003).
//!
//! Registers the native capabilities the frontend's Tauri platform
//! (`app/platform/tauri`) calls. Protocol logic stays in TypeScript; the
//! commands here only move bytes.

mod files;
mod lifecycle;
mod menu;
mod midi;
mod net;
mod udp;

/// Builds and runs the Tauri app.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(udp::UdpSockets::default())
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
            udp::udp_bind,
            udp::udp_send,
            udp::udp_close,
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
        ])
        .build(tauri::generate_context!())
        .expect("error while building the Pixelmapper desktop app")
        // Quitting (⌘Q, menu Quit) also waits for the frontend flush.
        .run(|app, event| lifecycle::on_run_event(app, &event));
}
