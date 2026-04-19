# Pixelmapper Architecture

## Overview

Pixelmapper is a DMX lighting controller with a Vue 3/TypeScript frontend and a Rust engine that runs on two target platforms:

1. **Browser** — Rust compiled to WebAssembly (WASM), runs directly in the browser tab
2. **ESP32-P4** — Rust compiled to a static C library (`no_std`), runs natively on the microcontroller

The key design principle: **both targets use the exact same Rust engine and the same binary protocol.** The browser tab and the ESP32 receive identical byte sequences and produce identical DMX output.

## File Structure

```
pixelmapper/
├── aiBackendService/              # Express backend with LangGraph for AI tasks
│   ├── src/
│   │   ├── nodes/                 # LangGraph nodes (e.g., extractGeneralInfo)
│   │   ├── graph.ts               # LangGraph StateGraph pipeline
│   │   ├── server.ts              # Express API
│   │   └── state.ts               # Graph state schema
│   ├── index.ts                   # Entry point for backend
├── app/                           # Nuxt 4 / Vue 3 frontend
│   ├── stores/
│   │   ├── engine-store.ts        # Render loop, packet cache, revision tracking
│   │   └── connections-store.ts   # Connector registry
│   └── utils/
│       ├── engine/
│       │   └── engine.ts          # Thin WASM wrapper (EffectEngine)
│       └── connectors/
│           ├── binary-encoder.ts  # Single source of truth for all packet encoding
│           ├── base-connector.ts  # Abstract connector base class
│           └── serial-connector.ts # USB Serial → ESP32
├── rs-engine/
│   ├── core/                      # Platform-agnostic Rust engine
│   │   ├── src/
│   │   │   ├── engine.rs          # EffectEngine, render loop, DMX buffer
│   │   │   ├── bin_protocol.rs    # Binary packet parsers (layout, channels, effects)
│   │   │   ├── effects.rs         # Effect implementations (Sine, etc.)
│   │   │   ├── types.rs           # Shared data types
│   │   │   └── wasm_bindings.rs   # wasm-bindgen bindings for the browser
│   │   └── pkg/                   # Compiled WASM package (generated, do not edit)
│   └── ffi/                       # C FFI layer for ESP32
│       ├── src/lib.rs             # extern "C" functions, delegates to core
│       └── include/engine_ffi.h   # C header for PlatformIO
└── pio/
    └── src/main.cpp               # ESP32 Arduino sketch
```

Detailed documentation per subsystem:

- [Engine & Render Loop](architecture/engine.md)
- [Binary Protocol](architecture/binary-protocol.md)
- [Core Concepts: Fixtures, Channels, Beams](architecture/core-concepts.md)
- [State Management & Reactivity](architecture/state.md)
- [Connectors & Hardware](architecture/connectors.md)
- [UI & History](architecture/ui-history.md)

## Custom Fixtures (SVG Based)

To support custom, highly visual, or non-standard fixtures, the architecture provides a Custom Fixture Editor.
- **Concept:** Users define a fixture visually by importing an SVG graphic.
- **Head Mapping:** For `Custom SVG` fixtures, users can assign exactly one SVG element to each head (`head-1`, `head-2`, ...). The head count is manual in the sidebar, and assignment happens by selecting a head and clicking an SVG element in the canvas.
- **Persistence:** The uploaded SVG plus `head -> elementId` mapping is stored directly on the fixture JSON in `pixelmapper.customSvg`, then restored when editing again.
- **Architecture:** The editor is highly modular, located in `app/components/engine/custom-fixture-editor/`. It is split into specialized sub-components for header, canvas rendering modes, sidebar forms, and a detailed DMX channel/mode editor. State is centralized in the `useCustomFixtureForm` composable to ensure consistency across the wizard steps.
- **Rendering Robustness:** The editor renders custom SVGs as inline SVG nodes in the canvas (not via `foreignObject` HTML injection), improving compatibility for exported SVG files from design tools.
- **Integration:** The `CustomFixtureEditorDialog` provides a workspace where SVGs can be imported visually, parsed, and configured to generate standard `Fixture` objects (augmented with SVG definition data) before being injected into the main `FixtureWorkspace`.

### Channel Type Round-Trip

Custom fixtures store channels as OFL JSON (`availableChannels` / `templateChannels`). OFL uses a different capability vocabulary than the editor's internal `ChannelType` enum:

| Editor enum | OFL capability type | OFL color field |
|---|---|---|
| `RED` | `ColorIntensity` | `Red` |
| `GREEN` | `ColorIntensity` | `Green` |
| `DIMMER` | `Intensity` | — |
| `PAN` | `Pan` | — |
| … | … | … |

**Save path** (`buildOflFixture` in `custom-fixture-omapping.ts`): `editorTypeToOflCap()` translates editor enums → OFL types. If a channel has no user-defined sub-ranges, a default full-range capability is synthesized from `capabilityType` so the OFL JSON always carries a classifiable capability.

