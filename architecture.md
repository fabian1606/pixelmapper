# Pixelmapper Architecture

## Overview

Pixelmapper is a DMX lighting controller with a Nuxt 4 / Vue 3 / TypeScript frontend and a Rust engine compiled to WebAssembly. It is built as a **small core plus plugins** ([ADR 0001](architecture/adr/0001-extension-and-content-plugin-system.md), implemented):

- **Rendering runs in the browser** — the Rust engine (`rs-engine-core`) and the 2D canvas renderer (`rs-engine-canvas`) run as WASM inside a Web Worker (`app/utils/engine/engine-worker.ts`). Modifiers are sandboxed content plugins (AssemblyScript → WASM) executed by the worker's plugin bridge.
- **Everything specific is an extension** — controls (color picker, pan/tilt), fixture kinds (NeoPixel strip), outputs (ArtNet, ESP nodes) and hardware controllers (AKAI APC Mini mk2) are extensions. The core runs with zero extensions (`PM_NO_EXTENSIONS=1`, checked in CI).
- **Outputs are rendered frames** — connectors receive rendered universes/pixels; ESP32 devices are pure output devices. (This replaces the former principle "browser and ESP32 run the same engine".)
- **Web first, native where it pays off** ([ADR 0003](architecture/adr/0003-native-platform-layer.md)) — the web app stays a first-class target. Platform-dependent I/O (UDP, serial, MIDI; later raw touch and the engine) goes through the `Platform` contract: host code imports `#platform` (resolved to `app/platform/web` or `app/platform/tauri` at build time), extensions call `getPlatform()`. Missing capabilities are `null` and degrade visibly (Art-Net falls back to the local bridge). Host-only shell features (window chrome, the native menu bar with File/View commands and Open Recent, project file dialogs) come from `getWindowChrome()` / `getAppShell()` of the same `#platform` entry; the commands live in `app/composables/app-menu`.
- **Offline-first projects** ([ADR 0004](architecture/adr/0004-offline-first.md)) — a local `ProjectStore` (IndexedDB, `app/utils/persistence/project-store`) is the primary store; Supabase is a sync and collaboration layer. Every persisted change (history commands and persistent live-ops) goes through a local outbox with a client `changeId`; the sync engine (`app/utils/sync`) pulls remote changes, rebases pending local changes with a field-level 3-way merge (`app/utils/sync/merge`) and pushes them. The desktop app works fully offline (account optional, bundled OFL library and firmware); the web app keeps mandatory login and only guarantees that a dropped connection loses no data. Retries go through `app/utils/sync/connectivity.ts` (backoff, reconnect).
- **Planned targets:** a **Tauri 2** desktop app (native Rust engine, `wasmtime` modifier runtime, direct ArtNet; migration steps in ADR 0003 §4) and a backend render engine for generated visuals.

## Architectural Principles

1. **Small core, everything specific is a plugin.** The core MUST run and be usable with zero extensions installed. See [ADR 0001](architecture/adr/0001-extension-and-content-plugin-system.md).
2. **Two plugin kinds:**
   - **Extensions** — features of the software (controls like the color picker, fixture kinds like NeoPixel strips, connectors, hardware controllers, live widgets). Authored as Nuxt layers in `extensions/`, distributed as prebuilt ES bundles, trusted, always active when installed. They talk to the core only through `@pixelmapper/extension-api`: auto-slots from layout primitives, inherited domain scopes, replaceable `pm.*` inputs, commands, and an opt-in live-value channel.
   - **Content plugins** — code that shapes the visual output (modifiers now; shaders and visuals later). AssemblyScript compiled to sandboxed WASM, pure functions, content-addressed by hash, shareable and generatable at runtime. Built-ins live in `plugins/`.
