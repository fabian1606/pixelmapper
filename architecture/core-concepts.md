# Core Concepts

This document explains the foundational structural data models that represent the real-world physical lights and groupings within Pixelmapper.

## FixtureGroup
A `FixtureGroup` is a logical container that can hold `Fixture`s or other `FixtureGroup`s, forming a hierarchy (similar to Figma layers).
- **`id`** — Unique identifier.
- **`name`** — Display name (e.g., "New Group").
- **`children: SceneNode[]`** — The nested nodes within this group.
- **`parent: FixtureGroup | null`** — Reference to the parent group, if any.
- **`getAllFixtures()`** — Recursively extracts all child fixtures for rendering limitelessly nested groups.

*Note: The primary node array `sceneNodes` is tracked as a `shallowRef` to prevent Vue from doing deep reactivity loops over the graph for performance.*

## Fixture
A `Fixture` is the top-level entity representing a physical light device. It is instantiated and wrapped in `markRaw()` to optimize engine performance.
- **`id`** — Unique identifier.
- **`name`** — Display name.
- **`startAddress: number`** — 1-based universe address for this fixture's DMX footprint. (Used to write into the global `dmxBuffer`).
- **`parent: FixtureGroup | null`** — Reference to the parent group, if any.
- **`channels: Channel[]`** — The DMX channels this fixture exposes.
- **`fixturePosition: { x, y }`** — World-space position in normalized 0–1 space (used by the Fixture Editor and spatial effects).
- **`beams: Beam[]`** — One or more beams. For a simple RGB LED, this is one Beam at `{localX: 0, localY: 0}`. Complex fixtures (moving heads, LED bars) can define multiple beams, each with a local offset from the fixture's world position.
- **`resolveColor(dmxBuffer): string`** — Computes the fixture's current visual color from its channel states and blending rules, reading values directly from the typed array buffer.

## Channel
Each channel is purely structural metadata (an offset pointer) used by the engine. It does **not** store live `value` or `currentBaseValue` state, as those are handled by high-speed typed arrays in the Engine.
- **`type: ChannelType`** — e.g. `RED`, `GREEN`, `BLUE`, `DIMMER`, `PAN`, `TILT`.
- **`addressOffset: number`** — 0-based integer representing the slot inside the fixture's footprint.
- **`chaserConfig: ChannelChaserConfig`** — Defines `stepValues`, playback state, and timing data.
- **`role: ChannelRole`** — How this channel participates in color computation:
  - `COLOR` — Contributes a color addtively. Must provide `colorValue` (hex string).
  - `DIMMER` — Scales all `COLOR` channels globally (0 = off, 255 = full).
  - `NONE` — No visual contribution (e.g. PAN, TILT).
- **`colorValue: string`** — The peak hue of this channel (e.g. `#FF0000` for RED). Only used when `role === 'COLOR'`.


## Beam
A `Beam` lives inside a `Fixture` and represents a single output point of light.
- **`id`** — Beam identifier within the fixture.
- **`localX`, `localY`** — Offset relative to the fixture's world position. Defaults to `0, 0`.
- Future extension: `rotation`, `zAngle`, `spread` for moving heads.