**Load path** (`initFromOflFixture`): `parseOflCapabilities()` calls `oflCapToEditorType()` to translate OFL types back to editor enums before storing them in `CapabilityRange.type`. This is the critical step — without it, `CapabilityRange.type` would hold OFL strings like `'ColorIntensity'`, which `editorTypeToOflCap` cannot handle, corrupting the next save.

**Idempotency:** `oflCapToEditorType` checks against `EDITOR_TYPE_SET` (all known `ChannelType` values) before translating. If the value is already an editor enum it passes through unchanged, making the function safe to call multiple times.

### SVG Workspace Overlay Rendering

Custom SVG fixtures are rendered as HTML div overlays (not on the WebGL canvas) in `FixtureCanvas.vue`. Key design decisions:

- **Positioning:** Each wrapper div uses `position: absolute` with world-coordinate `left`/`top` values. The parent container applies the camera transform (`translate + scale`) via inline style. The parent must **not** have `overflow: hidden` — SVG world coordinates routinely exceed the viewport's pixel size, and clipping at the parent's content box would hide fixtures at large world offsets.
- **Style precedence:** Many exported SVGs (Illustrator, Figma, Inkscape) carry inline `style="stroke:none"` or embedded `<style>` blocks. SVG presentation attributes (`setAttribute('stroke', …)`) lose to CSS. All stroke/fill overrides therefore use `el.style.setProperty(…, 'important')` to reliably win the cascade.
- **Init guard:** On first render (`wrapper.dataset.initDone`), a uniform `rgba(255,255,255,0.22)` stroke is applied to all shapes so they remain visible even when their fill is black. Subsequent frames only update DMX-mapped element fills.
- **DMX color application:** `applyDmxColorToSvgElement` also uses `style.setProperty('fill', …, 'important')` for the same CSS specificity reason.

### SVG-Based Head Position Calculation

For modifier fanning (sine-wave effects that spread phase across fixture heads), the engine needs accurate per-head world positions. Standard matrix fixtures use a uniform grid, but custom SVG fixtures can have arbitrarily shaped arrangements (circles, fans, irregular grids).

**Problem:** The OFL matrix always generates head positions from a uniform grid. A 12-head fixture arranged in a ring would appear as a straight row to the modifier engine, making directional fanning meaningless.

**Solution:** At save-time, `computeHeadElementCentroids()` (`app/utils/engine/svg-element-positions.ts`) uses the browser DOM to measure the true centroid of every mapped SVG element:

1. The SVG string is parsed and appended off-screen (fixed, 500×500, visibility:hidden)
2. `getBBox()` is called on each element — reliable for all shape types including `<path>`
3. Centers are normalized to [0,1] relative to the SVG's `viewBox`
4. The result is stored as `pixelmapper.customSvg.headPositions: Record<string, {x,y}>` in the OFL JSON

**Beam positioning in `fixture-factory.ts`:** When `headPositions` is present, `localX = (pos.x − 0.5) × 0.95` and `localY = (pos.y − 0.5) × 0.95`. The 0.95 factor keeps the outermost heads just inside the fixture's visual border. Without `headPositions` the classic uniform grid is used as fallback.

**`buildLayoutBin` is unchanged** — it always converts `beam.localX/localY` to `world_x/world_y` via the rotation transform, so modifier fanning automatically benefits from the corrected beam positions.

> **Note:** Existing fixtures need to be re-saved through the Custom Fixture Editor to have `headPositions` computed and stored.

## AI Backend Service (aiBackendService)

To aid in the creation of fixtures, an Express-based AI backend service powered by LangGraph uses LLMs to parse fixture manuals and automatically extract physical dimensions, features, and DMX mappings.
- **Concept:** Provide a manual text (later OCR'd PDF) to an endpoint `/extract-fixture`.
- **Pipeline:** A LangGraph pipeline directs the text through specific extraction nodes (currently just General Info), utilizing `withStructuredOutput` to enforce correct schemas.
- **Goal:** Feed the extracted data straight into the Custom Fixture Editor to dramatically speed up fixture authoring.

## Direct DMX Control (Universe Inspector)

The Universe Panel (`UniversePanel.vue`) provides direct, low-level access to the DMX buffer.
- **Banner Grouping**: Fixtures appear as cohesive units with a single header.
- **Fader Components**: `DmxChannelFader.vue` enables per-channel manipulation with horizontal icon previews, capability selection (popover), and precise numeric entry.
- **Overrides**: All manual adjustments create high-priority overrides in the `engineStore`, bypassing effects until cleared.
- **High-Frequency Performance**: To ensure 60fps even with 512+ reactive DMX values, the Grid and Faders use a "Bypass Reactivity" pattern. Instead of Vue template interpolation (which triggers expensive virtual DOM patches), values are pushed directly to cached DOM nodes via `requestAnimationFrame` using the `bufferRevision` reactive trigger only for the initial scheduling.
- **Dual View Modes**:
    - **Grid View**: A visual, bit-packed representation of the universe helpful for identifying overlaps and gaps.
    - **Table View (`PatchTable.vue`)**: A structured list optimized for auditing fixture settings (ID, Name, Type, Mode, Address, etc.).
    - **Selection Sync**: Both views are fully synchronized with the `engineStore.selectedIds` and the 2D Workspace.

