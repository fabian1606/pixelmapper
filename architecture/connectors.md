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
- **Own output mapping (API 1.4):** `ownsOutputMapping: true` on the definition hides the card's generic Outputs section when the settings component maps outputs itself (e.g. the Art-Net node's port table).
- **Connector set (API 1.4):** `connectors.list(type?)`, `connectors.add(connector)`, `connectors.remove(id)` and `connectors.persist(id)` let an extension manage the user's instances (e.g. *Connect* on a discovered device) and save config a connector learned by itself; `getUserKey()` namespaces other per-user state.
- **Auto-connect:** return `true` from `canAutoConnect()` when the instance can connect without a user gesture (WebSocket/ArtNet with a URL). Web Serial/MIDI need a click.
- **Always connected (API 1.2):** return `true` from `alwaysConnected()` when there is no connection for the user to manage (ArtNet over direct UDP in the desktop app). The host connects the instance when it is added or restored, and the card shows no Connect/Disconnect button, only Retry after an error.
- **Platform I/O ([ADR 0003](adr/0003-native-platform-layer.md)):** never call `navigator.serial`, `navigator.requestMIDIAccess` or `@tauri-apps/*` directly. Use `getPlatform()` from the API: `udp`, `serial` and `midi` are transport-shaped (bytes in/out) and `null` where the platform lacks them — fall back (ArtNet → bridge) or show a message such as "needs Chrome/Edge or the desktop app". Protocol encoding stays in the extension (e.g. `connector-artnet/art-dmx.ts`, also used by the bridge).

### Persistence (D18)

`connections-store.ts` keeps setups in `localStorage["pm:connectors:<userId|local>"]` as `{ id, type, config }[]`, loads them after app mount (`app/plugins/02.connectors.client.ts`) and on user change, and keeps them across project switches. Entries whose type is not installed stay stored untouched. Nothing about connectors is in project snapshots or the change log.

## First-party connector extensions

