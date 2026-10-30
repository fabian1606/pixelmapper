//! Built-in Art-Net 4 / RDM bridge (ADR 0003, plan D3): the same Rust bridge core as `pmnet-bridge serve`
//! (`pmnet_bridge::bridge` from the pixelmapper-hardware repo), embedded in the app instead of a separate process
//! and a WebSocket.
//!
//! One [`Bridge`] on the real `PixelmapperNetBackend` is created on the first `artnet_connect` (same defaults as
//! `serve`: UDP 6454 on all interfaces; a socket that cannot be bound is not fatal — the frontend sees
//! `udp.bound = false` in `hello` and the backend keeps retrying). Every `artnet_connect` opens one bridge
//! session. The messages are exactly those of the WebSocket contract (`protocol/bridge-ws.md`, §1 “Other
//! transports”): bridge → app over a Tauri `Channel` as [`ArtNetSessionEvent`]s, app → bridge through
//! `artnet_send_text` and `artnet_send_binary` (raw IPC body, no JSON encoding of DMX). The frontend side is
//! `app/platform/tauri/artnet-bridge.ts`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use pmnet_bridge::backend::pixelmapper_net::{BackendConfig, PixelmapperNetBackend};
use pmnet_bridge::backend::NetBackend;
use pmnet_bridge::bridge::{Bridge, BridgeConfig, ClientInfo, ClientSession, Outgoing};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeBody, Request};
use tauri::State;
use tokio::sync::OnceCell;

/// Close code reported when a session ended without a close code of the bridge (like a dropped WebSocket).
const CLOSE_ABNORMAL: u16 = 1006;

// ── Events ───────────────────────────────────────────

/// What the bridge sends to one session, in order. Nothing follows a `Close`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ArtNetSessionEvent {
    /// One JSON message of the contract (event, `result`, `error`).
    Message {
        /// The JSON text.
        text: String,
    },
    /// The bridge ended the session (4001, 4002, 4003, 1001; 1006 without a code).
    Close {
        /// Close code.
        code: u16,
        /// Human-readable reason.
        reason: String,
    },
}

// ── Sessions ─────────────────────────────────────────

/// Open bridge sessions of one bridge, addressed by a numeric id. Generic over the backend for tests.
pub struct Sessions<B: NetBackend> {
    next_id: AtomicU32,
    open: Mutex<HashMap<u32, Arc<ClientSession>>>,
    _backend: std::marker::PhantomData<fn() -> B>,
}

impl<B: NetBackend> Default for Sessions<B> {
    fn default() -> Self {
        Self {
            next_id: AtomicU32::new(0),
            open: Mutex::new(HashMap::new()),
            _backend: std::marker::PhantomData,
        }
    }
}

impl<B: NetBackend> Sessions<B> {
    /// Opens a session on `bridge` and forwards its messages to `emit` from a task until it ends; returns its id.
    /// Must be called inside a Tokio runtime.
    pub fn connect(
        self: &Arc<Self>,
        bridge: &Bridge<B>,
        emit: impl Fn(ArtNetSessionEvent) + Send + 'static,
    ) -> Result<u32, String> {
        let (session, mut outgoing) = bridge.connect(ClientInfo::new("tauri"));
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.lock()?.insert(id, Arc::new(session));
        let sessions = Arc::clone(self);
        tokio::spawn(async move {
            let mut closed = false;
            while let Some(msg) = outgoing.recv().await {
                match msg {
                    Outgoing::Text(text) => emit(ArtNetSessionEvent::Message { text }),
                    Outgoing::Close { code, reason } => {
                        emit(ArtNetSessionEvent::Close { code, reason });
                        closed = true;
                    }
                }
            }
            // Still registered = the frontend did not disconnect: tell it the session is gone.
            let removed = sessions.lock().map(|mut open| open.remove(&id)).ok().flatten();
            if removed.is_some() && !closed {
                emit(ArtNetSessionEvent::Close { code: CLOSE_ABNORMAL, reason: String::new() });
            }
        });
        Ok(id)
    }

    /// Hands one JSON message to the session (in order with every earlier message).
    pub async fn send_text(&self, id: u32, text: &str) -> Result<(), String> {
        let session = self.get(id)?;
        session.handle_text(text).await.map_err(|e| e.to_string())
    }

    /// Hands one binary DMX frame set to the session.
    pub async fn send_binary(&self, id: u32, data: Vec<u8>) -> Result<(), String> {
        let session = self.get(id)?;
        session.handle_binary(data).await.map_err(|e| e.to_string())
    }

    /// Ends a session (the frontend went away). Unknown ids are ignored (idempotent).
    pub fn disconnect(&self, id: u32) -> Result<(), String> {
        if let Some(session) = self.lock()?.remove(&id) {
            session.close();
        }
        Ok(())
    }

