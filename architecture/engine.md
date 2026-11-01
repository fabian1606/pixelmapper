# Engine & Render Loop

## Why Rust + WebAssembly?

All DMX calculation runs in Rust (`rs-engine-core`), compiled to WASM and executed in a Web Worker (later natively for Tauri). The ESP32 is a pure output device and no longer runs the engine (ADR 0001).

1. **Performance**: the engine walks every target, chaser and modifier sample each frame without GC pauses.
2. **Zero-copy DMX access**: `dmx_buffer` lives in WASM memory; `get_dmx_view()` returns a `Uint8Array` view into it.
3. **Code sharing**: browser and the planned Tauri app use the same crate.

Modifier *logic* is not in the engine any more: modifiers are content plugins (ADR §6) — AssemblyScript compiled to their own WASM modules and run through a `ModifierRuntime`. The engine computes phases, samples and blending; plugins only compute one value tuple per sample.

## Threads and data flow

```
main thread                                  engine worker (engine-worker.ts)
───────────                                  ────────────────────────────────
engine-store.ts                              WasmEngine (rs-engine-core)
  build packets on change ──dispatch──────►    dispatch_bin(0x14 / 0x15)
  buildModifiersBin ──modifiers-sync──────►    WorkerPluginBridge.setTable + dispatch_bin(0x16)
  plugin-store loadWasm ──plugin-load─────►    WorkerPluginBridge.load (PluginInstance per instance)
                                               setInterval(16 ms): render → canvas.draw
  onFrame(dmx, elapsed, signatures) ◄─frame─   DMX copy (+ requested signature tuples)
  → connectors, live hub, UI
  Watchdog: no frame for 1 s → respawn worker, replay packets/plugins,
            suspend non-built-in plugins (toast)
```

`EffectEngine` (`app/utils/engine/engine.ts`) owns the worker: it caches every packet, plugin module and canvas message so a respawned worker is replayed to the same state, and bumps `generation` so `FixtureCanvas` re-transfers a fresh `OffscreenCanvas`.

### Build location and handshake

The WASM packages are built by `bun run build:wasm` (`scripts/build-wasm.ts`) into `rs-engine/core/pkg` and `rs-engine/canvas/pkg` and imported as `rs-engine-core` / `rs-engine-canvas` through an alias (`scripts/engine-packages.ts`, used by `nuxt.config.ts` and `vitest.config.ts`). They are **not** in `node_modules` and not in `package.json`: `bun install` deleted the builds there (black output after every install), and bare resolution in a worktree nested in the main checkout (`.claude/worktrees/*`) fell back to the parent's stale build. `dev`, `dev:nuxt` (and so `dev:tauri`), `build` and `generate` run `ensure:wasm` (`--if-stale`: rebuild when the output is missing or older than the crate sources). The Vite plugin `scripts/vite-project-guard.ts` refuses any module loaded from a `node_modules` outside the checkout.

On start the worker checks the loaded modules (`app/utils/engine/engine-abi.ts`): `engine_abi_version()` must equal the host's `ENGINE_ABI_VERSION` (Rust: `rs-engine/core/src/lib.rs`; bump both on incompatible changes to the bindings or packet formats) and all `WasmEngine`/`WasmCanvas` methods the host calls must exist. Failures are posted as `engine-error` (`EngineFailure`: `load`, `abi` fatal; `render`, `dispatch` (packet returned -1) non-fatal, each reported once); a worker that fails to load at all surfaces through `worker.onerror`. `EffectEngine.failure` holds the fatal cause, the store shows a toast (`initEngine`), and live observations return `engine-unavailable` instead of measuring the all-zero buffer.

## rs-engine-core

