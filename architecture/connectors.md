# Connectors, Controllers & Hardware

All outputs and hardware controllers are **extensions** (ADR 0001 D17). The core renders DMX and hands the rendered frames to whatever connectors are installed; without any connector extension the app still works, it just has no output. Connector setups belong to the **user and device**, not to the project (D18).

## Architecture

```
engine worker ──frame──► engine-store.onFrame(dmx)
                            ├── connectionsStore.sendFrame(dmx)          mapped universes → connector.sendFrame(universe, 512 B)
                            └── connectionsStore.notifyEngineState(s)    { bpm, elapsedMs, beatTime, dmxBuffer } → connector.onEngineState
```

| Piece | Where | Role |
|---|---|---|
| `ConnectorBase`, `Connector`, `ConnectorDefinition`, `defineConnector` | `@pixelmapper/extension-api` | Contract + base class (status, logs, label, outputs, auto-reconnect, `getConfig`/`applyConfig`, `canAutoConnect`) |
| `connector-registry.ts` | `app/utils/connectors/` | Connector types from registered extensions; `restoreConnector(type, id, config)` |
| `connections-store.ts` | `app/stores/` | Instances, frame routing, per-user persistence |
| `ConnectorCard.vue` | `app/components/connectors/` | Generic card: status, label, connect/disconnect/remove, the type's `settings` component, output mapping, logs |
| `binary-encoder.ts` | `app/utils/connectors/` | **Engine** packets only (layout, channels, modifiers → worker) |

### Writing a connector

```ts
import { ConnectorBase, defineConnector, defineExtension } from '@pixelmapper/extension-api';

class UdpConnector extends ConnectorBase {
  readonly meta = { type: 'my-udp', label: 'My UDP node', icon: 'network' };
  constructor(id: string) { super(id); this.initOutputs(2); }     // two DMX outputs → universes via mapping
  async connect() { /* open */ this.status.value = 'connected'; this.autoReconnect.value = true; }
  async disconnect() { this.autoReconnect.value = false; this.status.value = 'disconnected'; }
  override sendFrame(universeData: Uint8Array, universe?: number) { /* non-blocking write */ }
  override getConfig() { return { ...super.getConfig(), host: this.host }; }
  override applyConfig(c: Record<string, unknown>) { super.applyConfig(c); if (typeof c.host === 'string') this.host = c.host; }
  host = '';
}

export default defineExtension({
  id: 'connector-my-udp', version: '1.0.0', apiVersion: '^1.0.0',
  displayName: 'My UDP output', description: 'Streams universes to my UDP node.',
  contributes: { connectors: [defineConnector({
    type: 'my-udp', label: 'My UDP node', icon: 'network', description: '…', direction: 'output',
    create: id => new UdpConnector(id),
    fromConfig: (id, config) => { const c = new UdpConnector(id); c.applyConfig(config); return c; },
    settings: UdpSettings,            // prop `connector`, emits change(patch)
  })] },
});
```

- **Outputs:** `outputCount > 0` → the host calls `sendFrame(512 bytes, universe)` for every mapped output each frame. `outputCount = 0` → implement `onEngineState(state)` and read what you need from `state.dmxBuffer` (absolute address − 1). Never block; fire-and-forget writes.
- **Fixture data:** connectors are not components; use `getFixture(id)` from the API (a readonly view incl. channels with `dmxAddress` and kind config). Re-read it occasionally (e.g. every 30 frames), not every frame.
- **Settings:** the host renders label, connect/disconnect, output mapping and logs. The type's `settings` component renders only type-specific fields and emits `change(patch)`; the host applies it (`applyConfig`) and persists. Settings run in the extension's context, so `useExtensionContext()` / `useScope('project')` work (e.g. the ESP strip node edits strips through `ctx.commands.setFixtureKindConfig`).
- **Auto-connect:** return `true` from `canAutoConnect()` when the instance can connect without a user gesture (WebSocket/ArtNet with a URL). Web Serial/MIDI need a click.
- **Always connected (API 1.2):** return `true` from `alwaysConnected()` when there is no connection for the user to manage (ArtNet over direct UDP in the desktop app). The host connects the instance when it is added or restored, and the card shows no Connect/Disconnect button, only Retry after an error.
- **Platform I/O ([ADR 0003](adr/0003-native-platform-layer.md)):** never call `navigator.serial`, `navigator.requestMIDIAccess` or `@tauri-apps/*` directly. Use `getPlatform()` from the API: `udp`, `serial` and `midi` are transport-shaped (bytes in/out) and `null` where the platform lacks them — fall back (ArtNet → bridge) or show a message such as "needs Chrome/Edge or the desktop app". Protocol encoding stays in the extension (e.g. `connector-artnet/art-dmx.ts`, also used by the bridge).

