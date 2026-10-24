# Bridge WebSocket Protocol — `pmnet serve` ↔ Pixelmapper (DRAFT)

Status: **draft**, 2026-10-24. Moves to `pixelmapper-hardware/protocol/bridge-ws.md` with milestone M3.1 of the [Art-Net/RDM plan](artnet-rdm-implementation-plan.md).

The bridge owns every Art-Net/RDM packet, timer and procedure. Pixelmapper sends intents and receives state. All state follows the node protocol contract's last-writer-wins rule: events report what the network says, never what was requested.

## Connection

- `ws://127.0.0.1:7777` (port configurable). The bridge binds loopback only and rejects `Origin`s outside its allow-list.
- Text messages are JSON `{ "type": string, "id"?: number, ... }`. `id` correlates a command with its `result`/`error`.
- Binary messages are DMX frames (see below).
- First message from the bridge: `hello`. The app checks `protocol` (semver major must match) before sending anything.

```jsonc
{ "type": "hello", "bridge": "0.1.0", "protocol": "1.0.0",
  "interfaces": [{ "name": "en7", "ip": "2.0.0.1", "mask": "255.0.0.0" }] }
```

## Identifiers

| Name | Format | Notes |
|---|---|---|
| `nodeId` | `"7FF0:8A1B2C3D"` (UID) or `"mac:00:11:22:33:44:55"` | UID from `DefaultRespUID`, MAC fallback for nodes without one |
| `port` | `{ "bind": 1, "index": 0 }` | `BindIndex` + port index within that reply |
| `portAddress` | number 0–32767 | 15-bit Net/Sub/Uni |
| `uid` | `"7FF0:74B6510C"` | RDM UID |

## Events (bridge → app)

| Type | Payload |
|---|---|
| `node` | full node state: `nodeId`, `ip`, `mac`, short/long name, firmware, `estaMan`, `oem`, status flags, `ports[]` (`port`, direction, `portAddress`, rdm, merge, data flags, failsafe), `lastSeen` |
| `nodeGone` | `nodeId` (no reply for 3 poll cycles) |
| `tod` | `nodeId`, `port`, `uids[]` (complete list after multi-packet assembly) |
| `rdmQueued` | `nodeId`, `uid`, decoded queued/status message |
| `diag` | `nodeId`, priority, text (ArtDiagData) |
| `flashProgress` | `jobId`, `uid`, phase (`checking`/`entering`/`writing`/`verifying`/`finishing`/`done`/`failed`), `pagesDone`, `pagesTotal`, `error`? |
| `log` | level, text |

## Commands (app → bridge)

Every command answers with `{ "type": "result", "id", ... }` or `{ "type": "error", "id", "code", "message" }`. RDM errors carry the NACK reason or `timeout`.

| Type | Arguments | Result |
|---|---|---|
| `nodes` | – | current `node[]` |
| `todRequest` | `nodeId`, `port` | – (answer arrives as `tod`) |
| `todFlush` | `nodeId`, `port` | – (ArtTodControl AtcFlush) |
| `rdmGet` | `nodeId`, `port`, `uid`, `pid`, `data`? (hex) | `data` (hex) |
| `rdmSet` | `nodeId`, `port`, `uid`, `pid`, `data` (hex) | – |
| `rdmDescribe` | `nodeId`, `port`, `uid` | DEVICE_INFO, labels, software version, personalities, slot info, supported parameters with their PARAMETER_DESCRIPTION, decoded |
| `artAddress` | `nodeId`, fields per ArtAddress (names, per-port address/merge/direction/rdm/output style, failsafe, command) | – (new state arrives as `node`) |
| `ipProg` | `nodeId`, dhcp?, ip?, mask?, gateway?, reset? | ArtIpProgReply fields |
| `artInput` | `nodeId`, `bind`, `disabled[]` | – |
| `flash` | `nodeId`, `port`, `uid`, `hex` (file content, text), `allowDowngrade` | `jobId`, trailer info (model, version) |
| `flashCancel` | `jobId` | – |
| `subscribeDmx` | `nodeId`, `port` → `portAddress` mapping list | – (tells the bridge where frames go) |

## DMX frames (binary, app → bridge)

`[portAddress u16 LE][length u16 LE][DMX bytes]`, one message per universe per frame, followed by a 1-byte `0x00` message = "frame set complete" (bridge sends ArtSync). The bridge sends unicast ArtDmx with its own sequence counter to every node port subscribed to that port-address.

## Open

- Whether DMX input (node input ports → Pixelmapper) is in scope for v1.
- Authentication beyond `Origin` (token in the URL?) for multi-user machines.