3. **AI-first.** Every plugin surface is typed, self-describing (manifest `description`, param schemas) and validated by a standalone toolchain, so an AI agent can generate extensions (as code) and content plugins (live) safely. Generated references live in `docs/ai/`.
4. **Command pattern for every mutation** (undo/redo, persistence, live collaboration) — extensions included (namespaced `ext/name` commands).
5. **Rust orchestrates rendering**; modifiers run behind the `ModifierRuntime` trait (browser: JS bridge in the worker; Tauri: `wasmtime`).

## File Structure

```
pixelmapper/
├── aiBackendService/              # Express + LangGraph backend for AI tasks (fixture extraction/enrichment)
├── app/                           # Nuxt 4 / Vue 3 frontend (the core)
│   ├── components/
│   │   ├── engine/                # Workspace, sidebars, property controls, modifier stack, kind forms, commands
│   │   ├── live/                  # Live mode canvas + widgets (incl. generic controller twin)
│   │   ├── design/                # Universe inspector, patch table
│   │   ├── three/                 # 3D viewport + scene builders (body polylines/shapes for kinds)
│   │   ├── connectors/            # Generic ConnectorCard (status, settings slot, output mapping, logs)
│   │   ├── extensions/            # Install dialog, missing-extension gate
│   │   ├── primitives/            # Layout primitives with auto extension slots (PmPanel, PmPanelSection, …)
│   │   ├── pm/                    # Core defaults of the replaceable pm.* inputs
│   │   ├── extension-host/        # ExtensionSlot, Replaceable, ScopeProvider, choice dialog
│   │   ├── plugin-host/           # ParamForm (param schema → pm.* inputs), previews, iframe panels
│   │   └── ui/                    # shadcn-vue primitives (not replaceable)
│   ├── composables/extensions/    # provideScope/useScope, useExtensionContext, useReplaceable, useLiveValue, onFrame
│   ├── pages/                     # projects, editor, connections, extensions, dev/slots (slot catalog)
│   ├── plugins/                   # 00 extension host · 01 content plugins · 02 connectors · 03 bundle loader
│   ├── stores/                    # Pinia (engine-store = render loop & project state, connections, controllers, live)
│   └── utils/
│       ├── extensions/            # registry, activation, slots, scopes, replacements, live hub, requires, loader + cache
│       ├── engine/                # Fixture model, worker, serialization, modifier instances
│       ├── kinds/                 # Fixture-kind host: build application, world transforms, canvas primitives
│       ├── plugins/               # Plugin store (memory → IndexedDB → built-ins → Supabase), worker bridge, preview pool, create/import
│       ├── persistence/           # Snapshots, change log, `.pmproject` archives
│       ├── connectors/            # Connector registry + engine packet encoders
│       ├── controllers/           # Registry-driven controller catalog
│       └── ofl/                   # Open Fixture Library import
├── extensions/                    # First-party extensions (Nuxt layers; Bun workspace)
│   ├── color-picker/ pan-tilt/ connector-artnet/   # distribution set (layered into every build)
│   ├── neopixel-strip/ connector-esp/ controller-akai-apc-mini-mk2/   # catalog (installable bundles)
│   └── _debug-slots/              # dev-only slot labels (PM_DEBUG_SLOTS=1)
├── plugins/                       # Built-in content plugins (AssemblyScript): color-adjust, noise, sequencer, waveform
├── packages/
│   ├── extension-api/             # @pixelmapper/extension-api — the only core surface extensions may import
│   ├── extension-build/           # Vite lib preset → ES bundle + extension.json
│   ├── mcp-bridge/                # pixelmapper-mcp: stdio MCP server ⇄ app over ws://127.0.0.1:7778 (ADR 0002 D16)
│   ├── plugin-sdk/                # @pixelmapper/plugin-sdk (AssemblyScript)
│   └── plugin-toolchain/          # compile → instrument → validate → hash (CLI + in-browser)
├── public/extensions/             # Built catalog bundles + catalog.json
├── docs/
│   ├── ai/                        # Generated API reference (d.ts bundles, index.json) — `bun run docs:ai`
│   └── controller-designs/        # Design sources of controller layouts
├── rs-engine/
│   ├── core/                      # Engine, binary protocol, signatures, phase/beat clock, ModifierRuntime
│   └── canvas/                    # 2D renderer: generic kind primitives + handles (WASM only)
├── src-tauri/                     # Desktop app (Tauri 2): native commands (udp.rs), config, icons — ADR 0003
├── scripts/                       # build-plugins, build-extensions, check-extensions, check-zero-extensions, generate-ai-docs
├── tools/artnet-bridge/           # Local WebSocket → UDP ArtNet bridge
├── supabase/migrations/           # Database schema (005 content plugins, 006 extensions)
└── pio*/                          # ESP32 firmware (out of scope; must implement frames 0x21/0x22)
```