| Module | Role |
|--------|------|
| `engine.rs` | `EffectEngine`: targets, heads, instances, `render`, blending, signature readback |
| `bin_protocol.rs` | Payload parsers for 0x14 / 0x15 / 0x16 (see [binary-protocol.md](binary-protocol.md)) |
| `signatures.rs` | `Signature` (scalar / rgb / panTilt), color-system read/write (RGB, RGBW, RGBA, CMY), 16-bit pairs, range remap |
| `phase.rs` | Speed phase (time / beat / infinite) and phase speed |
| `distribution.rs` | Per-sample `spatial`, `rank`, `distGroup` of an instance's distribution (ADR A20); mirrored in `app/utils/engine/distribution/sample.ts`, parity-tested on `distribution_table.json` |
| `beat_clock.rs` | Piecewise BPM integral (`set_bpm_at`) so beat time is continuous across tempo changes; `align_to` (tap alignment) slides the grid onto a tap by running ±(error/4) faster for `NUDGE_BEATS` = 4 beats — no phase jump, presets keep running |
| `speed_layer.rs` | Global speed multiplier on top of the base beat: effective beat `E` and speed time `T`; changes switch on the next common beat (see *Tempo layers*) |
| `runtime.rs` | `ModifierRuntime` trait, `FrameCtx` / `Sample` (16 f32 each), `NullRuntime` |
| `runtime_js.rs` + `js/plugin-bridge.js` | Browser runtime: calls `globalThis.__pmPluginBridge` (the worker's `WorkerPluginBridge`) |
| `wasm_bindings.rs` | `WasmEngine` for the worker |

### Render pipeline (`EffectEngine::render`)

1. **Base values** — every target's chaser value (0–255) into `base_buffer` and `render_buffer`.
2. **Modifiers, in list order** — for each enabled instance:
   1. *Collect samples* by signature: `scalar` → one sample per targeted channel (filtered by channel types and fixture mask); `rgb` → one per head with a color system; `panTilt` → one per head with pan + tilt.
   2. *Fill `FrameCtx`*: time, beat time, BPM, phase speed, arity, instance seed, strength, and (v1.1) `timePhase`, `rankCount`, `distGroupCount`, (v1.2) `spread` and the handle.
   3. *Fill samples*:
      - world x/y;
      - the distribution values (`spatial`, `rank`, `distGroup`, see below) and the legacy `phase = timePhase − spatial`;
      - rank among targeted fixtures, head index/count;
      - a stable 24-bit seed of (fixture id hash, head, instance);
      - the current working values (`base0..2`, normalized) and the channel-type seed.
   4. *Run the plugin* via `ModifierRuntime::render` (one call per instance per frame, all samples at once). A runtime error disables the instance until its plugin or params change (`retry_disabled` after plugin loads).
   5. *Blend* into `render_buffer` (ADR amendment A13):
      - `bipolar`: `v = base + strength × (out − 1) / 2` (out = 1 lands on the base, −1 on base − strength); `add` applies `prev + (v − base)`, other modes combine `prev` and `v`.
      - `scale` (A20): `factor = 1 − strength + strength × out`, `mapped = base × factor`; `add` applies `prev + (mapped − base)`, `multiply` `prev × factor`, others combine `prev` and `mapped`.
      - `absolute`: `mixed = blendOp(prev, out)`, then `prev + (mixed − prev) × strength`.
      - rgb heads write through their color system (RGBW white = min(r, g, b), CMY inverted); pan/tilt write 16-bit pairs when a fine channel exists.
3. **Intensity** — `render_buffer` values multiplied by the master / group dimmer factors (`set_intensity`, packet 0x17; unlisted channels stay at full). Programmed values and modifier state are untouched; signature readback sees the dimmed values.
4. **DMX** — `render_buffer` remapped to each channel's `[rangeMin, rangeMax]` into `dmx_buffer`.

### Signature readback (live values)

`read_signatures(requests)` returns the normalized tuple of each requested `(group index, signature)` after the last render — 3 f32 per request, NaN when the fixture lacks the channels. `scalar` reads the DIMMER channel (else the first channel), `rgb`/`panTilt` the first matching head. The worker attaches the tuples to frame messages only while extensions subscribe to `signature` live targets (see [extensions.md](extensions.md)).

`read_head_signatures(requests)` is the per-head variant used by observation previews ([observability.md](observability.md)): flat `(group index, head index, signature id, channel type id or 255)` quads, 3 f32 each (NaN = unavailable); scalar reads the head's channel of the given type (255 = DIMMER, else the head's first channel).