### Persistence (D18)

`connections-store.ts` keeps setups in `localStorage["pm:connectors:<userId|local>"]` as `{ id, type, config }[]`, loads them after app mount (`app/plugins/02.connectors.client.ts`) and on user change, and keeps them across project switches. Entries whose type is not installed stay stored untouched. Nothing about connectors is in project snapshots or the change log.

## First-party connector extensions

| Extension | Set | Connectors |
|---|---|---|
| `connector-artnet` | distribution | `artnet-node` (one connector per Art-Net 4 node found by the bridge `pmnet serve`, see below) and `artnet` — “ArtNet (manual target)”: direct ArtDMX over `getPlatform().udp` in the desktop app; in the browser universes go to the old local WebSocket→UDP bridge (`tools/artnet-bridge`), frames `[universe u16 LE][512 bytes]`, JSON config message for target IP/port |
| `connector-esp` | catalog | `serial` (ESP32 DMX node over platform serial — Web Serial or native, firmware OTA), `websocket` (ESP32-S3 LED strip node, USB setup wizard), `espnow-bridge` (audience color broadcast) |

### Art-Net nodes (`extensions/connector-artnet`, plan M5)

All Art-Net 4 / RDM packets, timers and procedures live in the Rust bridge **`pmnet serve`** (crate `pixelmapper-net`, hardware repo). The extension sends intents and receives state over the [bridge WebSocket protocol](artnet-bridge-ws-protocol.md) and never builds packets.

```
connector-artnet
├── bridge/            contract mirror + client (public surface: bridge/index.ts)
│   ├── backend.ts           ArtNetBackend interface, BackendState, DmxTarget, BridgeCommandError
│   ├── ws-bridge-backend.ts WsBridgeBackend: one WebSocket per app, hello/version check, reconnect with backoff,
│   │                        command ids/timeouts, events, poll targets, DMX frame sets (dmx-router.ts, frame-set.ts)
│   ├── node-directory.ts    reactive nodes + TODs from events and the `nodes` snapshot (cleared without bridge)
│   ├── shared.ts            getArtNetBackend() / getNodeDirectory() / startArtNetDiscovery(), bridge URL setting
│   └── testing/             FakeArtNetBackend, FakeBridgeSocket, fixtures (for tests of later milestones)
├── node/              artnet-node connector, output ports + mapping, status, suggestions, dismissals
├── host-connectors.ts adapter for host features the API lacks (adding a connector, user key) — temporary
└── components/        NodeSuggestions (slot), NodeConnectorSettings, NodePortTable, BridgeStatusHint, …
```

