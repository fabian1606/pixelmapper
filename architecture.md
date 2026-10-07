# Pixelmapper Architecture

## Overview

Pixelmapper is a DMX lighting controller with a Nuxt 4 / Vue 3 / TypeScript frontend and a Rust engine compiled to WebAssembly.

- **Rendering runs in the browser today** — the Rust engine (`rs-engine-core`) and the 2D canvas renderer (`rs-engine-canvas`) run as WASM inside a Web Worker (`app/utils/engine/engine-worker.ts`).
- **Planned targets:** a **Tauri** desktop app (native Rust engine, direct ArtNet) and a backend render engine for generated visuals.
- **ESP32 on-device rendering is no longer a goal.** ESP32 devices are pure output devices that receive rendered frames. (This replaces the former principle "browser and ESP32 run the same engine".)

## Architectural Principles

1. **Small core, everything specific is a plugin.** The core MUST run and be usable with zero extensions installed. See [ADR 0001](architecture/adr/0001-extension-and-content-plugin-system.md).
2. **Two plugin kinds:**
   - **Extensions** — features of the software (controls like the color picker, fixture kinds like NeoPixel strips, connectors, hardware controllers, live widgets). Authored as Nuxt layers in `extensions/`, distributed as prebuilt ES bundles, trusted, always active when installed. They talk to the core only through `@pixelmapper/extension-api`: auto-slots from layout primitives, inherited domain scopes, replaceable `pm.*` inputs, commands, and an opt-in live-value channel.
   - **Content plugins** — code that shapes the visual output (modifiers now; shaders and visuals later). AssemblyScript compiled to sandboxed WASM, pure functions, content-addressed by hash, shareable and generatable at runtime. Built-ins live in `plugins/`.
3. **AI-first.** Every plugin surface is typed, self-describing (manifest `description`, param schemas) and validated by a standalone toolchain, so an AI agent can generate extensions (as code) and content plugins (live) safely.
4. **Command pattern for every mutation** (undo/redo, persistence, live collaboration) — extensions included.
5. **Rust orchestrates rendering**; modifiers run behind the `ModifierRuntime` trait (browser: JS bridge in the worker; Tauri: `wasmtime`).

## File Structure

Current layout. The target layout after the plugin-system migration is specified in [ADR 0001 §4](architecture/adr/0001-extension-and-content-plugin-system.md#4-repository-layout-target); follow the [implementation plan](architecture/plugin-system-implementation-plan.md) to get there.

```
pixelmapper/
├── aiBackendService/              # Express + LangGraph backend for AI tasks (fixture extraction/enrichment)
│   └── src/{graph,server,state,model}.ts, nodes/
├── app/                           # Nuxt 4 / Vue 3 frontend (the core)
│   ├── components/
│   │   ├── engine/                # Workspace, sidebars, property controls, modifier editors, commands
│   │   ├── live/                  # Live mode canvas + widgets
│   │   ├── design/                # Universe inspector, patch table
│   │   ├── three/                 # 3D viewport + scene builders
│   │   └── ui/                    # shadcn-vue primitives (not replaceable)
│   ├── stores/                    # Pinia stores (engine-store = render loop & project state)
│   └── utils/
│       ├── engine/                # Fixture model, worker, serialization, (legacy) TS effect classes
│       ├── connectors/            # Connectors + binary encoders (→ become extensions)
│       ├── controllers/           # Controller driver contracts (→ extensions)
│       └── ofl/                   # Open Fixture Library import
├── controllers/                   # Hardware controller drivers (→ extensions/controller-*)
├── rs-engine/
│   ├── core/                      # Engine, render loop, binary protocol, effects (→ signatures + ModifierRuntime)
│   ├── canvas/                    # 2D renderer (WASM)
│   └── ffi/                       # ESP32 C FFI (to be removed, see plan P0.4)
├── supabase/migrations/           # Database schema
└── pio*/                          # ESP32 firmware (out of scope for the plugin migration)
```

## Documentation Map

- **Decisions:** [ADR 0001 — Extension & Content-Plugin System](architecture/adr/0001-extension-and-content-plugin-system.md)
- **Work plan:** [Plugin-system implementation plan](architecture/plugin-system-implementation-plan.md)
- [Engine & Render Loop](architecture/engine.md) *(describes the pre-migration effect pipeline until plan P3.17)*
- [Binary Protocol](architecture/binary-protocol.md)
- [Core Concepts: Fixtures, Channels, Beams](architecture/core-concepts.md)
- [State Management & Reactivity](architecture/state.md)
- [Connectors & Hardware](architecture/connectors.md)
- [UI & History](architecture/ui-history.md)
- [Live Collaboration](architecture/live-collaboration.md)
- Created during the migration: `architecture/extensions.md`, `architecture/guides/authoring-extensions.md`, `architecture/guides/authoring-content-plugins.md`

## Glossary

| Term | Meaning |
|---|---|
| **Modifier** | A content plugin that changes channel values over time/space (called `Effect` in pre-migration code). |
| **Signature** | The typed value tuple a modifier reads/writes: `scalar`, `rgb`, `panTilt`. Mapped to DMX channels by the core. |
| **Extension** | Trusted, installable feature package (Nuxt layer / ES bundle). |
| **Content plugin** | Sandboxed AssemblyScript/WASM package identified by content hash. |
| **Scope** | Typed, readonly domain object (fixture, channel, modifier, …) inherited down the component tree and visible to extensions. |
| **Slot** | Extension point auto-generated by a layout primitive; id = primitive id path + position, e.g. `properties/color:actions`. |
| **`pm.*` input** | Replaceable domain input (fader, color input, XY input, …) with a typed contract; also the UI kit for content-plugin params. |
| **Fixture kind** | Extension-provided fixture generator that compiles a config into channels, beams, body primitives and handles. |

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