## Tooling

- `bun run dev:tauri` / `bun run build:tauri` — desktop app (Tauri 2, `src-tauri/`; SPA build with the native `#platform`, ADR 0003). `cargo test --manifest-path src-tauri/Cargo.toml` tests the native commands.
- `bun run test` — Vitest (`vitest.config.ts` mirrors the Nuxt aliases `~`/`@`; `happy-dom` environment). Tests live next to the code as `*.test.ts`.
- `bun run typecheck` — `nuxt typecheck` (vue-tsc).
- `bun run lint` — ESLint import rules for `extensions/**`; `bun run check:extensions` — manifest/import/replacement checks for first-party extensions.
- `PM_DEBUG_SLOTS=1 bun run dev:nuxt` — includes the dev-only `_debug-slots` extension that labels every extension slot.
- `cargo test` in `rs-engine/` — Rust unit tests (core; canvas is wasm-only and built via `wasm-pack`).
- `bun run check:zero-extensions` — builds without any extension (`PM_NO_EXTENSIONS=1`) and runs the zero-extension smoke test.
- `bun run build:plugins` / `bun run build:extensions` — compile built-in content plugins / build catalog extension bundles into `public/extensions/`.
- `bun run mcp` — `pixelmapper-mcp` stdio MCP server for Claude Code / Claude Desktop (`bun run mcp token` prints the pairing token); see [packages/mcp-bridge/README.md](packages/mcp-bridge/README.md).
- `bun run docs:ai` — regenerate `docs/ai/` (extension-API and plugin-SDK declarations, `index.json`). The dev page `/dev/slots` lists every slot rendered in the session.

## Documentation Map

