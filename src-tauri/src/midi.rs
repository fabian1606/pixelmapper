//! Native MIDI for the platform `MidiApi` (ADR 0003, step 3).
//!
//! WKWebView has no Web MIDI, so the desktop app talks to the system MIDI
//! stack (CoreMIDI on macOS) through `midir`. Ports are listed by their
//! stable `midir` id; open connections live in app state and are addressed
//! by a numeric handle. Incoming messages are pushed to the frontend over a
//! Tauri channel; outgoing messages arrive as raw IPC bodies. Hot-plug is
//! detected by the frontend polling `midi_list`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use midir::{Ignore, MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeBody, Request};
use tauri::State;

/// Client name shown by the OS for Pixelmapper's MIDI connections.
const CLIENT_NAME: &str = "Pixelmapper";

// ── Types ────────────────────────────────────────────

/// One MIDI port as seen by the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct MidiPortInfo {
    pub id: String,
    pub name: String,
}

/// All currently present ports.
#[derive(Debug, Clone, Serialize)]
pub struct MidiPortList {
    pub inputs: Vec<MidiPortInfo>,
    pub outputs: Vec<MidiPortInfo>,
}

// ── State ────────────────────────────────────────────

/// Open input and output connections by handle.
#[derive(Default)]
pub struct MidiConnections {
    next_id: AtomicU32,
    inputs: Mutex<HashMap<u32, MidiInputConnection<()>>>,
    outputs: Mutex<HashMap<u32, MidiOutputConnection>>,
}

impl MidiConnections {
    /// Allocates the next connection handle.
    fn next_handle(&self) -> u32 {
        self.next_id.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// Lists all input and output ports present right now.
    pub fn list(&self) -> Result<MidiPortList, String> {
        let midi_in = MidiInput::new(CLIENT_NAME).map_err(|e| e.to_string())?;
        let midi_out = MidiOutput::new(CLIENT_NAME).map_err(|e| e.to_string())?;
        let inputs = midi_in
            .ports()
            .iter()
            .map(|p| MidiPortInfo { id: p.id(), name: midi_in.port_name(p).unwrap_or_default() })
            .collect();
        let outputs = midi_out
            .ports()
            .iter()
            .map(|p| MidiPortInfo { id: p.id(), name: midi_out.port_name(p).unwrap_or_default() })
            .collect();
        Ok(MidiPortList { inputs, outputs })
    }

    /// Opens an input port; every message (sysex included) is passed to `on_message`.
    pub fn open_input<F>(&self, port_id: &str, on_message: F) -> Result<u32, String>
    where
        F: FnMut(&[u8]) + Send + 'static,
    {
        let mut midi_in = MidiInput::new(CLIENT_NAME).map_err(|e| e.to_string())?;
        midi_in.ignore(Ignore::None);
        let port = midi_in
            .find_port_by_id(port_id.to_string())
            .ok_or_else(|| format!("unknown MIDI input {port_id}"))?;
        let mut on_message = on_message;
        let conn = midi_in
            .connect(&port, CLIENT_NAME, move |_stamp, data, _| on_message(data), ())
            .map_err(|e| e.to_string())?;
        let handle = self.next_handle();
        self.inputs.lock().map_err(|e| e.to_string())?.insert(handle, conn);
        Ok(handle)
    }

    /// Opens an output port.
    pub fn open_output(&self, port_id: &str) -> Result<u32, String> {
        let midi_out = MidiOutput::new(CLIENT_NAME).map_err(|e| e.to_string())?;
        let port = midi_out
            .find_port_by_id(port_id.to_string())
            .ok_or_else(|| format!("unknown MIDI output {port_id}"))?;
        let conn = midi_out.connect(&port, CLIENT_NAME).map_err(|e| e.to_string())?;
        let handle = self.next_handle();
        self.outputs.lock().map_err(|e| e.to_string())?.insert(handle, conn);
        Ok(handle)
    }

    /// Sends one message on an open output.
    pub fn send(&self, handle: u32, data: &[u8]) -> Result<(), String> {
        let mut outputs = self.outputs.lock().map_err(|e| e.to_string())?;
        let conn = outputs.get_mut(&handle).ok_or_else(|| format!("unknown MIDI output handle {handle}"))?;
        conn.send(data).map_err(|e| e.to_string())
    }

    /// Closes an input or output connection. Unknown handles are ignored (idempotent).
    pub fn close(&self, handle: u32) -> Result<(), String> {
        let input = self.inputs.lock().map_err(|e| e.to_string())?.remove(&handle);
        if let Some(conn) = input {
            conn.close();
        }
        let output = self.outputs.lock().map_err(|e| e.to_string())?.remove(&handle);
        if let Some(conn) = output {
            conn.close();
        }
        Ok(())
    }
}

/// Creates a first MIDI client on the main thread (call from `setup`).
///
/// CoreMIDI delivers its device notifications on the run loop of the thread
/// that created the first client; without this, port lists queried from
/// worker threads may not refresh after hot-plugging. The client is kept
/// alive for the app's lifetime on purpose.
pub fn warm_up() {
    match MidiInput::new(CLIENT_NAME) {
        Ok(client) => std::mem::forget(client),
        Err(e) => eprintln!("[midi] could not create a MIDI client: {e}"),
    }
}

// ── Commands ─────────────────────────────────────────

/// Lists all MIDI input and output ports.
#[tauri::command]
pub async fn midi_list(state: State<'_, MidiConnections>) -> Result<MidiPortList, String> {
    state.list()
}

/// Opens an input port and streams its messages to `on_message`; returns the handle.
#[tauri::command]
pub async fn midi_open_input(
    state: State<'_, MidiConnections>,
    id: String,
    on_message: Channel<Vec<u8>>,
) -> Result<u32, String> {
    state.open_input(&id, move |data| {
        if let Err(e) = on_message.send(data.to_vec()) {
            eprintln!("[midi] forwarding input failed: {e}");
        }
    })
}

/// Opens an output port; returns the handle.
#[tauri::command]
pub async fn midi_open_output(state: State<'_, MidiConnections>, id: String) -> Result<u32, String> {
    state.open_output(&id)
}

/// Sends the raw request body as one MIDI message. Header: `x-handle`.
#[tauri::command]
pub async fn midi_send(state: State<'_, MidiConnections>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected a raw byte body".into());
    };
    let handle: u32 = request
        .headers()
        .get("x-handle")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or("missing or invalid x-handle")?;
    state.send(handle, data)
}

/// Closes an input or output connection.
#[tauri::command]
pub async fn midi_close(state: State<'_, MidiConnections>, handle: u32) -> Result<(), String> {
    state.close(handle)
}

// ── Tests ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_ports_and_handles_fail_cleanly() {
        let midi = MidiConnections::default();
        assert!(midi.open_input("no-such-port", |_| {}).is_err());
        assert!(midi.open_output("no-such-port").is_err());
        assert!(midi.send(42, &[0x90, 0, 0]).is_err());
        midi.close(42).unwrap();
    }

    #[test]
    fn lists_ports_without_error() {
        // Port presence depends on the machine; listing itself must work.
        assert!(MidiConnections::default().list().is_ok());
    }
}
