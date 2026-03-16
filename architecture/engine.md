# Engine & Render Loop

## Why Rust + WebAssembly?

All DMX calculation logic runs in Rust — compiled to either WASM (browser) or a native static library (ESP32). The reasons:

1. **Performance**: The engine iterates over all targets, chasers, and effects every frame. In Rust/WASM this runs without GC pauses or JS engine overhead.
2. **Zero-copy DMX access**: The `dmx_buffer: [u8; 512]` lives directly in WASM memory. The browser reads it via `js_sys::Uint8Array::view()` without copying — a direct pointer into the WASM heap.
3. **Code sharing**: Browser and ESP32 use the same Rust crate (`rs-engine-core`). Same logic, identical output — no porting effort, no divergence.

## rs-engine-core

The platform-agnostic crate. No `std::io`, no `std::net`, no web APIs.

### EffectEngine (`engine.rs`)

```rust
pub struct EffectEngine {
    pub dmx_buffer:  [u8; 512],   // Final DMX values (1 universe)
    pub base_buffer: [f32; 512],  // Float base values before effect overlay
    pub global_bpm:  f32,
    pub targets:     Vec<RenderTarget>,
    pub effects:     Vec<Box<dyn Effect>>,
}
```

**`render(time_ms, delta_time_ms)`** runs once per frame:

1. **Update** — calls `effect.update(delta_ms, bpm)` on all effects (accumulate phase)
2. **Base/Chaser** — for each target: compute interpolated chaser value → write to `base_buffer[dmx_index]`
3. **Effects** — for each target × effect: render wave shape `[-1, 1]`, map to DMX range, additively blend onto `dmx_buffer`
4. **Clamp** — final values stay within `[0, 255]`

**`dispatch_bin(packet_type, data)`** is the sole entry point for configuration data:

```rust
pub fn dispatch_bin(&mut self, packet_type: u8, data: &[u8]) -> i32 {
    match packet_type {
        0x10 => { /* BPM: f32 LE */ }
        0x14 => parse_layout_bin(self, data),   // fixture positions
        0x15 => parse_channels_bin(self, data), // chaser configs
        0x16 => parse_effects_bin(self, data),  // effect parameters
        _    => -1,
    }
}
```

Returns the count of parsed items, or `-1` on error.

### WASM Bindings (`wasm_bindings.rs`)

```rust
#[wasm_bindgen]
impl WasmEngine {
    pub fn dispatch(&mut self, packet_type: u8, data: &[u8]) -> i32
    pub fn render(&mut self, time_ms: f32, delta_time_ms: f32)
    pub fn set_bpm(&mut self, bpm: f32)
    pub fn get_dmx_view(&self) -> js_sys::Uint8Array  // zero-copy pointer
}
```

`get_dmx_view()` returns a direct `Uint8Array` view into `dmx_buffer` — no memcopy, no allocation. Valid as long as no `dispatch` call causes WASM memory to grow (re-fetch afterwards, as done in `engine.ts`).

### FFI Layer (`rs-engine-ffi`)

Thin `extern "C"` wrappers over `dispatch_bin` for ESP32/PlatformIO:

```c
// engine_ffi.h
EffectEngine*  engine_new();
void           engine_free(EffectEngine* ptr);
int32_t        engine_dispatch(EffectEngine* ptr, uint8_t packet_type,
                               const uint8_t* data, uint32_t len);
void           engine_render(EffectEngine* ptr, float time_ms, float delta_ms);
const uint8_t* engine_get_dmx_buffer(EffectEngine* ptr);
```

## engine-store.ts — The Render Loop

The Pinia store holds the entire application state and drives the 60 fps loop.

### Packet Cache & Revision Tracking

Instead of passing fixtures directly to the engine, the store builds binary packets and caches them:

```typescript
let layoutPacket:   Uint8Array  // fixture positions + channel metadata
let channelsPacket: Uint8Array  // chaser configurations
let effectsPacket:  Uint8Array  // effect parameters

const layoutRevision   = ref(0)
const channelsRevision = ref(0)
const effectsRevision  = ref(0)
```

Vue watchers rebuild packets on change:

| Watcher | Triggers when | Rebuilds |
|---------|---------------|----------|
| `watch(flatFixtures, { deep: true })` | Fixture moved, channel added | layout + channels |
| `watch(globalBases, { deep: true })` | Global base values (Dimmer, RGB) changed | channels |
| `watch(activeEffects, { deep: true })` | Effect added or modified | effects |

### Render Loop

```typescript
const renderLoop = (time: number) => {
    const lr = layoutRevision.value
    const cr = channelsRevision.value
    const er = effectsRevision.value

    // Only dispatch if something changed AND WASM is ready (returns >= 0)
    if (lr !== lastDispatchedLayout
        && engine.dispatch(TYPE_LAYOUT_BIN, layoutPacket.subarray(5)) >= 0)
        lastDispatchedLayout = lr

    if (cr !== lastDispatchedChannels
        && engine.dispatch(TYPE_CHAN_BIN, channelsPacket.subarray(5)) >= 0)
        lastDispatchedChannels = cr

    if (er !== lastDispatchedEffects
        && engine.dispatch(TYPE_FX_BIN, effectsPacket.subarray(5)) >= 0)
        lastDispatchedEffects = er

    engine.render(elapsed, delta)
    connectionsStore.sendFrame(engine.dmxBuffer)
    connectionsStore.notifyEngineState({ ..., layoutPacket, channelsPacket, effectsPacket })

    animFrameId = requestAnimationFrame(renderLoop)
}
```

**Note**: `subarray(5)` skips the 5-byte framing header `[0xAA][0x55][type][len_lo][len_hi]`. The WASM `dispatch_bin` expects only the raw payload — the header is for the ESP32 state-machine parser.

**Note**: WASM initializes asynchronously. While `wasmEngine` is still null, `dispatch()` returns `-1`. The loop only updates `lastDispatched*` on success (`>= 0`), so the packet is automatically retried next frame.

## Effects

All effects implement the `Effect` trait:

```rust
pub trait Effect {
    fn update(&mut self, delta_ms: f32, bpm: f32);
    fn render(&self, world_x: f32, world_y: f32) -> f32;  // returns [-1, 1]
    fn get_config(&self) -> &EffectConfig;
}
```

### EffectConfig

```rust
pub struct EffectConfig {
    pub target_channels:      Vec<String>,          // empty = all channel types
    pub target_group_indices: Option<Vec<usize>>,   // None = all fixtures
    pub direction:            EffectDirection,
    pub origin_x:             f32,
    pub origin_y:             f32,
    pub angle:                f32,
    pub strength:             f32,     // amplitude in DMX units
    pub reverse:              bool,
    pub fanning:              f32,     // per-fixture phase offset multiplier
    pub speed:                SpeedConfig,
    pub effect_type:          String,
}
```

### Direction Modes

| Mode | Behavior |
|------|----------|
| `None` | All fixtures share the same phase |
| `Linear` | Phase offset distributed linearly via fanning |
| `Radial` | Phase offset = distance from origin point |
| `Symmetrical` | Like Linear but mirrored |

### SpeedConfig

Speed can be specified as absolute time (ms) or BPM-relative:

```rust
pub enum SpeedMode { Time, Beat, Infinite }

pub struct SpeedConfig {
    pub mode:        SpeedMode,
    pub time_ms:     f32,
    pub beat_value:  f32,   // e.g. 1.0 = 1 beat, 0.5 = half beat
    pub beat_offset: f32,   // phase offset in beats
}
```
