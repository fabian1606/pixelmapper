//! Native UDP for the platform `UdpApi` (ADR 0003, step 2).
//!
//! Sockets live in app state and are addressed by a numeric id. Datagrams
//! arrive as raw IPC bodies (no JSON encoding of the payload); the target is
//! passed in headers. Used by the Art-Net connector (ArtDMX at frame rate).

use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use tauri::ipc::{InvokeBody, Request};
use tauri::State;

// ── State ────────────────────────────────────────────

/// Open sockets by id.
#[derive(Default)]
pub struct UdpSockets {
    next_id: AtomicU32,
    sockets: Mutex<HashMap<u32, Arc<UdpSocket>>>,
}

impl UdpSockets {
    /// Binds a socket on `0.0.0.0:port` (0 = any free port) and returns its id.
    pub fn bind(&self, port: u16, broadcast: bool) -> Result<u32, String> {
        let socket = UdpSocket::bind(("0.0.0.0", port)).map_err(|e| e.to_string())?;
        if broadcast {
            socket.set_broadcast(true).map_err(|e| e.to_string())?;
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.sockets.lock().map_err(|e| e.to_string())?.insert(id, Arc::new(socket));
        Ok(id)
    }

    /// Sends one datagram. The socket is cloned out so the lock is not held while sending.
    pub fn send(&self, id: u32, data: &[u8], host: &str, port: u16) -> Result<(), String> {
        let socket = self
            .sockets
            .lock()
            .map_err(|e| e.to_string())?
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("unknown socket {id}"))?;
        socket.send_to(data, (host, port)).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Closes a socket. Unknown ids are ignored (idempotent).
    pub fn close(&self, id: u32) -> Result<(), String> {
        self.sockets.lock().map_err(|e| e.to_string())?.remove(&id);
        Ok(())
    }
}

// ── Helpers ──────────────────────────────────────────

/// Reads a required string header of an IPC request.
fn header<'a>(request: &'a Request<'_>, name: &str) -> Result<&'a str, String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("missing header {name}"))
}

// ── Commands ─────────────────────────────────────────

/// Binds a socket and returns its id.
#[tauri::command]
pub async fn udp_bind(state: State<'_, UdpSockets>, port: Option<u16>, broadcast: Option<bool>) -> Result<u32, String> {
    state.bind(port.unwrap_or(0), broadcast.unwrap_or(false))
}

/// Sends the raw request body as one datagram.
/// Headers: `x-socket` (id), `x-host`, `x-port`.
#[tauri::command]
pub async fn udp_send(state: State<'_, UdpSockets>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected a raw byte body".into());
    };
    let id: u32 = header(&request, "x-socket")?.parse().map_err(|_| "invalid x-socket")?;
    let host = header(&request, "x-host")?;
    let port: u16 = header(&request, "x-port")?.parse().map_err(|_| "invalid x-port")?;
    state.send(id, data, host, port)
}

/// Closes a socket.
#[tauri::command]
pub async fn udp_close(state: State<'_, UdpSockets>, id: u32) -> Result<(), String> {
    state.close(id)
}

// ── Tests ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn sends_datagrams_over_loopback() {
        let receiver = UdpSocket::bind("127.0.0.1:0").unwrap();
        receiver.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let target = receiver.local_addr().unwrap();

        let sockets = UdpSockets::default();
        let id = sockets.bind(0, true).unwrap();
        sockets.send(id, &[1, 2, 3], "127.0.0.1", target.port()).unwrap();

        let mut buf = [0u8; 16];
        let (len, _) = receiver.recv_from(&mut buf).unwrap();
        assert_eq!(&buf[..len], &[1, 2, 3]);
    }

    #[test]
    fn unknown_and_closed_sockets_fail_cleanly() {
        let sockets = UdpSockets::default();
        assert!(sockets.send(42, &[0], "127.0.0.1", 9).is_err());
        let id = sockets.bind(0, false).unwrap();
        sockets.close(id).unwrap();
        sockets.close(id).unwrap();
        assert!(sockets.send(id, &[0], "127.0.0.1", 9).is_err());
    }
}