- **Decisions:** [ADR 0001 — Extension & Content-Plugin System](architecture/adr/0001-extension-and-content-plugin-system.md)
- **Work plan:** [Plugin-system implementation plan](architecture/plugin-system-implementation-plan.md)
- **Decisions:** [ADR 0002 — Operations, Observation & Agent Layer](architecture/adr/0002-agent-and-operations-layer.md)
- **Work plan:** [Agent-system implementation plan](architecture/agent-system-implementation-plan.md) (interleaved with the ADR 0003 Tauri steps)
- [Observability (observe-lite)](architecture/observability.md) — `observe(request)`: headless-core preview of one modifier, live capture, features (range/color/temporal/spatial/radial), text report, expectation JSON paths
- **Contract:** [MCP bridge WebSocket protocol](architecture/mcp-bridge-protocol.md) — `pixelmapper-mcp` ⇄ app (hello/semver, token + Origin, dynamic tool list, `call`/`result`, relay mode)
- **Decisions:** [ADR 0003 — Platform Layer: Web First, Native Where It Pays Off](architecture/adr/0003-native-platform-layer.md) (Tauri 2, `#platform`, `getPlatform()`, migration steps)
- **Decisions:** [ADR 0004 — Offline-First Projects](architecture/adr/0004-offline-first.md) (local-first store, outbox, rebase + 3-way merge, optional account on desktop); package notes in [architecture/offline/](architecture/offline/) (`wp-p0`, `wp-merge`, `wp-store`, `wp-server`, `wp-tauri`, `wp-records`, `wp-sync`, `wp-account`)
- [Engine & Render Loop](architecture/engine.md) *(describes the pre-migration effect pipeline until plan P3.17)*
- [Binary Protocol](architecture/binary-protocol.md)
- **Work plan:** [Modifier UX implementation plan](architecture/modifier-ux-implementation-plan.md) — curve component, shared Distribution, recipes, Wave/Noise/Pattern/Color Shift redesign
- **Work plan:** [Art-Net 4 & RDM implementation plan](architecture/artnet-rdm-implementation-plan.md) — Pixelmapper Node, RDM discovery/patch of XBAR500 tubes, tube firmware updates; bridge contract draft: [bridge WebSocket protocol](architecture/artnet-bridge-ws-protocol.md)
- [Modifier design principles](architecture/guides/modifier-design-principles.md) — what every modifier must satisfy (for people and automated agents)
- [Engine & Render Loop](architecture/engine.md) — worker, signatures, ModifierRuntime, ABI v1.3 (room coordinates, z, trigger params), distribution, previews
- [Binary Protocol](architecture/binary-protocol.md) — layout v2, `TYPE_MODIFIERS_BIN` v2 (distribution block)
- [Authoring extensions](architecture/guides/authoring-extensions.md) — task-oriented: controls, panel actions, kinds, connectors, controllers, widgets, commands (AI-ready)
- [Authoring content plugins](architecture/guides/authoring-content-plugins.md) — SDK, manifest, params, validation, custom panels (AI-ready)
- [Core Concepts: Fixtures, Channels, Beams](architecture/core-concepts.md)
- [State Management & Reactivity](architecture/state.md)
- [Connectors & Hardware](architecture/connectors.md)
- [UI & History](architecture/ui-history.md)
- [Live Collaboration](architecture/live-collaboration.md)
- [Extensions — how the extension host works](architecture/extensions.md) (registry, scopes, slots, `pm.*` replaceables, live values, requires, distribution)
- **Generated reference:** [docs/ai/](docs/ai/README.md) — bundled API declarations and `index.json` of contracts, scopes and slots

## Glossary

| Term | Meaning |
|---|---|
| **Modifier** | A content plugin that changes channel values over time/space (`ModifierInstance` in code; formerly `Effect`). |
| **Signature** | The typed value tuple a modifier reads/writes: `scalar`, `rgb`, `panTilt`. Mapped to DMX channels by the core. |
| **Extension** | Trusted, installable feature package (Nuxt layer / ES bundle). |
| **Content plugin** | Sandboxed AssemblyScript/WASM package identified by content hash. |
| **Scope** | Typed, readonly domain object (fixture, channel, modifier, …) inherited down the component tree and visible to extensions. |
| **Slot** | Extension point auto-generated by a layout primitive; id = primitive id path + position, e.g. `properties/color:actions`. |
| **`pm.*` input** | Replaceable domain input (fader, color input, XY input, …) with a typed contract; also the UI kit for content-plugin params. |
| **Fixture kind** | Extension-provided fixture generator that compiles a config into channels, beams, body primitives and handles. |
| **Distribution** | How a modifier spreads over fixtures; shared by all modifiers. The UI calls it Spread: all the same, Spatial 2D (handle on the canvas), fixture by fixture (order numbers) or within each fixture. Produces `spatial`, `rank`, `distGroup` per sample. |
| **Rank / order numbers** | Position of a fixture in an order (clicked or from a drawn line); several fixtures may share one. |
| **`spatial`** | Per-sample position along the distribution: 0 at the origin / first number, 1 at the end / after the last. |
| **`timePhase`** | Temporal phase of an instance in cycles (one pass / step per unit). |
| **Recipe** | Manifest preset: a named, complete look (params, speed, distribution, strength). |
| **Profile / Motion** | Curves of Wave and Color Shift: what is lit over the distance / where it is during one pass. |
| **Curve shape** | Programmatic curve generator with args (each arg is a handle in `pm.curve`); extensions can contribute more. |
| **Composite editor** | One `pm.*` input bound to several params (e.g. the hue strip binds hue shift + range). |
| **Canvas hint** | `ui: { canvas: 'point' \| 'radius' }` on a param: a draggable dot (point param) or ring (number param around an anchor point) on the 2D canvas for the selected modifier, in any distribution mode (`canvas-hints/ModifierCanvasHandles.vue`; guide: authoring-content-plugins.md "Canvas handles"). |
| **Endless strip** | Animated preview of a modifier on "infinitely many pixels", independent of the fixture count. |