### WASM bindings (`WasmEngine`)

```rust
pub fn dispatch(&mut self, packet_type: u8, data: &[u8]) -> i32   // count or -1
pub fn render(&mut self, time_ms: f32, delta_time_ms: f32)
pub fn set_bpm_at(&mut self, bpm: f32, at_ms: f32)                 // base tempo change on the beat clock
pub fn align_beat(&mut self, tap_ms: f32, now_ms: f32)             // tap alignment: nudge the base beat grid onto a tap
pub fn request_speed(&mut self, speed: f32, now_ms: f32)           // speed multiplier, switches on the next common beat
pub fn beat_time(&self, time_ms: f32) -> f32                        // effective beat E (sent with every frame)
pub fn base_beat_time(&self, time_ms: f32) -> f32                   // base beat B (the music)
pub fn speed_time(&self, time_ms: f32) -> f32                       // speed time T (ms × multiplier)
pub fn speed(&self) -> f32                                          // active multiplier
pub fn reset_clock(&mut self, bpm: f32)                            // new clock epoch
pub fn retry_disabled(&mut self)                                   // after plugin loads
pub fn read_signatures(&self, requests: &[u32]) -> Vec<f32>
pub fn read_head_signatures(&self, requests: &[u32]) -> Vec<f32>
pub fn get_dmx_view(&self) -> js_sys::Uint8Array                   // zero-copy
pub fn engine_abi_version() -> u32                                  // free function: host handshake
```

## Tempo layers

Three layers produce the clock of every frame (ABI 3):

```
t (ms since epoch, wall)
 └─ Layer 1  BaseClock (beat_clock.rs)   B(t): base BPM segments + tap nudges = the music
     └─ Layer 2  SpeedLayer (speed_layer.rs), multiplier m switched at base beats b0
           E(B) = e0 + m·(B − b0) + nudge   effective beat  → beat-mode phase, plugin BEAT_TIME, BPM = base·m
           T(t) = t0 + m·(t − ts)           speed time (ms) → time-mode phase, chasers
```

- **Base tempo** (`set_bpm_at`) and **tap alignment** (`align_beat`) only touch layer 1. The tap nudge runs the base clock ±(error/4) for 4 beats until the tap sits on a whole beat. The clock epoch is never re-anchored, so presets never restart.
- **Speed** (`request_speed`) is quantized: it switches at the next *common* beat, a whole base beat where `E` is whole as well. ×1→×2 switches on the next base beat; ×1→×½ switches within 2 beats. `E` and `T` stay continuous, and the new grid is phase-locked to the music. Without a common beat (unfreeze, continuous fader values such as ×1.37), the switch happens at the next base beat. A 4-beat nudge then slides `E` onto a whole beat when the new speed can lock (×n, ×1/n). A newer request replaces a pending one.
- Plugins still get wall time as `TIME_MS`, because trigger edges are stamped with it. Only the speed phase uses `T`. For time-mode instances, `PHASE_SPEED` is scaled by `m`.
- The worker sends `{ beatTime, baseBeat, speedTimeMs, speed }` with every frame. `EffectEngine.clockAt()` on the main thread extrapolates from it.
  - Beat indicators (`useBeatPulse`), BPM displays, the live hub `beat` and the project scope use **B** / base BPM.
  - Previews (`sampleClock`) use `E` / `T`.
- The store sends base BPM (`postBpm`) and multiplier (`postSpeed`) separately. Snapshots store the base BPM.

## Plugin runtime

