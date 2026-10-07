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

## rs-engine-core

| Module | Role |
|--------|------|
| `engine.rs` | `EffectEngine`: targets, heads, instances, `render`, blending, signature readback |
| `bin_protocol.rs` | Payload parsers for 0x14 / 0x15 / 0x16 (see [binary-protocol.md](binary-protocol.md)) |
| `signatures.rs` | `Signature` (scalar / rgb / panTilt), color-system read/write (RGB, RGBW, RGBA, CMY), 16-bit pairs, range remap |
| `phase.rs` | Speed phase, spatial offset (direction modes), sample phase |
| `beat_clock.rs` | Piecewise BPM integral (`set_bpm_at`) so beat time is continuous across tempo changes |
| `runtime.rs` | `ModifierRuntime` trait, `FrameCtx` / `Sample` (16 f32 each), `NullRuntime` |
| `runtime_js.rs` + `js/plugin-bridge.js` | Browser runtime: calls `globalThis.__pmPluginBridge` (the worker's `WorkerPluginBridge`) |
| `wasm_bindings.rs` | `WasmEngine` for the worker |

### Render pipeline (`EffectEngine::render`)

1. **Base values** — every target's chaser value (0–255) into `base_buffer` and `render_buffer`.
2. **Modifiers, in list order** — for each enabled instance:
   1. *Collect samples* by signature: `scalar` → one sample per targeted channel (filtered by channel types and fixture mask); `rgb` → one per head with a color system; `panTilt` → one per head with pan + tilt.
   2. *Fill `FrameCtx`*: time, beat time, BPM, phase speed, arity, instance seed, strength.
   3. *Fill samples*: world x/y, `phase = speedPhase − spatialOffset(direction, origin, angle, fanning, reverse)`, rank among targeted fixtures, head index/count, a stable 24-bit seed of (fixture id hash, head, instance), the current working values (`base0..2`, normalized) and the channel-type seed.
   4. *Run the plugin* via `ModifierRuntime::render` (one call per instance per frame, all samples at once). A runtime error disables the instance until its plugin or params change (`retry_disabled` after plugin loads).
   5. *Blend* into `render_buffer` (ADR amendment A13):
      - `bipolar`: `v = base + strength × (out − 1) / 2` (out = 1 lands on the base, −1 on base − strength); `add` applies `prev + (v − base)`, other modes combine `prev` and `v`.
      - `absolute`: `mixed = blendOp(prev, out)`, then `prev + (mixed − prev) × strength`.
      - rgb heads write through their color system (RGBW white = min(r, g, b), CMY inverted); pan/tilt write 16-bit pairs when a fine channel exists.
3. **DMX** — `render_buffer` remapped to each channel's `[rangeMin, rangeMax]` into `dmx_buffer`.

### Signature readback (live values)

`read_signatures(requests)` returns the normalized tuple of each requested `(group index, signature)` after the last render — 3 f32 per request, NaN when the fixture lacks the channels. `scalar` reads the DIMMER channel (else the first channel), `rgb`/`panTilt` the first matching head. The worker attaches the tuples to frame messages only while extensions subscribe to `signature` live targets (see [extensions.md](extensions.md)).

### WASM bindings (`WasmEngine`)

```rust
pub fn dispatch(&mut self, packet_type: u8, data: &[u8]) -> i32   // count or -1
pub fn render(&mut self, time_ms: f32, delta_time_ms: f32)
pub fn set_bpm_at(&mut self, bpm: f32, at_ms: f32)                 // tempo change on the beat clock
pub fn reset_clock(&mut self, bpm: f32)                            // new clock epoch
pub fn retry_disabled(&mut self)                                   // after plugin loads
pub fn read_signatures(&self, requests: &[u32]) -> Vec<f32>
pub fn get_dmx_view(&self) -> js_sys::Uint8Array                   // zero-copy
```

## Plugin runtime

Plugins are content-addressed packages (`sha256:` over manifest ‖ wasm ‖ ui). The worker loads modules by hash (`plugin-load`); the modifiers packet references plugins by index into a per-packet plugin table sent alongside (`modifiers-sync`). `WorkerPluginBridge` keeps one `PluginInstance` (from `@pixelmapper/plugin-toolchain/runtime`) per modifier instance, calls `pm_prepare(params)` when params change and `pm_render(ctx, samples, count, out)` each frame.

Safety (ADR §6.7): modules may only import `env.memory`, `env.abort`, `pm.budget`, `pm.log`; the toolchain instruments every loop and call with a budget counter (`pm.budget`), so an infinite loop traps instead of hanging; memory is capped at 256 pages. Traps, aborts and budget overruns post `plugin-error` to the main thread (toast) and disable that instance only. A worker that stops producing frames altogether is killed by the watchdog (above).

## ABI v1

Exports: `pm_abi_version() → 1`, `pm_alloc(bytes) → ptr`, `pm_prepare(paramsPtr, count)`, `pm_render(ctxPtr, samplesPtr, count, outPtr)`.

| `FrameCtx` (f32 index) | | `Sample` (f32 index) | |
|---|---|---|---|
| 0 | timeMs (shared clock) | 0, 1 | x, y (normalized world) |
| 1 | beatTime | 2 | phase (cycles) |
| 2 | bpm | 3, 4 | groupIndex, groupCount (targeted fixtures) |
| 3 | phaseSpeed (cycles/s) | 5, 6 | headIndex, headCount |
| 4 | arity (1 / 3 / 2) | 7 | seed (24-bit) |
| 5, 6 | seedLo, seedHi (instance) | 8–10 | base0..2 (working values before this modifier) |
| 7 | strength (informational) | 11, 12 | channelSeedLo/Hi (scalar) |
| 8–15 | reserved | 13–15 | reserved |

Output: `count × arity` f32. Params: the manifest's params encoded in order (`PARAM_WIRE_SLOTS`: number/int/bool/enum/angle 1 slot, point 2, color 3, curve 128-entry LUT). Authoring details: [guides/authoring-content-plugins.md](guides/authoring-content-plugins.md).

## Main-thread previews

`app/utils/plugins/preview-pool.ts` runs the same plugins on the main thread for the modifier card preview (one cycle) and the canvas field overlay while dragging spatial handles. It mirrors the engine's phase/seed computation and host mapping; a trapping plugin is marked broken there, the worker remains authoritative.

## engine-store.ts — packets and dispatch

The store builds binary packets when the model changes and dispatches only changed ones (revision counters):

| Watcher | Rebuilds |
|---------|----------|
| fixtures (deep) | layout (0x14) + channels (0x15) |
| global bases | channels |
| `modifiers` (deep) | modifiers (0x16) + plugin table; ensures the referenced plugins are loaded into the worker |

A light rAF loop forwards changed packets to the worker (`subarray(5)` strips the framing header); `flushEngineOutput()` forces an immediate rebuild + dispatch during drags. Frames come back via `engine.onFrame` and fan out to connectors (`sendFrame`), the live hub and UI.

## Modifier instances (TS model)

`ModifierInstance` (`app/utils/engine/types.ts`, ADR §6.3): `id`, `plugin` (hash), `signature`, `targetChannels`, `targetFixtureIds?`, `blendMode`, `strength` (0–1), `speed`, `direction`, `originX/Y`, `angle`, `fanning`, `reverse`, `params`. Instances are plain JSON (cloned with `cloneModifier`); `createModifier(hash)` fills manifest defaults. Generic fields are edited by `ModifierGenericFields.vue`, plugin params by the schema-driven `ParamForm.vue`.

### Direction modes

| Mode | Spatial offset |
|------|----------------|
| `NONE` | 0 (all samples share the phase) |
| `LINEAR` | projection of (x − origin) on the angle, ÷ fanning |
| `RADIAL` | distance from origin ÷ fanning |
| `SYMMETRICAL` | absolute linear projection ÷ fanning |
| `ANGULAR` | angle around origin (in turns) ÷ fanning |

`reverse` negates the offset; `fanning = 0` disables it.

### SpeedConfig

```ts
{ mode: 'time' | 'beat' | 'infinite'; timeMs: number; beatValue: number; beatOffset: number }
```

`time`: phase = timeMs / speed.timeMs. `beat`: phase = (beatTime + beatOffset) / beatValue. `infinite`: phase 0 (frozen).
