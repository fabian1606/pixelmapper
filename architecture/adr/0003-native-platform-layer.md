# ADR 0003 — Platform Layer: Web First, Native Where It Pays Off

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-10-16 |
| **Deciders** | Fabian Rafreider |
| **Builds on** | [ADR 0001 — Extension & Content-Plugin System](0001-extension-and-content-plugin-system.md) (fills the "Tauri port" out-of-scope item), [ADR 0002](0002-agent-and-operations-layer.md) |

This ADR is the **normative specification** of how Pixelmapper runs both as a web app and as a native desktop app (Tauri 2) from one codebase, and how platform-specific capabilities (UDP, serial, MIDI, raw touch, the render engine) are selected per target.

Key words: **MUST** / **MUST NOT** = hard requirement, **SHOULD** = default unless there is a documented reason, **MAY** = optional.

---

## 1. Context

- The browser cannot open UDP sockets, so **Art-Net/sACN** needs a local WebSocket bridge (`tools/artnet-bridge`).
- **Multi-touch** from external USB touch screens does not reach any webview on macOS (the OS treats them as a single-pointer mouse). A Rust HID bridge exists as a prototype (`gesture-lab/bridge`, `hidapi`).
- **Web Serial** (ESP connectors) and **Web MIDI** (APC Mini mk2) exist only in Chromium. Tauri on macOS uses WKWebView (WebKit), which has neither.
- The render engine (`rs-engine`) is already Rust. In the browser it runs as WASM in a Web Worker and every DMX frame passes through JavaScript to reach the connectors.
- Built-in touch support on future Mac hardware will likely deliver multi-touch pointer events to webviews, so the touch bridge is a stop-gap for the web, not a permanent requirement.

Requirements from the product side:

1. The **web app MUST stay a first-class target.** As much as possible runs in the browser; features that cannot work there degrade visibly, they do not break.
2. Where a native implementation is **faster or more capable**, the desktop app SHOULD use it.
3. One codebase. Platform differences are resolved by **which implementation is imported**, not by `if (isTauri)` branches spread across features.

---

## 2. Decision summary

```
┌──────────────────────────────────────────────────────────────────────┐
│ Core app + extensions (unchanged UI, stores, commands)               │
│        │ host code: import from '#platform'                          │
│        │ extensions: getPlatform() via HostApi                        │
├────────┴─────────────────────────────────────────────────────────────┤
│ Platform contract  (@pixelmapper/extension-api/platform)             │
│   kind · udp · serial · midi   (later: touch · engine)               │
├──────────────────────────────┬───────────────────────────────────────┤
│ app/platform/web             │ app/platform/tauri                    │
│ Web Serial, Web MIDI,        │ = web platform + native overrides     │
│ no UDP (bridge fallback)     │ (invoke/Channel → Rust backend)       │
└──────────────────────────────┴───────────────────────────────────────┘
                                         │
                       src-tauri: shared Rust crates (io-artnet, io-touch,
                       rs-engine native) — also used by the standalone bridges
```

---

## 3. Decisions (normative)

### D1 — Tauri 2 is the native target
The desktop app is built with **Tauri 2**. Reasons: the engine and both bridges are already Rust; small bundle; mobile targets (iPad: native multi-touch) are available from the same project.
*Rejected:* **Electron** (Chromium would keep Web Serial/MIDI working unchanged, but the Rust parts would sit beside it via N-API, and the bundle is ~15× larger); **Electrobun** (too young for a live-performance tool); **Capacitor** (mobile only, still needs native plugins).

### D2 — A platform contract with nullable capabilities
`@pixelmapper/extension-api` defines `Platform`:

```ts
interface Platform {
  readonly kind: 'web' | 'tauri';
  readonly udp: UdpApi | null;      // direct UDP datagrams (Art-Net, sACN)
  readonly serial: SerialApi | null; // serial ports (ESP devices)
  readonly midi: MidiApi | null;     // MIDI ports (hardware controllers)
}
```

- A capability that the current platform cannot provide MUST be `null`. Callers MUST check for `null` and either fall back (Art-Net → bridge) or show a clear message ("Needs Chrome/Edge or the desktop app").
- The contract is **transport-shaped** (bytes in, bytes out, port lists), never feature-shaped. Protocol logic (ArtDMX encoding, ESP line protocol, APC note mapping) stays in TypeScript, shared by both platforms.
- Further capabilities (`touch`, `engine`) are added to this interface when they are implemented (D6, D7). Adding a capability is an additive API change (minor version bump).