    /// The session with `id`, cloned out so the lock is not held while awaiting it.
    fn get(&self, id: u32) -> Result<Arc<ClientSession>, String> {
        self.lock()?
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("unknown Art-Net bridge session {id}"))
    }

    /// The session table.
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<u32, Arc<ClientSession>>>, String> {
        self.open.lock().map_err(|e| e.to_string())
    }
}

// ── State ────────────────────────────────────────────

/// App state: the bridge (created on first use) and its sessions.
#[derive(Default)]
pub struct ArtNetBridge {
    bridge: OnceCell<Bridge<PixelmapperNetBackend>>,
    sessions: Arc<Sessions<PixelmapperNetBackend>>,
}

impl ArtNetBridge {
    /// The bridge, started on first call. Must be called inside the Tokio runtime (async commands are).
    async fn bridge(&self) -> &Bridge<PixelmapperNetBackend> {
        self.bridge
            .get_or_init(|| async {
                // `serve`'s defaults: UDP 6454 on all interfaces, shared with other Art-Net programs.
                let backend = Arc::new(PixelmapperNetBackend::start(BackendConfig::default()).await);
                let udp = backend.status().udp;
                if !udp.bound {
                    eprintln!(
                        "[artnet] Art-Net UDP socket not bound ({}); the app sees udp.bound = false, retrying",
                        udp.error.as_deref().unwrap_or("unknown error")
                    );
                }
                Bridge::new(backend, BridgeConfig::default())
            })
            .await
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

/// Opens a bridge session; its messages arrive on `on_event` (first the bridge `hello`). Returns the session id.
#[tauri::command]
pub async fn artnet_connect(
    state: State<'_, ArtNetBridge>,
    on_event: Channel<ArtNetSessionEvent>,
) -> Result<u32, String> {
    let bridge = state.bridge().await;
    state.sessions.connect(bridge, move |event| {
        if let Err(e) = on_event.send(event) {
            eprintln!("[artnet] cannot deliver a bridge message to the webview: {e}");
        }
    })
}

/// Sends one JSON command of the contract to the session.
#[tauri::command]
pub async fn artnet_send_text(state: State<'_, ArtNetBridge>, session: u32, text: String) -> Result<(), String> {
    state.sessions.send_text(session, &text).await
}

/// Sends the raw request body as one DMX frame set. Header: `x-session` (id).
#[tauri::command]
pub async fn artnet_send_binary(state: State<'_, ArtNetBridge>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected a raw byte body".into());
    };
    let session: u32 = header(&request, "x-session")?.parse().map_err(|_| "invalid x-session")?;
    state.sessions.send_binary(session, data.clone()).await
}

/// Ends a session (idempotent).
#[tauri::command]
pub async fn artnet_disconnect(state: State<'_, ArtNetBridge>, session: u32) -> Result<(), String> {
    state.sessions.disconnect(session)
}

// ── Tests ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use pmnet_bridge::backend::mock::MockBackend;
    use pmnet_bridge::protocol::frame::encode_frame_set;
    use serde_json::{json, Value};
    use std::time::Duration;
    use tokio::sync::mpsc;

    /// A bridge on the mock backend with one sample node, plus a session whose events land in a channel.
    async fn setup() -> (MockBackend, Bridge<MockBackend>, Arc<Sessions<MockBackend>>, u32, mpsc::UnboundedReceiver<ArtNetSessionEvent>) {
        let mock = MockBackend::new();
        mock.upsert_node(pmnet_bridge::backend::mock::sample_node(
            "7FF0:8A1B2C3D",
            std::net::Ipv4Addr::new(2, 27, 44, 61),
            4,
        ));
        let bridge = Bridge::new(Arc::new(mock.clone()), BridgeConfig::default());
        let sessions = Arc::new(Sessions::default());
        let (tx, rx) = mpsc::unbounded_channel();
        let id = sessions.connect(&bridge, move |e| { let _ = tx.send(e); }).unwrap();
        (mock, bridge, sessions, id, rx)
    }

    /// The next event within 3 s.
    async fn next(rx: &mut mpsc::UnboundedReceiver<ArtNetSessionEvent>) -> ArtNetSessionEvent {
        tokio::time::timeout(Duration::from_secs(3), rx.recv()).await.expect("event in time").expect("open")
    }

    /// The next event as JSON (must be a message).
    async fn next_json(rx: &mut mpsc::UnboundedReceiver<ArtNetSessionEvent>) -> Value {
        match next(rx).await {
            ArtNetSessionEvent::Message { text } => serde_json::from_str(&text).unwrap(),
            other => panic!("expected a message, got {other:?}"),
        }
    }