Plugins are content-addressed packages (`sha256:` over manifest ‖ wasm ‖ ui). The worker loads modules by hash (`plugin-load`); the modifiers packet references plugins by index into a per-packet plugin table sent alongside (`modifiers-sync`). `WorkerPluginBridge` keeps one `PluginInstance` (from `@pixelmapper/plugin-toolchain/runtime`) per modifier instance, calls `pm_prepare(params)` when params change and `pm_render(ctx, samples, count, out)` each frame.

Safety (ADR §6.7): modules may only import `env.memory`, `env.abort`, `pm.budget`, `pm.log`; the toolchain instruments every loop and call with a budget counter (`pm.budget`), so an infinite loop traps instead of hanging; memory is capped at 256 pages. Traps, aborts and budget overruns post `plugin-error` to the main thread (toast) and disable that instance only. A worker that stops producing frames altogether is killed by the watchdog (above).

## ABI v1 … v1.3

Exports: `pm_abi_version() → 103` (v1.3; major × 100 + minor — the host loads only this version), `pm_alloc(bytes) → ptr`, `pm_prepare(paramsPtr, count)`, `pm_render(ctxPtr, samplesPtr, count, outPtr)`.

| `FrameCtx` (f32 index) | | `Sample` (f32 index) | |
|---|---|---|---|
| 0 | timeMs (shared clock) | 0, 1 | x, y (normalized world) |
| 1 | beatTime | 2 | phase (cycles; legacy = timePhase − spatial) |
| 2 | bpm | 3, 4 | groupIndex, groupCount (targeted fixtures) |
| 3 | phaseSpeed (cycles/s) | 5, 6 | headIndex, headCount |
| 4 | arity (1 / 3 / 2) | 7 | seed (24-bit) |
| 5, 6 | seedLo, seedHi (instance) | 8–10 | base0..2 (working values before this modifier) |
| 7 | strength (informational) | 11, 12 | channelSeedLo/Hi (scalar) |
| 8 | timePhase (v1.1) | 13 | spatial (v1.1) |
| 9 | rankCount (v1.1) | 14 | rank (v1.1, −1 = none) |
| 10 | distGroupCount (v1.1) | 15 | distGroup (v1.1, −1 = none) |
| 11 | spread (v1.2: 0 same, 1 spatial 2D, 2 fixture by fixture, 3 within) | | |
| 12–15 | Spatial 2D handle origin x/y, end x/y (v1.2, normalized world) | | |
| 16 | worldAspect (v1.3: room width / depth) | 16 | z (v1.3: height, world units) |
| 17 | worldDepth (v1.3: room depth, world units) | 17, 18 | u, v (v1.3: 0–1 across the room) |
| 18 | metersPerUnit (v1.3) | | |
| 19 | reserved (0) | 19 | reserved (0) |

v1.1 and v1.2 were additive; v1.3 grew both buffers from 16 to 20 slots (breaking: plugins must be rebuilt). The *room* is the bounding box of all layout channel positions (`rs-engine/core/src/room.rs`, layout packet v3 carries `z` and `metersPerUnit`). Output: `count × arity` f32. Params: the manifest's params encoded in order (`PARAM_WIRE_SLOTS`: number/int/bool/enum/angle 1 slot, point 2, color 3, curve 128-entry LUT over its domain, gradient 33, steps 18, trigger 4 — `pressed, pressedAt, releasedAt, clicks` with engine-clock timestamps that the host stamps on press/release; curve shapes with "auto" args resolve against the instance's rank count). Authoring details: [guides/authoring-content-plugins.md](guides/authoring-content-plugins.md).

## Main-thread previews

`app/utils/plugins/preview-pool.ts` runs the same plugins on the main thread:
- the endless strip (`renderStrip`: 256 virtual pixels with continuous `spatial`), recipe thumbnails and the Add-menu thumbnails;
- noise history traces (`renderTraces`);
- the version-history effect preview (`renderPoints`: one sample per fixture / pixel at its layout position with fixture rank and head index, distribution per point as in the engine; `PreviewOptions.instanceKey` gives the preview its own pool slot so it never shares state with the modifier card's instance — release it with `releasePreview(key)`; seeds come from the point index, not the engine's fixture hash);
- the canvas field overlay while dragging the distribution handle (`renderField`). It mirrors the engine's phase/seed computation and host mapping; a trapping plugin is marked broken there, the worker remains authoritative.