## Presets, Variants & Groups

- **Presets** are snapshots of programmed channel values and modifier instances for a set of fixtures, grouped into `PresetCategory` (color, movement, …) for display.
- **Preset variants** depend on a `basePresetId` and store only their *differences* (overrides). Applying a variant merges the base state with the overrides at apply time, so base edits propagate to all variants. Diffing and merging are pure functions.
- **Groups** (`SceneNode`s) organize fixtures hierarchically for selection and for applying modifiers to many fixtures at once.

## Software Patterns & Guidelines

Complements `AGENTS.md` (code style) and ADR 0001 (plugin rules).

- **Modularity:** split large files into focused modules; keep UI and engine logic separate and bridge them with Pinia.
- **Pure functions for engine logic** (preset diffing, variant merging, requires bookkeeping, kind builds) — testable, side-effect free.
- **Composables** encapsulate UI logic and global UI state (`use-presets.ts`, `useGlobalContextMenu.ts`, …).
- **`v-model` components** use `defineModel()`.
- **Context menus** are global and programmatic: trigger with `@contextmenu.prevent="openMenu($event, options)"`, rendered by `GlobalContextMenu.vue` (in `app.vue`), state in `app/composables/useGlobalContextMenu.ts`. Options (labels, icons, callbacks) are defined at the trigger; extensions add items through `context-menu/<target>:items` slots.
- **Floating overlays** that must not close the sidebar are listed in `FLOATING_OVERLAY_SELECTORS` (`app/utils/floating-overlay.ts`).
- **JSDoc** on all major interfaces, classes and exported functions.

### Adding new features

1. **Decide core vs. extension vs. content plugin** (ADR 0001 §3): anything specific to a device, protocol or look belongs in an extension or a content plugin; the core only grows generic contracts.
2. **Implement** through commands for every mutation; extensions use only `@pixelmapper/extension-api`.
3. **Test** next to the code (`*.test.ts`), run the gate (typecheck, `bun run test`, lint, `check:extensions`, `cargo test`, build).
4. **Document** here or in the sub-documents; regenerate `docs/ai/` when the extension API or SDK changes.

## Custom Fixtures (SVG Based)

To support custom, highly visual, or non-standard fixtures, the architecture provides a Custom Fixture Editor.
- **Concept:** Users define a fixture visually by importing an SVG graphic.
- **Fixture category** follows the OFL category schema (`custom-fixture-types.ts`) and selects the canvas render mode (`single`, `bar`, `matrix`, `custom_svg`) and the shown settings (e.g. pixel density for `Pixel Bar`/`Matrix`). Generated, configurable fixtures (strips, matrices of arbitrary shape) are **fixture kinds** provided by extensions instead — see [authoring extensions](architecture/guides/authoring-extensions.md).
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