### D3 — Build-time selection for host code, runtime access for extensions
- **Host code** imports the implementation from the alias `#platform`. `nuxt.config.ts` (and `vitest.config.ts`) resolve it to `app/platform/web` by default and to `app/platform/tauri` when the Tauri CLI drives the build (`TAURI_ENV_PLATFORM` is set). The web bundle therefore MUST NOT contain `@tauri-apps/*` code.
- **Extensions** are distributed as prebuilt bundles and cannot be re-aliased. They read the platform at runtime via `getPlatform()` (backed by `HostApi.platform`). Extensions MUST NOT import `@tauri-apps/*` or call `navigator.serial` / `navigator.requestMIDIAccess` directly.

### D4 — The Tauri platform is the web platform plus overrides
`app/platform/tauri` starts from `createWebPlatform()` and replaces individual capabilities with native ones as they are implemented. Anything not yet ported keeps working exactly as on the web (where WKWebView supports it). This keeps every migration step small and shippable.

### D5 — Native I/O lives in shared Rust crates
Native implementations live in workspace crates (e.g. `rs-engine/io-artnet`, `rs-engine/io-touch`). The Tauri backend links them directly; the standalone bridges for the web (Art-Net bridge, touch bridge) become thin binaries over the same crates. There MUST be one implementation per protocol, not one per target.

### D6 — Raw touch (planned)
`touch: TouchSourceApi | null` streams normalized contacts (`id, x, y, w, h`). Web: `null` (pointer events are used directly; the WebSocket touch bridge remains an opt-in dev tool). Tauri: the `hidapi` reader from `gesture-lab/bridge`, delivered over a Tauri `Channel`. Consumers already use the `TouchSource` interface from the gesture lab.

### D7 — Native engine (planned, biggest performance win)
`engine` abstracts what `EffectEngine` does today (packets in, frames + previews out). Web: the WASM worker. Tauri: `rs-engine` compiled natively in the backend. In native mode, **output frames MUST NOT round-trip through JavaScript**: the engine hands frames to native outputs directly; the UI receives preview frames at display rate only. This requires connectors to declare a native sink (e.g. "Art-Net to 2.0.0.10, universes 1–4") instead of receiving `sendFrame` calls. The detailed contract is a follow-up ADR.

---

## 4. Migration plan

| Step | Content | Web impact |
|---|---|---|
| **1** | Platform contract, `HostApi.platform`, `getPlatform()`, `#platform` alias, web implementations; ESP serial connectors, APC Mini driver and Art-Net connector use the contract (Art-Net gains a direct-UDP path, falls back to the bridge) | none (same behaviour) |
| **2** | Tauri 2 shell (`src-tauri/`, Nuxt as SPA via `bun run generate`), native `udp` via `io-artnet` | none |
| **3** | Native `serial` (`serialport`) and `midi` (`midir`) in Tauri | none |
| **4** | Native `touch` (D6) | none |
| **5** | Native engine + native output sinks (D7, own ADR) | none |

Open points for step 2:

- **Nitro server routes** (`server/api/fixtures`, `server/api/firmware-proxy.ts`) do not exist in a static SPA. They need a client-side replacement (bundled OFL index, direct fetch) or Tauri commands.
- COOP/COEP headers if `SharedArrayBuffer` is needed; WebGL/OffscreenCanvas behaviour in WKWebView.
- Supabase auth redirects (`/auth/confirm`) inside the app window (deep link or loopback).
- The AI backend as remote service or sidecar.
- macOS *Input Monitoring* permission for exclusive HID access (step 4).

## 5. Status

- **Step 1 implemented** (2026-10-16): `packages/extension-api/src/platform.ts` (API 1.1.0), `app/platform/{web,tauri}`, `#platform` alias in `nuxt.config.ts`/`vitest.config.ts`, `HostApi.platform`. Migrated: `connector-esp/serial-base.ts`, `controller-akai-apc-mini-mk2/driver.ts`, `connector-artnet` (direct-UDP path + shared `art-dmx.ts`, also used by `tools/artnet-bridge`).
