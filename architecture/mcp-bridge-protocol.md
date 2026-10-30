# MCP Bridge WebSocket Protocol — `pixelmapper-mcp` ↔ Pixelmapper (DRAFT)

Status: **draft**, protocol `1.0.0`, 2026-10-30. Implemented by `packages/mcp-bridge` (hub side). The app-side client (`app/utils/agents/bridge-client.ts`, plan M3) codes against this document.
Conventions follow the [Art-Net bridge protocol draft](artnet-bridge-ws-protocol.md): server `hello` with semver, JSON text frames `{ "type", "id"? }`, `id` correlation of `result` / `error`, Origin allow-list, loopback only. Decision context: [ADR 0002](adr/0002-agent-and-operations-layer.md) D16, B8, §5.

```
Claude Code ─stdio MCP─► pixelmapper-mcp #1 (hub) ◄─ws── App tab / Tauri webview (role "app")
                               ▲
Claude Desktop ─stdio MCP─► pixelmapper-mcp #2 (role "relay", connected to the hub)
```

The CLI is a thin forwarder. **Tools execute in the app.** The app announces its tool definitions; the CLI serves them over MCP `tools/list` and forwards `tools/call` as `call` messages.

## Connection

- `ws://127.0.0.1:7778` (env `PIXELMAPPER_MCP_PORT`). The hub binds `127.0.0.1` only.
- Every text frame is one JSON object `{ "type": string, "id"?: number | string, ... }`. Binary frames are not used.
- Connection roles: `app` (the Pixelmapper tab or Tauri webview) and `relay` (a second `pixelmapper-mcp` process, see [Relay mode](#relay-mode)).
- Handshake:
  1. On open, the hub sends `hello` (server side).
  2. The client checks `protocol` (**semver major must match**; otherwise close and show "Update Pixelmapper / pixelmapper-mcp").
  3. The client sends its own `hello` within **5 s** (else close `4005`).
  4. The hub answers `welcome`, or `error` followed by a close (codes below).
- Nothing except `hello` may be sent before `welcome`.

```jsonc
// hub → client, immediately on open
{ "type": "hello", "role": "hub", "bridge": "0.1.0", "protocol": "1.0.0" }
```

## Authentication

Two independent checks; both must pass.

1. **Origin allow-list** (checked on the HTTP upgrade; a rejected upgrade gets HTTP `403` and no WebSocket).
   Default: `http://localhost:3000`, `http://127.0.0.1:3000`, `tauri://localhost`, `http://tauri.localhost`.
   Override with env `PIXELMAPPER_MCP_ORIGINS` (comma-separated, replaces the default list; `*` disables the check).
   A request **without** `Origin` header (non-browser process) is accepted at upgrade time but may only authenticate as `role: "relay"`; an `app` hello without an allowed Origin fails with `origin_rejected`.
2. **Pairing token**: 32 random bytes, lowercase hex (64 chars), stored in `~/.pixelmapper/mcp-token` (mode `0600`, directory `0700`; created by the CLI on first start). `pixelmapper-mcp token` prints it. The user pastes it once into *Settings → External agents*; the app stores it and sends it in every `hello`. Comparison is constant-time.
   Env `PIXELMAPPER_MCP_TOKEN_FILE` overrides the path (tests).

## Client `hello`

```jsonc
// app → hub
{
  "type": "hello",
  "role": "app",
  "protocol": "1.0.0",
  "token": "<64 hex chars>",
  "app": { "name": "pixelmapper", "version": "0.1.27", "platform": "web" },  // platform: "web" | "tauri"
  "tools": [ /* ToolDefinition[], may be empty */ ]
}

// relay → hub
{ "type": "hello", "role": "relay", "protocol": "1.0.0", "token": "<hex>",
  "client": { "name": "claude-desktop", "version": "0.14.1" } }       // MCP clientInfo of the relay's MCP client
```

`ToolDefinition` mirrors the MCP `Tool` shape:

```jsonc
{
  "name": "observe",                       // ^[a-zA-Z0-9_-]{1,64}$, unique
  "description": "Render the selected targets and return a compact text report …",
  "inputSchema": { "type": "object", "properties": { … }, "required": [ … ] },  // JSON Schema, root type "object"
  "annotations": { "readOnlyHint": true }  // optional, passed through to MCP as-is
}
```

The hub drops (and logs) invalid definitions instead of failing the hello.

## `welcome`

```jsonc
// hub → app
{ "type": "welcome", "role": "app", "sessionId": "a1b2c3", "callTimeoutMs": 60000 }

// hub → relay (also carries the current tool state)
{ "type": "welcome", "role": "relay", "sessionId": "d4e5f6", "callTimeoutMs": 60000,
  "appConnected": true, "tools": [ /* ToolDefinition[] */ ] }
```

## App ↔ hub messages

| Direction | Type | Payload | Notes |
|---|---|---|---|
| app → hub | `tools` | `tools: ToolDefinition[]` | Re-announce the full list (replaces, never merges). The CLI emits MCP `notifications/tools/list_changed`. |
| hub → app | `call` | `id`, `tool`, `input` (object), `client` (string) | `client` = MCP client name, e.g. `claude-code`, `claude-desktop`. The app attributes the change to actor `agent:mcp:<client>` and labels undo entries `AI: <label>`. |
| app → hub | `result` | `id`, `content: Content[]`, `isError?: boolean` | `isError: true` = the tool ran and reports a domain failure (validation findings, failed expectations); the agent sees it as a tool error with the content. |
| app → hub | `error` | `id`, `code`, `message` | The tool could not run (unknown tool, exception). |
| hub → app | `cancel` | `id`, `reason` | The hub gave up (timeout, MCP client cancelled). The app SHOULD abort; a late `result` is ignored. |
| hub → app | `superseded` | `message` | A newer app connection took over; the hub closes this socket with `4003` right after. The app MUST NOT auto-reconnect after `4003` (it would steal the slot back). |
| either | `ping` / `pong` | `id` | Optional liveness check; the receiver answers `pong` with the same `id`. |

`Content` items:

```jsonc
{ "type": "text", "text": "observe front · 0.0–2.0s · 30 fps …" }
{ "type": "json", "json": { "any": "value" } }                 // CLI renders it as pretty-printed JSON text for MCP
{ "type": "image", "data": "<base64>", "mimeType": "image/png" } // optional, e.g. a screenshot tool
```

`image` items are forwarded to MCP unchanged as the SDK `CallToolResult` image block (`{ type: "image", data, mimeType }`, accepted by Claude Code and Claude Desktop). They do not count toward the CLI's text output budget (`PIXELMAPPER_MCP_MAX_OUTPUT_CHARS`) and are never cut; the frame limit (32 MiB) still applies, so producers cap their size (the `screenshot` tool renders at most 2048 px on the longer side, a few hundred KB of base64).

### Single active app

Only one `app` connection is active. A new authenticated `app` hello **wins**: the hub sends `superseded` to the previous app, closes it with `4003`, fails its in-flight calls with `app_disconnected`, and switches to the new tool list.

### Tool list when no app is connected

The CLI always answers `tools/list`:
1. the tools of the connected app; otherwise
2. the last-known list (cached in `~/.pixelmapper/mcp-tools.json`, so a fresh CLI start lists the real tools); otherwise
3. a built-in fallback set (`inspect`, `operations`, `describe`, `apply`, `observe` with permissive schemas).

The CLI always adds one local tool, `pixelmapper_status` (connection state, app version, pairing hint). Calls to any other tool while no app is connected fail with code `no_app` and the message *"Pixelmapper is not connected. Open Pixelmapper and enable Settings → External agents (pairing token: run `pixelmapper-mcp token`)."*

## Timeouts

| What | Default | Override |
|---|---|---|
| client `hello` after open | 5 s | – |
| tool call (hub waits for `result`/`error`) | 60 s (`observe` may take seconds) | env `PIXELMAPPER_MCP_CALL_TIMEOUT_MS` |
| wait for a connected app before a call fails with `no_app` (process start-up, relay handshake, app reconnect backoff) | 8 s | env `PIXELMAPPER_MCP_APP_WAIT_MS` |
| relay waits for the hub | call timeout + 5 s | – |

On timeout the hub sends `cancel` to the app and returns error `timeout` to the caller.

## Error codes

`error` messages carry `code` (string) and a human-readable `message`.

| Code | Where | Meaning |
|---|---|---|
| `bad_message` | any | Not JSON / missing `type` / unknown `type` before welcome |
| `bad_hello` | handshake | Missing/invalid `role`, `protocol`, `tools` |
| `protocol_mismatch` | handshake | Semver major differs |
| `unauthorized` | handshake | Token missing or wrong |
| `origin_rejected` | handshake | `app` role without an allowed Origin |
| `no_app` | call | No app connected |
| `app_disconnected` | call | The app went away while the call was in flight |
| `timeout` | call | No answer within the call timeout |
| `unknown_tool` | call (app) | Tool not in the app's list |
| `tool_failed` | call (app) | Tool threw |

WebSocket close codes used by the hub:

| Code | Reason |
|---|---|
| `4001` | `unauthorized` / `origin_rejected` |
| `4002` | `protocol_mismatch` |
| `4003` | `superseded` (newer app) |
| `4004` | `bad_hello` / `bad_message` during handshake |
| `4005` | hello timeout |
| `1001` | hub shutting down |

## Relay mode

Several MCP clients (Claude Code and Claude Desktop) each start their own `pixelmapper-mcp`. The **first** process binds port 7778 and becomes the **hub**. A later process that finds the port busy connects to the hub as a WebSocket client with `role: "relay"` (same token file, no Origin header).

| Direction | Type | Payload | Notes |
|---|---|---|---|
| relay → hub | `call` | `id`, `tool`, `input`, `client` | The hub forwards it to the app under a **new hub-side id** and maps the answer back. `client` is passed through so the app attributes the relay's MCP client, not the hub's. |
| hub → relay | `result` / `error` | `id` (relay's id), same payload as from the app | |
| hub → relay | `tools` | `tools`, `appConnected` | Sent whenever the app connects, disconnects or re-announces. The relay emits `tools/list_changed`. |
| relay → hub | `cancel` | `id` | The relay's MCP client cancelled. |

**Takeover.** If the hub's socket closes, the relay retries after a random 100–600 ms delay: it first tries to bind the port (becoming the new hub), otherwise reconnects as a relay. In-flight relay calls fail with `app_disconnected`. The app reconnects on its own (see below), so it finds the new hub.

## App reconnect behaviour (client side)

- Enabled only while *Settings → External agents* is on.
- Reconnect with backoff 1 s → 2 s → 5 s → 10 s (cap), reset after a successful `welcome`.
- Stop reconnecting after close `4001` (wrong token: show "Pairing token rejected") and `4003` (superseded: show "Another Pixelmapper window is connected"); `4002` shows an update hint.
- Re-send `tools` whenever the tool registry changes (e.g. an extension adds tools).

## Example session

```jsonc
// app tab connects with Origin http://localhost:3000
hub → app   { "type": "hello", "role": "hub", "bridge": "0.1.0", "protocol": "1.0.0" }
app → hub   { "type": "hello", "role": "app", "protocol": "1.0.0", "token": "9f…",
              "app": { "name": "pixelmapper", "version": "0.1.27", "platform": "web" },
              "tools": [{ "name": "inspect", "description": "…", "inputSchema": { "type": "object" } }] }
hub → app   { "type": "welcome", "role": "app", "sessionId": "k3j2", "callTimeoutMs": 60000 }
            // CLI → MCP client: notifications/tools/list_changed

// Claude Code calls tools/call { name: "inspect", arguments: { "selector": "project" } }
hub → app   { "type": "call", "id": 1, "tool": "inspect", "input": { "selector": "project" }, "client": "claude-code" }
app → hub   { "type": "result", "id": 1, "content": [{ "type": "text", "text": "project · 48 fixtures · 3 groups …" }] }

// Claude Desktop's process (relay) calls the same tool
relay → hub { "type": "call", "id": 7, "tool": "inspect", "input": { "selector": "selection" }, "client": "claude-desktop" }
hub → app   { "type": "call", "id": 2, "tool": "inspect", "input": { "selector": "selection" }, "client": "claude-desktop" }
app → hub   { "type": "error", "id": 2, "code": "tool_failed", "message": "Nothing selected" }
hub → relay { "type": "error", "id": 7, "code": "tool_failed", "message": "Nothing selected" }
```

## Open

- Tauri: B8 plans an in-process streamable-HTTP MCP server in `src-tauri`; until then the webview uses this protocol (Origin `tauri://localhost` / `http://tauri.localhost`).
- Extension hot-swap (D18) over the same socket: future message types, additive (minor bump).
- Progress notifications for long `observe` calls (`progress { id, message }`), additive.