An Express + LangGraph backend uses LLMs to parse fixture manuals and extract physical dimensions, features and DMX mappings, feeding the result into the Custom Fixture Editor.
- **Endpoint:** `/extract-fixture` takes manual text (later OCR'd PDF).
- **LangGraph workflow:** a state machine (`ExtractionState`) runs the text through isolated nodes (`extractGeneralInfo.ts`, `extractChannels.ts`, `extractModes.ts`).
- **Typed output:** simple nodes use `withStructuredOutput`; nested arrays (channels, modes) use tool calling bound to Zod schemas (e.g. `OflChannelSchema`), which splits the context and keeps outputs strictly typed.
- **SSE streaming:** status messages stream to `CustomFixtureEditorDialog.vue` before the final assembled `OflFixture` is returned.
- The AI agent loop for generating plugins is out of scope of ADR 0001; it builds on the self-describing surfaces in `docs/ai/`.

## MCP Bridge (pixelmapper-mcp)

External agents (Claude Code, Claude Desktop) drive the running app through MCP (ADR 0002 D16; plan M3).
- **CLI** `packages/mcp-bridge` (Bun): a thin stdio MCP server. It serves the tool list the **app announces** (dynamic `tools/list` plus `notifications/tools/list_changed`) and forwards `tools/call` to the app. Tools execute in the app.
- **Transport:** the app (tab or Tauri webview) connects as a WebSocket client to `ws://127.0.0.1:7778`. Auth uses an Origin allow-list plus a pairing token from `~/.pixelmapper/mcp-token`. Only the latest app connection is active. Contract: [mcp-bridge-protocol.md](architecture/mcp-bridge-protocol.md).
- **Several MCP clients:** the first CLI process is the **hub**; later ones connect to it as **relays**, and a relay takes over the port when the hub exits. Every call carries the MCP client name, so the app attributes it as actor `agent:mcp:<client>`.
- **Offline behaviour:** with no app connected, `tools/list` returns the last-known list (`~/.pixelmapper/mcp-tools.json`) or built-in placeholders, plus the local `pixelmapper_status` tool. Calls fail with a pairing hint.
- **Prompts:** `docs/ai/skills/**/prompts/*.md` (YAML frontmatter `name`, `description`, `arguments`; `{{arg}}` placeholders) are served as MCP prompts.
- The hub uses `node:http` + `ws` rather than `Bun.serve`, so the same code runs under Bun and under Vitest (Node).

## Direct DMX Control (Universe Inspector)

The Universe Panel (`UniversePanel.vue`) provides direct, low-level access to the DMX buffer.
- **Banner Grouping**: Fixtures appear as cohesive units with a single header.
- **Fader Components**: `DmxChannelFader.vue` enables per-channel manipulation with horizontal icon previews, capability selection (popover), and precise numeric entry.
- **Overrides**: All manual adjustments create high-priority overrides in `engineStore.overrideMap`, bypassing modifiers until cleared (drag sets, double-click clears, numeric input fine-tunes).
- **High-Frequency Performance**: To ensure 60fps even with 512+ reactive DMX values, the Grid and Faders use a "Bypass Reactivity" pattern. Instead of Vue template interpolation (which triggers expensive virtual DOM patches), values are pushed directly to cached DOM nodes via `requestAnimationFrame` using the `bufferRevision` reactive trigger only for the initial scheduling.
- **Dual View Modes**:
    - **Grid View**: A visual, bit-packed representation of the universe helpful for identifying overlaps and gaps.
    - **Table View (`PatchTable.vue`)**: A structured list optimized for auditing fixture settings (ID, Name, Type, Mode, Address, etc.).
    - **Selection Sync**: Both views are fully synchronized with the `engineStore.selectedIds` and the 2D Workspace.
- **View switching:** the grid uses `v-show` (keeps scroll state), the table `v-if`.
- **High-resolution DMX (16/24-bit):** fine channels are synthesized as independent `GENERIC` channels during parsing and shown as separate faders. The Rust engine renders the coarse channel in a float `render_buffer` and packs the high-precision value into the byte slots.
- **Patching & boundaries:** fixtures never cross the 512-channel universe boundary, except fixture kinds that declare `spansUniverses` (long LED strips; `app/utils/engine/addressing.ts`). Drag-and-drop in `AddressGrid` enforces this with a live address label and conflict highlighting.