    #[test]
    fn events_serialize_like_the_frontend_expects() {
        let msg = serde_json::to_value(ArtNetSessionEvent::Message { text: "{}".into() }).unwrap();
        assert_eq!(msg, json!({"kind": "message", "text": "{}"}));
        let close = serde_json::to_value(ArtNetSessionEvent::Close { code: 4002, reason: "x".into() }).unwrap();
        assert_eq!(close, json!({"kind": "close", "code": 4002, "reason": "x"}));
    }

    #[tokio::test]
    async fn handshake_command_dmx_and_disconnect() {
        let (mock, _bridge, sessions, id, mut rx) = setup().await;
        assert_eq!(next_json(&mut rx).await["type"], "hello");
        sessions.send_text(id, r#"{"type":"hello","id":1,"protocol":"1.0.0"}"#).await.unwrap();
        assert_eq!(next_json(&mut rx).await, json!({"type": "result", "id": 1, "result": {}}));
        sessions
            .send_text(id, r#"{"type":"dmxRoutes","id":2,"routes":[{"route":1,"nodeId":"7FF0:8A1B2C3D","portAddress":1}]}"#)
            .await
            .unwrap();
        assert_eq!(next_json(&mut rx).await["id"], 2);
        sessions.send_binary(id, encode_frame_set(&[(1, &[1, 2, 3])], true)).await.unwrap();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        while mock.dmx_sent().is_empty() {
            assert!(tokio::time::Instant::now() < deadline, "no DMX sent");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(&mock.dmx_sent()[0].frames[0].data[..], &[1, 2, 3]);

        sessions.disconnect(id).unwrap();
        sessions.disconnect(id).unwrap();
        assert!(sessions.send_text(id, "{}").await.is_err());
        // A client disconnect ends the forwarding without a close event.
        let end = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await.expect("ends");
        assert_eq!(end, None);
    }

    /// The desktop path against the real backend: `pmnet sim` node with a fixture on port 1, discovered and its
    /// TOD read through a Tauri-style session (UDP on localhost only).
    #[tokio::test]
    async fn real_backend_discovers_a_simulated_node() {
        use pixelmapper_net::rdm::Uid;
        use pixelmapper_net::sim::{SimConfig, SimFixture, SimNode};
        use pmnet_bridge::backend::pixelmapper_net::BackendConfig;

        let fixture = Uid::new(0x7FF1, 0x0000_2001);
        let free = std::net::UdpSocket::bind("127.0.0.1:0").unwrap().local_addr().unwrap();
        let sim = SimNode::start(SimConfig { bind: free, ..SimConfig::default() }).await.expect("simulator");
        sim.add_responder(1, Box::new(SimFixture::default_par(fixture)));
        let mut cfg = BackendConfig::local(vec![free]);
        cfg.controller.poll_interval = Duration::from_millis(300);
        let backend = Arc::new(PixelmapperNetBackend::start(cfg).await);
        let bridge = Bridge::new(backend.clone(), BridgeConfig::default());
        let sessions = Arc::new(Sessions::default());
        let (tx, mut rx) = mpsc::unbounded_channel();
        let id = sessions.connect(&bridge, move |e| { let _ = tx.send(e); }).unwrap();

        let hello = next_json(&mut rx).await;
        assert_eq!(hello["udp"]["bound"], true);
        sessions.send_text(id, r#"{"type":"hello","id":1,"protocol":"1.0.0"}"#).await.unwrap();
        // Discovery: events until the fixture shows up in a `tod`.
        let tod = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let v = next_json(&mut rx).await;
                if v["type"] == "tod" && v["uids"].as_array().is_some_and(|u| !u.is_empty()) {
                    return v;
                }
            }
        })
        .await
        .expect("TOD of the simulated node");
        assert_eq!(tod["uids"], json!([fixture.to_string()]));
        sessions.disconnect(id).unwrap();
        backend.shutdown();
    }

    #[tokio::test]
    async fn bridge_close_is_forwarded_once() {
        let (_mock, _bridge, sessions, id, mut rx) = setup().await;
        next_json(&mut rx).await;
        sessions.send_text(id, r#"{"type":"hello","id":1,"protocol":"9.0.0"}"#).await.unwrap();
        assert_eq!(next_json(&mut rx).await["code"], "incompatibleProtocol");
        assert!(matches!(next(&mut rx).await, ArtNetSessionEvent::Close { code: 4001, .. }));
        let end = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await.expect("ends");
        assert_eq!(end, None, "nothing after the close");
        assert!(sessions.send_text(id, "{}").await.is_err());
    }
}