| Extension | Set | Connectors |
|---|---|---|
| `connector-artnet` | distribution | `artnet-node` (one connector per Art-Net 4 node found by the bridge `pmnet-bridge serve`, see below) and `artnet` — “ArtNet (manual target)”: direct ArtDMX over `getPlatform().udp` in the desktop app; in the browser universes go to the old local WebSocket→UDP bridge (`tools/artnet-bridge`, default `ws://localhost:7778`, see [Bridges in development](#bridges-in-development-plan-m34)), frames `[universe u16 LE][512 bytes]`, JSON config message for target IP/port |
| `connector-esp` | catalog | `serial` (ESP32 DMX node over platform serial — Web Serial or native, firmware OTA), `websocket` (ESP32-S3 LED strip node, USB setup wizard), `espnow-bridge` (audience color broadcast) |

### Art-Net nodes (`extensions/connector-artnet`, plan M5–M7)

All Art-Net 4 / RDM packets, timers and procedures live in the Rust bridge **`pmnet-bridge serve`** (binary and crate `pmnet-bridge` in `pixelmapper-hardware`, protocol code in `pixelmapper-net`; it becomes `pmnet serve` once the `pmnet` CLI embeds it). The extension sends intents and receives state over the [bridge WebSocket protocol](artnet-bridge-ws-protocol.md) and never builds packets. The hint shows the start command `pmnet-bridge serve` (`PMNET_SERVE_COMMAND`).

```
connector-artnet
├── bridge/            contract mirror + client (public surface: bridge/index.ts)
│   ├── backend.ts           ArtNetBackend interface, BackendState, DmxTarget, BridgeCommandError
│   ├── ws-bridge-backend.ts WsBridgeBackend: one WebSocket per app, hello/version check, reconnect with backoff,
│   │                        command ids/timeouts, events, poll targets, DMX frame sets (dmx-router.ts, frame-set.ts)
│   ├── node-directory.ts    reactive nodes + TODs from events and the `nodes` snapshot (cleared without bridge)
│   ├── shared.ts            getArtNetBackend() / getNodeDirectory() / retainArtNetDiscovery(), bridge URL setting
│   └── testing/             FakeArtNetBackend, FakeBridgeSocket, fixtures (for tests of later milestones)
├── e2e/               opt-in end-to-end test against the real pmnet-bridge + pmnet sim (`bun run test:e2e:artnet`)
├── node/              artnet-node connector, output ports + mapping, status, suggestions, dismissals
├── node-config/       node configuration (M7.3): NodeConfigPanel with Ports, Network, Device, Advanced
├── rdm/parameter-form/ generic RDM parameter form (M7.1): fields from SUPPORTED_PARAMETERS + PARAMETER_DESCRIPTION
├── firmware/          tube firmware update (M7.4): dialog, per-tube button, FirmwareUpdateManager (one per app),
│                      firmware-runtime.ts (manager on first demand, read holds, refresh after an update),
│                      device-store-reader.ts (dialog readings from the device store)
├── inspector/         RDM section of the fixture inspector (M7.2, slot selection:after)
├── devices/           RDM devices on the node ports (M6)
│   ├── device-store.ts      devices from TODs: rdmDescribe once, DEVICE_INFO re-read (45 s, TOD change, after SETs,
│   │                        LOCAL_RDM_SET), presence, SETs (address, personality, identify), Rediscover
│   ├── fixture-matching.ts  D10 cascade: RDM lookup → generated from slots → generic (stored as custom fixtures)
│   ├── add-devices.ts       Add / Add all: addFixtures + link extension data as ONE batch
│   ├── conflicts.ts, addressing.ts   overlaps by footprint; Assign free address; Auto-address
│   ├── patch-sync.ts        linked fixture → RDM SETs; Write to device / Take from device
│   ├── universe-guard.ts    confirm before leaving the port's universe; unlink / re-link
│   ├── link.ts, link-status.ts, fixture-link-state.ts   link data, effective link, Connected/Mismatch/Offline/Unlinked
│   ├── link-actions.ts      Unlink / Re-link from the inspector (same semantics as the universe guard)
│   └── device-runtime.ts    one runtime per app (activate): store + matcher + sync + guard while node connectors exist
└── components/        NodeSuggestions (slot), NodeConnectorSettings, NodePortTable, DeviceDiscoveryList,
                       RdmStatusBadge (slot) + MismatchPopover, BridgeStatusHint, …
```

- **Backend seam.** UI and connectors use only `ArtNetBackend` (`request(type, args)`, `on(event, cb)`, `sendDmx(target, data)`, `addPollTarget(ip)`, reactive `state`). `WsBridgeBackend` is used in the browser and the desktop app; a native backend (embedded `pixelmapper-net` via Tauri) can replace it with `installArtNetBackend()` without touching UI code. One instance per app. **Start policy (discovery on demand):** the backend runs only while something holds `retainArtNetDiscovery()` — the node suggestions on the Connectors page (mounted), every `artnet-node` connector and the inspector's RDM section (mounted) — so users who never use Art-Net get no bridge connection (no browser local-network prompt, no connection errors). The demand counter is reactive (`artNetDiscoveryDemand()`); the firmware update manager is created on the first demand only.
- **States.** `idle`, `connecting`, `connected` (after `hello` + client `hello`), `unreachable` (retry 1 s → 30 s backoff, *“start pmnet-bridge serve”*), `incompatible` (protocol major differs → *“Bridge update needed”* / app too old; no `hello` within 3 s → another program, e.g. the old bridge), `unsupported` (Safari: *“Art-Net discovery is not supported in Safari”*). The bridge URL (default `ws://127.0.0.1:7777`) is a per-device setting in the hint (`pm:artnet:bridge-url`). Every close (incl. `4003` “client too slow”) reconnects; results are matched by `id` only (the bridge runs network commands concurrently). `bridge/command-limits.ts` rejects what the bridge would reject before sending (messages > 4 MiB, node names > 17/63 bytes, `rdmDescribe`/`flash` to broadcast UIDs) and keeps invalid DMX targets (broadcast IPs, Port-Address out of range) out of the all-or-nothing `dmxRoutes` table; a rejected table is kept in `backend.dmxError` and shown on the node connector.
- **`artnet-node` connector** (D6): config `{ nodeId (UID, else mac:…), ip, manual, ports: ['1.0', …], outputMapping }`. Outputs = the node's output ports in BindIndex order (the Pixelmapper Node: 4 ports, one per BindIndex); default universe = the port's Port-Address (D7; Port-Address 0 → U1; *Write port address to node* writes universe U as Port-Address U), changed ports are reconciled by port key. Status: `connected` when the bridge is connected and the node answers; `connecting` + message while the node is offline or the bridge is not running; `error` when the bridge is incompatible/unsupported (Retry = reconnect now). Always connected (`alwaysConnected`): the bridge connection is shared, so the host connects it on add/restore and calls `disconnect` only on remove. What the connector learns (node id after an add by IP, IP changes, ports) it persists itself with `connectors.persist(id)` (API 1.4), card open or not. The type sets `ownsOutputMapping`: the port table replaces the card's generic Outputs section.
- **DMX out** (M5.4): `sendFrame(universe)` → `backend.sendDmx({ nodeId, portAddress }, data)` for every output port mapped to that universe. The backend collects one rendered frame into one binary frame set (+ `dmxRoutes` when routes change); the bridge sends unicast ArtDmx and a broadcast ArtSync. Fire-and-forget; dropped while the socket is backed up.
- **Port-Address of a port:** only the field of the port's current direction is meaningful (contract rev 2; the Pixelmapper Node leaves universe 0 in the other): every reader uses `portAddressOf(port)` — mapping defaults, the port table, DMX routes (only ports that output now), the Ports section.
- **Port mapping** (M5.5, “Universes” in the card): per port the universe and the node's Port-Address, read-only, with a “≠ U<n>” note when they differ (DMX still reaches the port — it is sent to the port's actual Port-Address). The Port-Address itself is written only in the node configuration's *Ports* section (M7.3); the card has no second write path.
- **Suggestions** (M5.2): contributed into the core slot `connections/outputs:before`: *Art-Net node found: name · IP — Connect / Dismiss* for discovered output nodes without a connector, *Add by IP* (the bridge then polls that IP), and the bridge hint. *Connect* adds the connector with `connectors.add` (API 1.4). Dismissals: `pm:artnet:dismissed-nodes:<getUserKey()>`, following sign-in/user switches.

#### RDM devices (plan M6, v1)

- **Device list** (M6.1, D9) in the node's card under the port table: one row per UID of the port TODs — address (`U<port universe>.<DMX start address>`), label, model, personality, firmware, state *new / linked / conflict / offline*; Identify (switched off when the card closes), Add, Assign free address; for the node *Add all*, *Auto-address*, *Rediscover* (`todControl` flush per output port). State comes only from device answers (D5): DEVICE_INFO is re-read every 45 s, on TOD changes, after every SET and when the node queues LOCAL_RDM_SET (a SET from its panel, node contract §7). A port that answers TodNak (`Tod.available: false`: port off, input, or RDM disabled) loses its devices (no stale offline rows) and the list says *“Port 3: RDM is not available on this port”* (`DeviceStore.portsWithoutRdm`).
- **Link** (D13): fixture extension data `connector-artnet.rdmLink = { uid, nodeId, port, portAddress, state: 'linked' | 'unlinked' }`. **Effective** while `linked` and the fixture sits in the universe of its node port (connector mapping, default = Port-Address).
- **Add / Add all** (M6.3): device's current address and personality → mode (matching cascade M6.2; generated definitions are new custom fixtures with one mode per personality), `addFixtures` + `setExtensionData` links in ONE `batch` — one undo step, placement like the add dialog.
- **Conflicts and addressing** (M6.4): a device occupies its DEVICE_INFO footprint (a mode's channel count can differ — warned on add); conflicts with any project fixture except its own and with other devices. *Assign free address* = `findFreeAddressSpan` in the port universe → RDM SET → the linked fixture follows the device's answer. *Auto-address* = the node's linked devices per port universe in canvas order, gap-free; SETs first, then one batch for the acknowledged ones; failures per device.
- **Sync** (M6.5): `onFixturePatchChange` for local/undo/redo changes of effective links → DMX_PERSONALITY (mode → personality) then DMX_START_ADDRESS, ordered per device, then re-read. Changes made by this extension (Take from device, Assign free address, Auto-address) and collaborators' changes are not sent. Device-side differences only show as **Mismatch**.
- **Universe guard** (M6.6, D14): `onBeforeFixtureChange` confirms *“This fixture is bound to a physical node port (<node> port <n>). Change anyway?”*; the change then writes `state: 'unlinked'` (UID kept, nothing sent); moving it back into the port universe writes `linked` again (no write to the device — Mismatch shows a difference).
- **Status badge** (M6.7, D15): `scene/fixture:badges` for fixtures with a link — Connected / Mismatch / Offline / Unlinked, tooltip with reasons, UID, firmware, last seen. Mismatch opens a popover (*Write to device* / *Take from device*), teleported with `data-overlay-root` (in `FLOATING_OVERLAY_SELECTORS`).
- **Activation:** the manifest's `activate` installs the `DeviceRuntime`; store, sync and guard run only while an `artnet-node` connector exists. Tests: `FakeArtNetBackend` + `devices/testing/fake-devices.ts` (simulated tubes) + `harness.test-support.ts` (real host).

#### Node configuration (plan M7.3, D8)

`NodeConfigPanel` (`node-config/`) sits in the node's card below the device list once the node id is known, with collapsible sections (closed ones are not mounted and send nothing); the node's `rdmDescribe` is read once and shared:

- **Ports:** per port: mode output / input / off (ArtAddress direction, ArtInput for inputs, the node PID `PORTn_ENABLED` for outputs — *off* exists only on the Pixelmapper Node), the Port-Address editor (Net:Sub:Uni of the current direction's field, shared Net/Sub-Net of a BindIndex checked before sending) — **the only place that writes Port-Addresses** — merge HTP/LTP, RDM on/off, output style, the port's **failsafe** mode with *Record scene…* (`NodePortFailsafe`; contract rev 2: `PortState.failsafe`, `artAddress` `ports[].failsafe` / `recordFailsafeScene`; on nodes with several ports per BindIndex the confirmation names the ports that record along; `null` = not reported → “unknown”, still writable), and the node's per-port DMX timing PIDs (generic form). Leaving a mode while data flows asks first.
- **Network:** DHCP/static, IP, mask, gateway via `ipProg` — staged, validated (including the bridge's DHCP rule: `dhcp: true` alone, `dhcp: false` with an IP — `ipProgArgsProblem`, also enforced by `WsBridgeBackend`), applied (only the diff) after an inline confirmation; *Reset network to defaults…* likewise. The panel then follows the node by its identity to its new address (`follow` → the card stores `{ nodeId, ip }` in the connector config).
- **Device:** short/long name (ArtAddress, ≤ 17/63 bytes), identify (ArtAddress LED Locate, switched off when the section closes), firmware and identity read-only, DEVICE_LABEL where it is a separate setting (the Pixelmapper Node maps it to its short name).
- **Advanced:** the node's remaining PIDs through the generic RDM parameter form (M7.1).

State is always the node's answer (D5). Confirmations are inline boxes (`ConfirmBox`) inside the card, not modal dialogs. RDM-only settings (the parameter forms, `PORTn_ENABLED`, DEVICE_LABEL) follow queued messages and are re-read every 45 s while shown **and when the node changes** (`useNodeChangeSignal`: a settings signature of the node without `lastSeen`, the NodeReport counter and data-flow flags; bursts such as the BindIndex pages of a restart count once; a node that answers again counts): the node has one queue of queued messages for all controllers, so a second Pixelmapper (or another RDM controller) can consume the message of a change (contract rev 2: `rdmQueued` is best effort). `node` events are no heartbeat — the bridge sends them only on real changes. The node's description is read again when its firmware (VersInfo) changes. Identities: `nodeId` may be `ip:a.b.c.d:port` (simulators); `formatNodeId` shows it as `IP 127.0.0.1:50000`.

#### Bridges in development (plan M3.4)

Two local bridges, one port each:

| Port | Process | Serves |
|---|---|---|
| 7777 | `pmnet-bridge serve` (Rust, `pixelmapper-hardware`) | `artnet-node` connectors, node suggestions, RDM, firmware: the [bridge WebSocket protocol](artnet-bridge-ws-protocol.md) (app default `ws://127.0.0.1:7777`, per-device setting `pm:artnet:bridge-url`) |
| 7778 | `tools/artnet-bridge` (Bun) | the legacy `artnet` connector (“ArtNet (manual target)”) in the browser: `[universe u16 LE][512 bytes]` + JSON `config` (default `ws://localhost:7778`); the desktop app sends direct UDP and needs neither |

- **`bun run dev`** starts both (concurrently processes `pmnet-bridge` and `artnet-legacy`). `scripts/start-pmnet-bridge.ts` looks for `pmnet-bridge` on `PATH`, else `$PIXELMAPPER_HARDWARE_DIR/target/{release,debug}/pmnet-bridge`, and runs `pmnet-bridge serve --port 7777` (stdio inherited, SIGINT/SIGTERM forwarded). Without a binary it prints how to build it (`cargo build --release -p pmnet-bridge` in `pixelmapper-hardware`) and exits 0, so the rest of `dev` keeps running.
- **Standalone:** `bun run pmnet-bridge` (extra arguments go to `serve`, e.g. `--mock` for a simulated node with three tubes, `--offline`, `-v`, `--port`), `bun run artnet-bridge` (`PORT` overrides 7778).
- **Port move:** both bridges used to listen on 7777, and `pmnet-bridge` does not serve legacy clients (contract §7 *Legacy clients*: a `config` message gets `badRequest`, close `4002`). Stored `artnet` configs whose `bridgeUrl` is exactly the former default (`ws://localhost:7777` or `ws://127.0.0.1:7777`) move to `ws://localhost:7778` when they are restored (`ArtNetConnector.fromConfig`, persisted with the next save); custom URLs and URLs typed in the settings are kept as they are.
- **No release binaries yet** (plan M3.3 is open: the hardware repo has no remote/CI), so `PMNET_DOWNLOAD_URL` is `null` and the bridge hint shows the start command without a download link.

#### End-to-end test against the real bridge (WP8)

`bun run test:e2e:artnet` (`vitest.e2e.config.ts`, node environment; `*.e2e.test.ts` are excluded from `bun run test`) runs `extensions/connector-artnet/e2e/bridge-sim.e2e.test.ts`: it needs the hardware repo (`PIXELMAPPER_HARDWARE_DIR`, else the default `pixelmapper-hardware-wt/bridge-adapter` worktree when it exists; skipped otherwise), runs `cargo build -p pixelmapper-net -p pmnet-bridge`, starts `pmnet sim` (2 tubes on port 1, 1 fixture on port 2) and `pmnet-bridge serve --bind 127.0.0.1 --udp-port 0 --broadcast 127.0.0.1:<sim>` on free ports, and always kills both process groups. The real plugin code (`WsBridgeBackend` over Node's WebSocket with an allowed `Origin`, `NodeDirectory`, `DeviceStore`, the matching cascade, `FirmwareUpdateManager`) goes through: Origin refusal, handshake, discovery (4 ports, per-port failsafe), TODs and TodNak, `rdmDescribe`, matching (generated), DMX_START_ADDRESS SET + read-back, per-port failsafe, the node-change signal, a DMX frame set, `ipProg` read + DHCP rule, flash pre-checks and a tube flash of a test image (built like the bridge's `build_test_image`) to `done`. About 25 s.

#### Tube firmware update (plan M7.4, D17)

- **Batch per node:** *Update tubes…* in the node's card opens `FirmwareUpdateDialog`: pick a `.hex` → trailer preview (`imageInfo`) → the node's tubes with version old → new; newer images are preselected, same version is offered, older needs a downgrade confirmation; other manufacturer/model is not offered. One update per port at a time, ports in parallel; progress, phase and errors per tube; cancel. **Per tube:** *Update firmware…* in the inspector's RDM section (same dialog limited to one UID).
- **Readings** come from the device store (`deviceStoreTubeReader`): opening the dialog sends no RDM GETs; *Refresh* costs one DEVICE_INFO per tube through the store (which updates badges and the device list too). Tubes the store does not track are read directly (DEVICE_INFO + SOFTWARE_VERSION_LABEL).
- **Runtime:** `activate` installs `installFirmwareRuntime()`. The app-wide `FirmwareUpdateManager` is created on the first discovery demand and re-attaches to the bridge's jobs after every (re)connect (`flashJobs`), also after a reload; updates keep running when the dialog closes. While an update holds its port, the device store holds the tube's reads (`holdReads`, no GETs against the bootloader); a finished update refreshes the tube with `describe(uid, true)`, a failed/cancelled one with one DEVICE_INFO.

#### Inspector RDM section (plan M7.2, D18)

`inspector/RdmInspectorSection.vue` in the core slot `selection:after` with `when: s => !!readLink(s.fixture?.extensionData)`: in the fixture inspector at the bottom of the scene sidebar (`SelectionInfoSection`), directly below the fixture's own DMX address, mode and kind fields — a linked tube is a normal fixture (D18). The slot exists only for a single selected fixture (with `fixture`), so multi-selections show nothing; it is visible whenever the tube is selected, no properties category has to be opened. Laid out for the narrow sidebar (heading + badge in one row, long values truncated with a tooltip); the inspector scrolls when the section makes it taller than 60 % of the sidebar. Its popovers and dialogs (Mismatch popover, firmware dialog) carry `data-overlay-root` (`FLOATING_OVERLAY_SELECTORS`). Content:

- status badge (`RdmStatusBadge`, incl. the Mismatch popover) and its reasons, UID, node port + port universe, firmware (SOFTWARE_VERSION_LABEL when it describes the running version, else the version id);
- **Identify** (store, ACK = state), switched off when the inspected device changes or the section unmounts;
- **DEVICE_LABEL**, editable, written with `store.setDeviceLabel` and read back (the device list shows the same answer);
- the device's further parameters via `RdmParameterForm` (without DEVICE_LABEL, IDENTIFY, SOFTWARE_VERSION_LABEL, address and personality — address and mode stay the normal fixture fields);
- *Update firmware…* for our tubes (manufacturer `0x7FF0`, model tube);
- **Unlink** (state `unlinked`, UID kept, nothing sent) while the link is effective, else **Re-link**: moves the fixture back into its port's universe (same local address) and sets `linked` in one undo step; nothing is written to the device, a difference shows as Mismatch.

The section holds `retainArtNetDiscovery()` while mounted.

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
