# OFL Implementation Specification

This document describes how the `ofl-data` (Open Fixture Library) is parsed and integrated into the `pixelmapper` engine.

## 1. Fixture Creation

The primary entry point is `createFixtureFromOfl` in `app/utils/ofl/fixture-factory.ts`. It transforms an OFL JSON definition into a `Fixture` instance.

### Physical Scaling
- **Baseline**: Physical dimensions are normalized where **150mm = 1.0 unit** in the engine coordinate system (doubled from original 300mm).
- **Fixture Size**: `fixture.fixtureSize` is calculated from `physical.dimensions` (Width and Depth, mapping to X and Y on the canvas).

### Channel Ordering
- **DMX Sequence**: Multi-head fixture channels are sorted by their original DMX index (`minDmxIndex`) rather than logical grouping. This ensures columns like "R1, G1, B1, R2, G2, B2..." are displayed correctly in the UI.

## 2. Matrix & Beams

The engine supports multi-head fixtures and LED matrices.

### Beam Generation
- Beams are generated based on the `matrix` definition in the OFL file.
- **Positioning Formula**: Beams are distributed with a **0.5 beam-spacing margin** from the fixture edges. The engine uses: `localX = (x / Math.max(1, xCount - 1)) * (1 - 1/xCount) - 0.5 * (1 - 1/xCount)` to ensure outer pixels align with the physical footprint bounds.
- **Spatial Order**: Beams are always instantiated in **Z → Y → X** order to maintain a consistent spatial mapping regardless of channel order.
- **Normalization**: Beam positions (`localX`, `localY`) are normalized from `-0.5` to `+0.5` relative to the fixture center.

### Beam Identification
- Each beam is assigned a unique `id` (usually the `pixelKey` from OFL, e.g., `"1"`, `"(1, 1)"`).
- Channels are linked to these beams via the `beamId` property.

## 3. Channel Resolution & Expansion

OFL modes can define channels as simple strings, spacers (`null`), or `matrixChannels` inserts.

### Standard Channels
Directly resolved from `availableChannels`.

### Matrix Expansion (`matrixChannels`)
The engine implements the OFL `repeatFor` logic to expand template channels:
- **`eachPixelABC`**: Pixel keys are sorted alphanumerically before expansion.
- **Axis-ordered (`eachPixelXYZ`, etc.)**: Pixel keys are iterated following the specified axis priority.
- **`eachPixelGroup`**: Iterates over defined `pixelGroups`. 
- **Explicit list**: A string array provided in `repeatFor` is used directly as the sequence of pixel/group keys.

### Template Instance Resolution
If a channel key (e.g., `"Red Master"`) is not found in `availableChannels`, the engine attempts to match it against `templateChannels` (e.g., `"Red $pixelKey"`).
- **Group Detection**: If a `$pixelKey` matches a defined `pixelGroup` name (like `"Master"` or `"all"`), the `beamId` is set to **undefined**. This ensures the channel applies globally to **all** beams in the fixture.
- **Capability Mapping**: The engine uses the template definition for capability mapping to ensure correct color and role assignment.

## 4. Visual Rendering & Effects

### Canvas Alignment
The `FixtureCanvas.vue` uses `FIXTURE_RADIUS = 18` and `WORLD_WIDTH/HEIGHT = 3000` to align with the CSS layout. Individual pixels are rendered as dots positioned according to the beam's `localX/Y`.

### Per-Beam Effects
The `EffectEngine` evaluates effects using the **absolute world position** of each individual beam:
1. Fetch beam coordinates from `fixturePosition + rotated(beam.localOffset)`.
2. Evaluate `effect.render({ x, y })` for each specific channel + `beamId` combination.
3. This allows waves and gradients to chase across pixels of a single fixture.

### Rotation Support
Fixtures support a `rotation` property (degrees). The engine applies a 2D rotation matrix to the beam's local offsets before computing their world coordinates for effects, ensuring spatial patterns correctly follow the fixture's orientation.