## engine-store.ts — packets and dispatch

The store builds binary packets when the model changes and dispatches only changed ones (revision counters):

| Watcher | Rebuilds |
|---------|----------|
| fixtures (deep) | layout (0x14) + channels (0x15) |
| global bases | channels |
| `modifiers` (deep) | modifiers (0x16) + plugin table; ensures the referenced plugins are loaded into the worker |

A light rAF loop forwards changed packets to the worker (`subarray(5)` strips the framing header); `flushEngineOutput()` forces an immediate rebuild + dispatch during drags. The layout build is skipped while a fingerprint of the layout-relevant fixture fields is unchanged; the fingerprint starts as `null` (not built yet), so an empty project still gets its first, valid layout packet (`metersPerUnit`, count 0 — the engine accepts it with 0 fixtures). The packet caches start as valid empty packets, never as 0-byte payloads: the engine rejects truncated payloads (`dispatch` returns -1), and the worker reports a 0-byte payload as "empty packet (never built)" rather than a format mismatch. Frames come back via `engine.onFrame` and fan out to connectors (`sendFrame`), the live hub and UI.

## Modifier instances (TS model)

`ModifierInstance` (`app/utils/engine/types.ts`, ADR §6.3/A20): `id`, `plugin` (hash), `signature`, `targetChannels`, `targetFixtureIds?`, `blendMode`, `strength` (0–1), `speed`, `distribution`, `params`. Instances are plain JSON (cloned with `cloneModifier`); `createModifier(hash)` fills manifest defaults (params and `distribution.default`). On add, the recipe matching the selection is applied and placed on it (`use-chaser-modifiers.ts`, `recipes.ts`). Cards (`modifier-card/ModifierCard.vue`) render recipes, `ParamForm` v2 (composite editors, tiers, `when`), the tempo row, the shared `DistributionSection` and "More" (blend mode).

### Distribution

`Distribution` (`@pixelmapper/extension-api`): `scope` (across / within), `mode`, the gradient handle `origin`/`end`, `reverse`, `order` (explicit `ranks`, drawn `line`, `mirror`, `snap`), `grouping`, `withinOffset`. The UI shows one "Spread" dropdown (All the same · Spatial 2D · Fixture by fixture · Within each fixture); the handle is edited on the canvas, the order with one Reassign session (click fixtures or draw a line). Params with a canvas hint (`ui.canvas`: `point` / `radius`) get their own handles next to it, independent of the mode (`app/components/engine/canvas-hints/`).

| Mode | `spatial` per sample |
|------|----------------------|
| `none` | 0 |
| `linear` | projection of (p − origin) on (end − origin) ÷ length² (0 at origin, 1 at end) |
| `radial` | distance from origin ÷ handle length |
| `conical` | angle around origin relative to the handle, in turns |
| `order` | rank / rankCount (ranks resolved in TS by `resolveRanks`: explicit clicks, projection on the drawn line with a tolerance for roughly aligned fixtures, or the selection's main axis; `mirror` ranks by distance from the line start) |
| scope `within` | head / headCount (offset by the fixture's rank with `withinOffset: 'order'`) |

Grouping (recipes only) maps ranks to groups (`spatial = group / n`); `reverse` applies `1 − spatial` last. Order and within never depend on the handle.

### SpeedConfig

```ts
{ mode: 'time' | 'beat' | 'infinite'; timeMs: number; beatValue: number; beatOffset: number }
```

`time`: phase = timeMs / speed.timeMs. `beat`: phase = (beatTime + beatOffset) / beatValue. `infinite`: phase 0 (frozen).