- **Backend seam.** UI and connectors use only `ArtNetBackend` (`request(type, args)`, `on(event, cb)`, `sendDmx(target, data)`, `addPollTarget(ip)`, reactive `state`). `WsBridgeBackend` is used in the browser and the desktop app; a native backend (embedded `pixelmapper-net` via Tauri) can replace it with `installArtNetBackend()` without touching UI code. One instance per app; the manifest's `activate` starts it, so discovery runs while the extension is active.
- **States.** `idle`, `connecting`, `connected` (after `hello` + client `hello`), `unreachable` (retry 1 s → 30 s backoff, *“start pmnet serve”*), `incompatible` (protocol major differs → *“Bridge update needed”* / app too old; no `hello` within 3 s → another program, e.g. the old bridge), `unsupported` (Safari: *“Art-Net discovery is not supported in Safari”*). The bridge URL (default `ws://127.0.0.1:7777`) is a per-device setting in the hint (`pm:artnet:bridge-url`).
- **`artnet-node` connector** (D6): config `{ nodeId (UID, else mac:…), ip, manual, ports: ['1.0', …], outputMapping }`. Outputs = the node's output ports in BindIndex order (the Pixelmapper Node: 4 ports, one per BindIndex); default universe = Port-Address + 1 (D7), changed ports are reconciled by port key. Status: `connected` when the bridge is connected and the node answers; `connecting` + message while the node is offline or the bridge is not running; `error` when the bridge is incompatible/unsupported (Retry = reconnect now). Always connected (`alwaysConnected`): the bridge connection is shared, so the host connects it on add/restore and calls `disconnect` only on remove. What the connector learns (node id after an add by IP, IP changes, ports) is persisted by its settings component while the card is open.
- **DMX out** (M5.4): `sendFrame(universe)` → `backend.sendDmx({ nodeId, portAddress }, data)` for every output port mapped to that universe. The backend collects one rendered frame into one binary frame set (+ `dmxRoutes` when routes change); the bridge sends unicast ArtDmx and a broadcast ArtSync. Fire-and-forget; dropped while the socket is backed up.
- **Port mapping** (M5.5): per port the universe, the node's Port-Address (read-only) and *Write port address to node* (`artAddress`) — the only write to the node; the new state comes back as a `node` event (D5).
- **Suggestions** (M5.2): contributed into the core slot `connections/outputs:before`: *Art-Net node found: name · IP — Connect / Dismiss* for discovered output nodes without a connector, *Add by IP* (the bridge then polls that IP), and the bridge hint. Dismissals: `pm:artnet:dismissed-nodes:<user key>`.
- **Pending core API** (workaround in `host-connectors.ts`): extensions cannot add connector instances or read the current user. Until `connectors.add(connector)` and the user id exist in `@pixelmapper/extension-api`, *Connect* uses the host's Pinia store `connections` and dismissals use the user key `local`. Without the store, the user adds the node with *+ Art-Net node* and picks it in the connector's node picker.

### ESP firmware protocol (`extensions/connector-esp/protocol.ts`)

Framed packets `[0xAA][0x55][type][len u16 LE][payload]` (ADR D16: firmware encodings live in the connector extension):

| Type | Packet | Sent by |
|---|---|---|
| `0x11` | VERSION_REQ (device answers `[version] X.Y.Z`) | all |
| `0x15`–`0x17` | OTA begin (u32 size) / chunk / end | serial (firmware update) |
| `0x18` | UNIVERSE_MAP `[count, u…]` | serial, when the output mapping changes |
| `0x1A` | STRIP_SLOTS `[count] + 8 B/slot (pin, chip, ledCount, groupSize, ledsPerMeter)` | websocket, when the slot layout changes |
| `0x20` | COLOR_CMD `r, g, b, brightness` | espnow-bridge (deduplicated, 1 s heartbeat) |
| `0x21` | DMX_FRAME `[universe][512 bytes]` | serial, per mapped universe per frame |
| `0x22` | PIXEL_FRAME `[slot][count u16][RGB(W) bytes]` | websocket, per slot per frame |

Since plan P6.2 the app streams **rendered output**; the former on-device rendering packets (layout, channels, modifiers, BPM, timesync) are not sent to hardware any more. The firmware projects (`pio*/`) still expect the old packets and must implement `0x21`/`0x22` — firmware changes are out of scope of ADR 0001 (§9), so ESP output does not light until then.

Strip nodes find their strips by kind id (`neopixel-strip`, read via `getFixture`) — the dependency direction is connector → kind, never core → kind.

## Hardware controllers

Controllers (MIDI grids etc.) are extensions too (`contributes.controllers`, ADR §5.7):

```ts
defineController({
  id: 'akai-apc-mini-mk2', label: 'AKAI APC Mini mk2', description: '…',
  createDriver: id => new APCMiniMk2Driver(id),     // extends ControllerDriverBase (Web MIDI)
  layoutSvg, viewBox: { w: 433, h: 372 }, defaultGridSize: { w: 20, h: 17 },
  controls,                                          // id, type, hit rect, svgId
  matches: port => /APC mini mk2/i.test(port.name),
})
```

Drivers extend `ControllerDriverBase` (status, logs, `onInput`/`emitInput`, `sendFeedback`). The core keeps the instances (`controller-store.ts`), the per-project controller list (live mode), and the generic **controller-twin** live widget that renders any registered definition (amendment A18). Design sources of layouts live in `docs/controller-designs/`.
