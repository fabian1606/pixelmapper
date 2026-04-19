# Core Concepts: Fixtures, Channels, Beams

This document explains the foundational data models that represent physical lights within Pixelmapper.

## FixtureGroup

A `FixtureGroup` is a logical container that can hold `Fixture`s or other `FixtureGroup`s, forming a hierarchy (similar to Figma layers).

- **`id`** — Unique identifier.
- **`name`** — Display name (e.g., "Front Wash").
- **`children: SceneNode[]`** — Nested nodes within this group.
- **`parent: FixtureGroup | null`** — Reference to the parent group, if any.
- **`getAllFixtures()`** — Recursively extracts all descendant fixtures.

The primary node array `sceneNodes` is a `shallowRef` in Pinia. This deliberately prevents Vue from building deep reactive proxy graphs over the entire scene. Adding or removing nodes replaces the array reference or calls `triggerRef(sceneNodes)`.

## Fixture

A `Fixture` represents a physical light device. Fixtures are stored inside a `shallowRef` and act as plain JavaScript objects — not Vue reactive proxies. This Data-Oriented Design (DoD) choice prevents Vue from tracking thousands of nested properties at 60 fps.

- **`id: number`** — Numeric identifier. Used as `group_index` in the binary layout packet.
- **`name`** — Display name.
- **`startAddress: number`** — 1-based DMX universe address for this fixture's footprint.
- **`channels: Channel[]`** — The DMX channels this fixture exposes.
- **`fixturePosition: { x, y }`** — World-space position, normalized 0–1.
- **`fixtureSize: { x, y }`** — Size multiplier for beam offset calculations.
- **`rotation: number`** — Rotation in degrees, applied to beam local offsets.
- **`beams: Beam[]`** — One or more output points of light (see below).
- **`resolveColor(dmxBuffer): string`** — Computes the fixture's current visual color from its channels, reading values directly from the DMX buffer.

## Channel

Each channel is structural metadata — an offset pointer into the DMX universe. It does not store live `value` state; that lives in the engine's `dmx_buffer` and `base_buffer` typed arrays.

- **`type: ChannelType`** — e.g. `RED`, `GREEN`, `BLUE`, `DIMMER`, `PAN`, `TILT`, `FOG`, etc.
- **`addressOffset: number`** — 0-based offset within the fixture's DMX footprint.
- **`chaserConfig: ChaserConfig`** — Defines step values, playback state, and timing.
- **`beamId`** — Optional reference to a `Beam` within the fixture (for multi-beam fixtures).
- **`role: ChannelRole`** — How this channel participates in color rendering:
  - `COLOR` — Contributes additively to the fixture's visual color. Requires `colorValue` (hex).
  - `DIMMER` — Scales all COLOR channels (0 = off, 255 = full brightness).
  - `NONE` — No visual contribution (PAN, TILT, FOG, etc.).

## Beam

A `Beam` lives inside a `Fixture` and represents a single output point of light.

- **`id`** — Identifier within the fixture. For matrix/custom SVG fixtures this equals the OFL pixel key (e.g. `head-1`, `head-2`, …).
- **`localX`, `localY`** — Offset relative to the fixture's world position, in local fixture space (range roughly −0.5 … +0.5).

### Beam position sources

| Fixture type | localX / localY source |
|---|---|
| Standard matrix | Uniform grid: `(x / (n−1) − 0.5) × spreadFactor` |
| Custom SVG (with `headPositions`) | SVG element centroid: `(pos.x − 0.5) × 0.95` |
| Custom SVG (legacy, no `headPositions`) | Uniform grid fallback |

For custom SVG fixtures the true element centroid is computed once at save-time (see `computeHeadElementCentroids` in `app/utils/engine/svg-element-positions.ts`) and stored in `pixelmapper.customSvg.headPositions`. This ensures modifier fanning spreads phase correctly even for non-linear arrangements (circles, fans, etc.).

When `buildLayoutBin` computes `world_x/world_y` for each channel, it applies the fixture's rotation to the beam's local offset:

```typescript
const rotRad = fixture.rotation * (Math.PI / 180)
const fWidth  = fixture.fixtureSize.x * FIXTURE_RADIUS * 2
const fHeight = fixture.fixtureSize.y * FIXTURE_RADIUS * 2
const localPx = beam.localX * fWidth
const localPy = beam.localY * fHeight
const rotPx = localPx * cos(rotRad) - localPy * sin(rotRad)
const rotPy = localPx * sin(rotRad) + localPy * cos(rotRad)
worldX = fixture.fixturePosition.x + rotPx / WORLD_WIDTH
worldY = fixture.fixturePosition.y + rotPy / WORLD_HEIGHT
```

This transform is encoded once into the layout packet so both the WASM engine and the ESP32 see the same spatial coordinates without recomputing.

## ChaserConfig

Defines how a DMX channel's value steps over time:

```typescript
interface ChaserConfig {
    stepValues:     number[]    // DMX values (0–255) per step
    stepsCount:     number
    activeEditStep: number      // which step is shown in the UI
    isPlaying:      boolean     // whether the chaser is running
    stepDuration:   SpeedConfig // how long each step lasts
    fadeDuration:   SpeedConfig // crossfade time between steps
}
```

A chaser with `stepsCount=1` and `isPlaying=false` is simply a static value — the common case for faders. The Rust engine handles both cases in the same code path.

## RenderTarget

The engine's internal per-channel view, built from the layout packet:

```rust
pub struct RenderTarget {
    pub dmx_index:     usize,
    pub channel_type:  String,
    pub group_index:   usize,   // = fixture.id
    pub world_x:       f32,
    pub world_y:       f32,
    pub chaser_config: Option<ChaserConfig>,
}
```

`targets` is populated by `sync_layout` and updated by `sync_channels`. Effects use `group_index`, `channel_type`, `world_x`, `world_y` to decide whether and how to modulate each channel.
