# ADR 0001 — Extension & Content-Plugin System

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-10-07 |
| **Deciders** | Fabian Rafreider |
| **Implementation plan** | [plugin-system-implementation-plan.md](../plugin-system-implementation-plan.md) |
| **Supersedes** | The "same engine on browser and ESP32" principle in `architecture.md` |

This ADR is the **normative specification** of how Pixelmapper is extended. It is written so that an implementing agent can work from it without further context. Where this document and existing code disagree, this document wins. Where this document is silent, follow the existing code and `AGENTS.md`.

Key words: **MUST** / **MUST NOT** = hard requirement, **SHOULD** = default unless there is a documented reason, **MAY** = optional.

---

## 1. Context

Pixelmapper grew a set of features that are specific to one user's setup or are UI that should be swappable:

- **Special-purpose controls** (color picker, pan/tilt pad, movement range) are hard-wired via `v-if` chains in `FixturePropertyControl*.vue`. Live widgets (`LiveColorWheelWidget`, `LiveXYPadWidget`, …) re-implement the same concepts a second time.
- **NeoPixel LED strips** are not isolated: `Fixture.stripConfig` is special-cased in ~20 files across the TS model, the Rust canvas (`StripData`, Catmull-Rom sampling, edit handles in `rs-engine/canvas/src/render.rs`), the 3D scene (`strip-substrates.ts`, `fixture-adapter.ts`), encoders (`binary-encoder.ts`, `scoped-encoder.ts`), serialization, commands and dialogs.
- **Modifiers** (called `Effect` in code) are implemented **twice**: as TS classes in `app/utils/engine/effects/` and as Rust structs in `rs-engine/core/src/effects.rs`, selected by a hard-coded `match`/`effectType` string and a fat `EffectConfig` with one optional `*Params` field per type.
- **Connectors** and **hardware controllers** have ad-hoc registries (`app/utils/connectors/registry.ts`, `controllers/`).

The product direction is **AI-first**: users should be able to *prompt* new modifiers (and later shaders and visuals) and get working, sandboxed code live; developers (human or coding agent) should be able to add features through a small, typed, stable API instead of touching core internals.

Further product decisions that constrain this ADR:

- **ESP32 on-device rendering is no longer a goal.** Rendering happens in the browser now, later in a Tauri app and/or a backend render engine. The ESP32 becomes a pure output device.
- **Tauri** is the planned desktop target (direct ArtNet). The design must not depend on a backend service for core functionality.
- **The AI generation loop** (Codex/ChatGPT connection, where the agent runs) is **out of scope**. This ADR only guarantees the system is *ready* for it.
- **Shaders** (time/space warping, generated visuals) are **out of scope** except for reserving their manifest slot.

---

## 2. Decision summary

Pixelmapper has **exactly two kinds of plugins**, separated by one criterion: *is code generated or installed at runtime by an end user?* Only runtime-generated code is sandboxed.

| | **Extensions** | **Content plugins** |
|---|---|---|
| Purpose | Features of the software | Influence the visual output |
| Examples | Color picker, pan/tilt pad, NeoPixel strip, ArtNet connector, Akai controller, live widgets | Modifiers (now); shaders, visuals (later) |
| Author | Developers / coding agents | End users via prompt; import from others |
| Language | TypeScript + Vue (`<script setup lang="ts">`) | AssemblyScript |
| Development form | Nuxt layer in `extensions/<id>/` | Folder in `plugins/<id>/` or generated |
| Distribution form | Prebuilt ES-module bundle, loaded via `import()` | `.wasm` + manifest (+ optional UI module), content-addressed |
| Trust | Trusted, in-process, no sandbox (install dialog warns "full access") | Sandboxed: WASM without ambient imports; custom UI in `<iframe sandbox>` |
| UI | Vue components placed in auto-slots / replacing `pm.*` inputs | Generated from param schema via `pm.*` UI kit, plus optional custom panel in iframe |
| State access | Domain scopes (read), commands (write), live-value channel | Pure function inputs only |
| Identity | `id` + semver `version` | `sha256` content hash + human alias |
| Activation | Always active when installed | Referenced by modifier instances |
| Project dependency | Derived from usage (`project.requires`) | Referenced by hash; bundled in exports |

The **core** MUST run and be fully usable with **zero extensions installed** (no output, no color picker — generic fallbacks only). This is what makes collaboration between users with different extension sets possible.

---

## 3. Decisions (normative)

Each decision lists the rejected alternatives so they are not re-litigated.

### D1 — Two-tier plugin model
Extensions (build-time-authored, trusted) and content plugins (runtime, sandboxed) as described in §2.
*Rejected:* runtime-only plugins for everything (sandbox cost for core features); build-time-only (no live generation).

### D2 — Content plugins are real code, compiled to WASM
Generated modifiers are AssemblyScript compiled to WebAssembly, not JSON/expression DSLs.
*Rejected:* Rust compiled per plugin (needs a native toolchain; impossible in the browser, 150–250 MB in Tauri); declarative-only plugins (too limited).

### D3 — AssemblyScript everywhere for modifiers, including built-ins
All modifiers — built-in and generated — are AssemblyScript. Built-in vs. generated differs only by provenance; a good generated modifier can be promoted into `plugins/` unchanged. The AssemblyScript compiler runs in the browser (and in Bun), so no backend is ever required to compile.
*Rejected:* built-ins stay native Rust (two worlds, two languages, no "use built-in as template").

### D4 — One modifier type with typed signatures
Time and space modifiers (`SpeedCurveEffect`, `DisplacementEffect`) are **removed** and will return later as **shaders**. Value and color modifiers merge into **one** modifier concept parameterized by a **signature**:

| Signature | Arity | Meaning | Replaces |
|---|---|---|---|
| `scalar` | 1 | One normalized channel value (dimmer, shutter, zoom, any single channel) | Waveform, Noise, Sequencer |
| `rgb` | 3 | Linear RGB color, each 0–1 | ColorEffect |
| `panTilt` | 2 | Normalized pan, tilt (0–1 within the fixture's movement range) | — (new) |

The signature list is **fixed in the core**. New signatures (`rgbw`, `cmy`, `xy`, …) are added only by core updates. Mapping a signature onto concrete fixture channels is core logic (§6.4).
*Rejected:* plugin-extensible signatures (mapping becomes a plugin problem); no signatures (AI must know DMX details).

### D5 — Modifiers are pure functions
A modifier's output depends **only** on `(frame context, sample, params)`. No state across frames. `prepare(params)` MAY precompute lookup tables (cache, not state). Randomness only via host-provided seeds and SDK hash-noise. Phase accumulation moves from every effect into the core (`beatTime`, `phase`).
Reasons: deterministic multi-client rendering (`clockEpoch`), scrubbing/preview/thumbnails/timeline, testable validation.
*Rejected:* stateful modifiers (opt-in or not). Particles/trails belong to future shaders/visuals.

### D6 — Rust core orchestrates; modifiers run behind a `ModifierRuntime` trait
The Rust core keeps layout, targeting, spatial phase/fanning, `beatTime`, signature mapping, blending and the DMX buffer. It calls modifiers through `trait ModifierRuntime`. Implementations: **browser** (JS bridge inside `engine-worker.ts`), **Tauri** later (`wasmtime` with fuel/epoch interruption).
*Rejected:* orchestration in TS (would have to move back for Tauri); everything in AssemblyScript (full rewrite).

### D7 — Browser sandbox = no ambient imports + instrumentation + watchdog
Browser WebAssembly has no fuel metering. Protection is layered: (1) the module may only import the whitelisted host functions; (2) the toolchain instruments loop back-edges with an iteration budget; (3) imports are accepted only **with source** and are recompiled and hash-verified; (4) a main-thread watchdog restarts a hung worker and disables non-built-in plugins (§6.7).

### D8 — Content plugins are content-addressed
A plugin build is identified by `sha256` over its canonical manifest + `.wasm` + UI bundle. Instances reference the hash. Editing creates a new hash; old hashes remain valid forever. A human alias (`@fabian/rainbow-chase`) and semver are metadata. Storage: Supabase table + bucket, local IndexedDB cache (Tauri: file system). Live sync broadcasts only the hash.
*Rejected:* mutable plugins with version numbers (cross-client version conflicts).

### D9 — Param UI = `pm.*` UI kit; custom UI = plain TS module in a sandboxed iframe
A content plugin declares a typed param schema. The host renders it with the **`pm.*` inputs** (in-process). If that is not enough, the plugin MAY ship **one** custom panel: a plain TS module `export function mount(el, api)`, transpiled in the browser, mounted in `<iframe sandbox="allow-scripts">`, talking to the host via a `postMessage` bridge. The iframe does **not** get `pm.*` components; a plugin can combine UI-kit params *next to* its custom panel.
*Rejected:* Vue SFC compiled at runtime (Vue runtime per iframe, SFC compiler in bundle); UI-kit only (too limited).

### D10 — Extensions are Nuxt layers in development, prebuilt ES bundles in distribution
Developers author an extension as a Nuxt layer (auto-imports, HMR, types). For distribution it is built into an ES-module bundle (+ CSS) that the app loads at runtime via `import()`. Shared dependencies (`vue`, `pinia`, `@pixelmapper/extension-api`) come from the host via globals, never bundled twice. First-party extensions in the repo MAY be included directly via Nuxt `extends`. Both paths end in the same registry.
*Rejected:* developer-only extensions (end users could not install the NeoPixel strip); sandboxed extensions (performance/integration cost).

### D11 — UI extension points: auto-slots from layout primitives + inherited domain scopes
- **Slots** are produced automatically by a small set of **layout primitives** (`PmPanel`, `PmPanelSection`, `PmToolbar`, `PmMenuGroup`, `PmListItem`). Any UI built from them is extensible without anyone remembering to add slots. An explicit `<ExtensionSlot>` is the rare exception.
- **Context** is not maintained per slot. Core components provide **typed domain scopes** at natural boundaries (`provideScope('fixture', …)`); every slot automatically sees all scopes of its ancestors.
- Extensions see **only scopes**, never component internals.
*Rejected:* explicit hand-placed slots with hand-maintained context (gets forgotten); implicit slots everywhere with component locals as context (breaks on every refactor — Hyrum's law); Nuxt component shadowing (one winner, silent conflicts).

### D12 — Explicit replacement only for `pm.*` domain inputs
Extensions MAY replace a `pm.*` domain input by declaring `replaces: 'pm.<name>'`. Each `pm.*` input has a typed props/emits contract and a core default implementation. shadcn primitives (`app/components/ui/*`: dialog, select, popover, …) are **not** replaceable (focus management, keyboard, overlays); their look is changed through theme tokens. No other core UI is replaceable.

### D13 — UI kit for AI = set of `pm.*` inputs
The inputs a content plugin's param schema may use are exactly the `pm.*` inputs. Replacing `pm.fader` therefore changes it everywhere: properties sidebar, live widgets, modifier params.

### D14 — Signature-typed controls are `pm.*` inputs
Clarification of D12/D13: signatures map to inputs in the core — `scalar → pm.fader`, `rgb → pm.colorInput`, `panTilt → pm.xyInput`. The core ships minimal defaults (RGB faders + hex field; two faders). The **color-picker** extension replaces `pm.colorInput`; the **pan-tilt** extension replaces `pm.xyInput`. This removes the duplicated live widgets automatically.

### D15 — Fixture kinds compile into the canonical model; no custom renderers
A fixture kind (e.g. NeoPixel strip) is an extension contribution that **compiles** its config into the canonical fixture model: channels, beams, **body primitives** and **handles**. The core renders bodies generically in the 2D Rust canvas and in 3D. There are **no** custom renderers (neither Rust nor TS). If a primitive is missing, the **core** gets a new primitive.
*Rejected:* kind-provided Rust renderer as Cargo feature / escape hatch (explicitly removed — too complex).

### D16 — Firmware-specific encodings belong to connector extensions
The ESP strip packets (`TYPE_STRIP_CONFIG 0x19`, `TYPE_STRIP_SLOTS 0x1A`) move into the ESP connector extension, which reads `fixture.kind.id === 'neopixel-strip'`. Dependency direction: connector → kind, never core → kind.

### D17 — Core boundary; all connectors are extensions
Core = fixture model, OFL import, Custom Fixture Editor (it produces OFL JSON incl. custom SVG — SVG is a core body primitive, not an extension), patch/universes, Rust engine + `ModifierRuntime` + signatures + blending, Rust canvas + 3D with generic primitives, commands/history, live bus/collaboration, persistence, extension host, content-plugin host, layout primitives, scopes, `pm.*` defaults. **All** connectors (including ArtNet) and all hardware controllers are extensions. Without any, the app has no output and is still usable.

### D18 — Connector configuration is per user/device, not project state
Follows from D17 and the requirement that "everyone may output differently": connector instances and their configuration are stored per user and device, **not** in the project snapshot or `project_changes`. Connectors never create a project dependency. (Today `connector.add` etc. are project commands and `ProjectSnapshot.connectors` exists; both are removed.)

### D19 — Installed extensions are always active
There is no per-project enable/disable. Installed = active.

### D20 — Project dependencies are derived from usage and block opening
- An extension's manifest declares which contributions create a dependency when used. Fixture kinds do by default; connectors, controls, widgets and replacements never do.
- The project maintains `requires: [{ id, version: '^x.y' }]` automatically from current usage.
- Executing any command contributed by extension E adds E to `requires` (§5.8).
- Opening a project whose required extension is missing or incompatible **does not open it**; the user gets an install/update prompt, installs, the app reloads. No degraded mode.
- Offline safety: extension bundles are cached locally, and project export bundles every required extension and every referenced content plugin.

### D21 — Extensions may register their own commands
Extensions MAY define serializable commands (namespaced `<extensionId>/<name>`). Correctness across clients is guaranteed by D20 (nobody works on a project without its required extensions).
*Rejected:* core-commands-only + degraded mode (both together allow silent overwrites).

### D22 — Two data channels in the extension API
1. **State** (rarely changing): scopes as readonly refs/`shallowRef`; writes only via commands.
2. **Live values** (per frame): opt-in, pull-based — `useLiveValue(target, { fps })` (throttled `shallowRef`, only while mounted and visible) and `onFrame(cb)` (no reactivity, typed arrays). The host subscribes the worker only to what is currently requested.

### D23 — Kind configs and extension data are versioned
Fixture kinds and extensions with persisted data provide `migrate(data, fromVersion)`. Manifests carry `apiVersion`; incompatible majors are rejected with a clear message.

### D24 — Clean break for the persisted format
Projects get `schemaVersion: 2`. Version-1 projects/presets are **not** migrated; loading them shows "This project was created with an incompatible version". Displacement and SpeedCurve modifiers disappear until shaders exist.

### D25 — AI-readiness requirements
Not the AI loop itself, but: every manifest has a human/AI-readable `description`; the extension API and plugin SDK are fully typed with TSDoc; built-in plugins serve as examples; the compiler + validation harness is a standalone isomorphic package (`packages/plugin-toolchain`) usable by any future agent in browser, Bun or Tauri.

---

## 4. Repository layout (target)

```
pixelmapper/
├── app/                                   # Nuxt app = core
│   ├── components/
│   │   ├── primitives/                    # PmPanel, PmPanelSection, PmToolbar, PmMenuGroup, PmListItem (auto-slots)
│   │   ├── pm/                            # Core defaults of pm.* inputs (PmFader, PmColorInput, PmXyInput, …)
│   │   ├── extension-host/                # ExtensionSlot.vue, Replaceable.vue, MissingExtensionDialog.vue
│   │   └── plugin-host/                   # ParamForm.vue (schema → pm.*), PluginIframePanel.vue
│   ├── composables/extensions/            # provideScope, useScope, useExtensionContext, useLiveValue, onFrame, useReplaceable
│   ├── utils/extensions/                  # registry.ts, slot-matching.ts, loader.ts, requires.ts, shared-globals.ts
│   └── utils/plugins/                     # plugin-store.ts (Supabase+IndexedDB), hash.ts, bridge (worker side), preview-pool.ts
├── extensions/                            # First-party extensions (each a Nuxt layer)
│   ├── color-picker/
│   ├── pan-tilt/
│   ├── live-widgets/
│   ├── neopixel-strip/
│   ├── connector-artnet/
│   ├── connector-serial/
│   ├── connector-websocket/
│   ├── connector-espnow/
│   ├── controller-akai-apc-mini/
│   └── controller-akai-apc-mini-mk2/
├── plugins/                               # Built-in content plugins (AssemblyScript)
│   ├── waveform/      { manifest.json, modifier.ts }
│   ├── noise/
│   ├── sequencer/
│   └── color-adjust/
├── packages/                              # Bun workspaces
│   ├── extension-api/                     # @pixelmapper/extension-api — types + define* helpers (no host internals)
│   ├── extension-build/                   # @pixelmapper/extension-build — Vite preset to bundle a layer for distribution
│   ├── plugin-sdk/                        # @pixelmapper/plugin-sdk — AssemblyScript SDK (assembly/*.ts)
│   └── plugin-toolchain/                  # @pixelmapper/plugin-toolchain — compile, instrument, validate, hash (isomorphic)
├── rs-engine/
│   ├── core/                              # Engine, signatures, ModifierRuntime, blending
│   └── canvas/                            # 2D renderer with generic body primitives + handles
└── controllers/                           # REMOVED — moved into extensions/controller-*
```

`rs-engine/ffi` (ESP32 C FFI) is **deleted** (D: ESP32 rendering not a goal). The firmware in `pio*/` is out of scope; ESP connectors stream rendered frames (§9).

---

## 5. Extension specification

### 5.1 Manifest

Every extension has an entry file `extensions/<id>/extension.ts`:

```ts
import { defineExtension } from '@pixelmapper/extension-api';

export default defineExtension({
  id: 'neopixel-strip',                 // kebab-case, globally unique
  version: '1.2.0',                     // semver
  apiVersion: '^1.0.0',                 // semver range of @pixelmapper/extension-api
  displayName: 'NeoPixel LED Strip',
  description: 'Parametric addressable LED strips (WS2812, SK6812, …) drawn as curves.', // read by humans and AI
  contributes: {
    slots: [ /* SlotContribution[] (§5.3) */ ],
    replaces: [ /* ReplacementContribution[] (§5.4) */ ],
    fixtureKinds: [ /* FixtureKindDefinition[] (§5.6) */ ],
    connectors: [ /* ConnectorDefinition[] (§5.7) */ ],
    controllers: [ /* ControllerDefinition[] (§5.7) */ ],
    liveWidgets: [ /* LiveWidgetDefinition[] (§5.7) */ ],
    commands: [ /* CommandDefinition[] (§5.8) */ ],
  },
  /** Optional imperative hook, called once after registration. Returns a disposer. */
  activate?(api: ExtensionApi): void | (() => void),
});
```

Rules:
- `defineExtension` is an identity function for typing; the registry validates at registration (unique `id`, valid semver, compatible `apiVersion`, namespaced command types, no duplicate replacement within the same extension).
- An extension MUST import only from `@pixelmapper/extension-api`, `vue`, `pinia`(only for its *own* stores), and its own files. Importing `~/stores/*`, `~/utils/*` or `~/components/*` of the core is forbidden and enforced by a lint rule (§10).
- Each Nuxt layer contains a tiny Nuxt plugin `plugins/register.ts` that calls `registerExtension(manifest)`. For distribution bundles the bundle's default export is the manifest and the loader calls `registerExtension`.

### 5.2 Scopes

Scopes are the only state an extension sees. The core defines them in `@pixelmapper/extension-api`:

```ts
export interface ScopeMap {
  project:      ProjectInfo;            // global: id, name, bpm, requires
  selection:    SelectionInfo;          // global: selected fixture ids, scene node ids
  viewport:     ViewportInfo;           // global-ish: '2d' | '3d' | 'live' | 'design' | 'fixture-editor'
  fixture:      FixtureView;            // readonly view of one fixture (incl. kind)
  channel:      ChannelView;            // one channel: type, dmx address, capabilities, fine offsets
  signature:    SignatureTarget;        // { signature, fixtureId, channelRefs }
  modifier:     ModifierInstanceView;   // { id, plugin hash, manifest, params, generic fields }
  preset:       PresetView;
  liveWidget:   LiveWidgetView;
  livePage:     LivePageView;
}
export type ScopeName = keyof ScopeMap;
```

- Views are **readonly** projections (`DeepReadonly`), exposed as `Readonly<ShallowRef<T | undefined>>`. They MUST NOT expose class instances that allow mutation.
- Core components call `provideScope(name, ref)` at natural boundaries (a fixture row provides `fixture`; a channel control provides `channel` and `signature`; a modifier card provides `modifier`; …). `project`, `selection`, `viewport` are provided at the app root.
- Scopes are inherited through Vue's provide/inject chain. A nested `provideScope('fixture', …)` shadows the outer one.
- Extensions MUST NOT add new scope names (the set is part of the API contract and versioned with `apiVersion`).

API:

```ts
provideScope<K extends ScopeName>(name: K, value: Ref<ScopeMap[K] | undefined>): void;   // core only
useScope<K extends ScopeName>(name: K): Readonly<ShallowRef<ScopeMap[K] | undefined>>;
useExtensionContext(): ExtensionContext;

interface ExtensionContext {
  extensionId: string;                     // of the component's owning extension
  slotId: string | null;                   // e.g. 'properties/color:actions'
  scopes: { [K in ScopeName]?: Readonly<ShallowRef<ScopeMap[K] | undefined>> };
  run(command: Command): void;             // executes through history (undo, sync, persistence)
  commands: CoreCommandFactory;            // typed constructors of core commands (§5.8)
}
```

### 5.3 Slots

**Layout primitives** (in `app/components/primitives/`) each take a required `id` prop and render named extension slots around/in their content:

| Primitive | Slot positions | Typical use |
|---|---|---|
| `PmPanel` | `header`, `before`, `after` | Sidebars, panels, dialogs' main area |
| `PmPanelSection` | `before`, `after`, `actions`, `items` | Sections inside panels (e.g. "Color", "Position") |
| `PmToolbar` | `start`, `end` | Toolbars |
| `PmMenuGroup` | `items` | Context menus, add menus, library categories |
| `PmListItem` | `badges`, `actions` | Rows in lists/trees (fixture sidebar nodes, modifier list) |

**Slot id** = the `/`-joined `id`s of all enclosing primitives + `:` + position. Example: `PmPanel id="properties"` › `PmPanelSection id="color"` → `properties/color:actions`. Ids MUST be stable, kebab-case, semantic (not index-based).

A slot contribution:

```ts
interface SlotContribution {
  slot: string;                         // exact id or glob: 'properties/*:actions', 'library/**:items'
  when?: (scopes: ScopeSnapshot) => boolean;   // evaluated reactively; ScopeSnapshot = unwrapped readonly scope values
  component: Component;                 // receives no props; uses useExtensionContext()
  priority?: number;                    // higher first; default 0; ties broken by extension id
  menuItem?: MenuItemSpec;              // for ':items' positions in PmMenuGroup — label/icon/action without a component
}
```

Glob semantics: `*` matches one path segment, `**` any number of segments. `ExtensionSlot` resolves matching contributions with a memoized index (slot-id → contributions) built at registration; `when` is evaluated in a `computed`. An empty slot renders nothing (no wrapper DOM).

An explicit `<ExtensionSlot id="…" />` MAY be used where no primitive fits. Its id follows the same scheme.

### 5.4 Replaceable `pm.*` inputs

```ts
// in @pixelmapper/extension-api
export interface PmInputContracts {
  'pm.fader':       { props: FaderProps;       emits: FaderEmits };
  'pm.numberInput': { props: NumberInputProps; emits: NumberInputEmits };
  'pm.colorInput':  { props: ColorInputProps;  emits: ColorInputEmits };
  'pm.xyInput':     { props: XyInputProps;     emits: XyInputEmits };
  'pm.select':      { props: SelectProps;      emits: SelectEmits };     // enum params; segmented/compact select
  'pm.toggle':      { props: ToggleProps;      emits: ToggleEmits };
  'pm.curve':       { props: CurveProps;       emits: CurveEmits };      // curve params (control points)
  'pm.angle':       { props: AngleProps;       emits: AngleEmits };
  'pm.tapTempo':    { props: TapTempoProps;    emits: TapTempoEmits };
  'pm.button':      { props: TriggerButtonProps; emits: TriggerButtonEmits }; // live/trigger button, not shadcn Button
}
```

Every contract MUST include:
- `modelValue` (normalized where applicable) + `update:modelValue`,
- `scrubStart` / `scrubEnd` emits so the caller can coalesce history entries (one undo step per drag),
- `disabled`, `label?`, `size?: 'sm' | 'md' | 'lg'`.

Core defaults live in `app/components/pm/`. Core code MUST render these inputs only via `<Replaceable name="pm.fader" v-bind="…" />` or `useReplaceable('pm.fader')`, never by importing the default directly.

```ts
interface ReplacementContribution<N extends keyof PmInputContracts = keyof PmInputContracts> {
  replaces: N;
  component: Component;   // must satisfy PmInputContracts[N]
}
```

Conflict rule: if two **installed** extensions replace the same input, the host uses the per-user setting `replacements[name] = extensionId`; if unset, it shows a one-time choice dialog and uses the core default until chosen. Two first-party extensions in the repo replacing the same input is a **build error** (check script).

### 5.5 Live values

```ts
type LiveTarget =
  | { kind: 'channel'; fixtureId: FixtureId; channelIndex: number }          // rendered DMX value 0–255 (coarse)
  | { kind: 'signature'; fixtureId: FixtureId; signature: Signature }        // normalized tuple after modifiers
  | { kind: 'beat' }                                                         // { beatTime, bpm, phase }
  | { kind: 'universe'; universe: number };                                  // Uint8Array(512)

useLiveValue<T extends LiveTarget>(target: MaybeRef<T>, opts?: { fps?: number /* default 30, max 60 */ }): Readonly<ShallowRef<LiveValueOf<T> | undefined>>;
onFrame(cb: (frame: LiveFrame) => void, opts?: { targets?: LiveTarget[] }): void;   // auto-disposed on unmount
```

- Subscriptions are reference-counted per target in `app/utils/extensions/live-hub.ts`. Only subscribed targets are extracted from the frame message; with zero subscribers nothing is extracted.
- `useLiveValue` pauses when the component is unmounted or not visible (`IntersectionObserver` / `document.hidden`).
- `onFrame` callbacks receive non-reactive typed arrays and MUST NOT be used to drive Vue state at frame rate.

### 5.6 Fixture kinds

```ts
interface FixtureKindDefinition<Config> {
  id: string;                         // e.g. 'neopixel-strip' (unique across all extensions)
  version: string;                    // semver of the config format
  label: string; icon: string; description: string;
  configSchema: ParamSchema;          // same schema language as content plugins (§6.2)
  defaults(): Config;
  build(config: Config, ctx: KindBuildContext): KindBuildResult;   // pure, synchronous
  onHandleMove?(config: Config, handleId: string, pos: Vec2, ctx: KindBuildContext): Config;  // pure
  migrate?(config: unknown, fromVersion: string): Config;
  library: {
    category: string;                 // library grouping
    addForm?: Component;              // custom "add" form; default = ParamForm from configSchema
  };
  requiredWhenUsed?: boolean;         // default true
}

interface KindBuildResult {
  channels: ChannelDef[];             // canonical channel definitions (same as OFL-derived fixtures)
  beams: BeamDef[];                   // positions in fixture-local or world coordinates (flag)
  body: BodyPrimitive[];              // drawn by core in 2D and 3D
  handles: Handle[];                  // editable control points (edit mode)
  bounds: Rect;                       // for selection/hit-testing
}

type BodyPrimitive =
  | { type: 'polyline'; points: Vec2[]; closed?: boolean; width: number; style: BodyStyle }
  | { type: 'polygon';  points: Vec2[]; style: BodyStyle }
  | { type: 'circle';   center: Vec2; radius: number; style: BodyStyle }
  | { type: 'rect';     rect: Rect; radius?: number; style: BodyStyle }
  | { type: 'svg';      markup: string; headElementMap: Record<string, string>; rect: Rect };

interface Handle { id: string; pos: Vec2; role: 'vertex' | 'midpoint' | 'anchor' | 'rotate' }
```

- Persisted on the fixture: `fixture.kind = { id, version, config, compiled }`. `compiled` (the last `KindBuildResult`) is stored as a **cache** for fast loading; it is recomputed when `version` changes or the extension's `build` output hash differs.
- Curves are sampled **inside `build()`** (e.g. Catmull-Rom → dense polyline). The core never knows about curve types.
- Edit mode is generic: second click on a selected fixture with `handles.length > 0` enters edit mode; the canvas draws handles and hit-tests them; drags call `onHandleMove` and commit via a kind command.
- 3D: `polyline` → substrate/tube (generalized `strip-substrates.ts`), `svg` → plane (generalized `svg-planes.ts`), `circle`/`rect`/`polygon` → flat shapes. `fixture-adapter.ts` MUST NOT branch on kind ids.

### 5.7 Connectors, controllers, live widgets

```ts
interface ConnectorDefinition {
  type: string;                        // 'artnet', 'serial', …
  label: string; icon: string; description: string;
  direction: 'output' | 'input';
  create(id: string): Connector;       // implements the existing BaseConnector contract
  fromConfig(id: string, config: Record<string, unknown>): Connector;
  settings?: Component;                // config UI, rendered in the connections page
}

interface ControllerDefinition {
  id: string; label: string; description: string;
  matches(port: MidiPortInfo): boolean;   // auto-detection
  createDriver(): ControllerDriver;       // existing BaseControllerDriver contract
  layoutSvg?: string;                     // for the controller twin widget
}

interface LiveWidgetDefinition {
  type: string;                        // namespaced if not core: '<extensionId>/<name>'
  label: string; icon: string;
  component: Component;                // gets liveWidget scope
  defaultConfig(): Record<string, unknown>;
  mappingTypes?: LiveMappingType[];
}
```

Core live widgets after deduplication: `button` (`pm.button`), `slider` (`pm.fader`), `xy` (`pm.xyInput`), `color` (`pm.colorInput`), `label`, `beat` (`pm.tapTempo`), `fixture-preview`. The `controller-twin` widget moves into the controller extensions. An unknown widget type renders a placeholder ("Widget from extension X not installed") and does **not** create a dependency.

### 5.8 Commands

```ts
interface CommandDefinition {
  type: `${string}/${string}`;         // '<extensionId>/<name>', validated against the owning extension id
  fromPayload(payload: unknown, ctx: ExtensionReplayContext): Command;
}
```

- Extension commands implement the existing `SerializableCommand` (`commandType`, `toPayload`, `execute`, `undo`) and are registered into the same registry as core commands (`registerCommand`).
- Extension commands MAY only mutate state owned by that extension: fixtures whose `kind.id` belongs to it, and its namespaced extension data.
- **Extension data:** the core provides `SetExtensionDataCommand({ owner: 'fixture' | 'project' | 'liveWidget', ownerId, extensionId, key, value })` storing JSON at `owner.extensionData[extensionId][key]`. Extensions SHOULD use it instead of custom commands when a key/value write suffices.
- **Core command factory** available to extensions (`ctx.commands`): `setChannelValues`, `setFixtureKindConfig({ fixtureId, config })` (rebuilds and stores `compiled`), `addFixture({ kind?, ofl?, position })`, `setExtensionData`, `rename`, `move`, `rotate`. The list is part of the API and versioned.
- **Requires bookkeeping:** after executing a command whose type is owned by extension E (or `setFixtureKindConfig` / `addFixture` for a kind of E), the host adds E to `project.requires`. `requires` is recomputed from the current state on every snapshot write: E stays if any fixture uses one of its kinds, or any `extensionData[E]` exists. When E is removed from `requires`, the host MUST immediately write a snapshot so that the change log after the snapshot contains no E commands.

### 5.9 Distribution, loading, installation

- `packages/extension-build` provides `defineExtensionBuild({ entry })`: Vite library mode, ESM output `dist/<id>/<version>/index.js` + `style.css` + `extension.json` (serialized manifest metadata without components: id, version, apiVersion, displayName, description, contributes summary incl. kind ids and `requiredWhenUsed`).
- Externals: `vue`, `pinia`, `@pixelmapper/extension-api` are rewritten to `globalThis.__PIXELMAPPER_SHARED__.{vue,pinia,api}`, which the host populates in `app/utils/extensions/shared-globals.ts` **before** loading any bundle. Bundles MUST NOT contain their own Vue.
- CSS: the bundle ships its own Tailwind output scanned from its own sources and MUST use the host's CSS custom properties (theme tokens), never hard-coded colors.
- Storage: Supabase table `extensions` (id, version, manifest JSON, publisher, created_at) + bucket `extensions/<id>/<version>/…`. Installation list per user: `user_extensions (user_id, extension_id, version_range, installed_at)`. Local cache: IndexedDB (`pm-extensions` store: bundle JS + CSS by `id@version`). Tauri: app data dir.
- Install flow: dialog shows id, publisher, version and the warning *"Extensions run with full access to your projects and this app."* → download → cache → `location.reload()`.
- Boot order: shared globals → first-party layer extensions (already in bundle) → cached installed bundles (`import()` from blob URL) → **then** project loading (so `requires` can be checked).
- Distribution set (included via `extends` in `nuxt.config.ts`): `color-picker`, `pan-tilt`, `live-widgets`, `connector-artnet`. All other first-party extensions are built as bundles into a catalog and installed on demand (`neopixel-strip`, `connector-serial`, `connector-websocket`, `connector-espnow`, `controller-akai-*`).

### 5.10 Missing / incompatible required extensions

On project load, before deserializing fixtures: for each `requires` entry check installed extensions and `semver.satisfies`. If any are missing or incompatible → `MissingExtensionDialog` (list, install/update buttons, "Back to projects"). The project is **not** opened. After installing → reload → open.

---

## 6. Content-plugin specification (modifiers)

### 6.1 Package

```
plugins/<name>/
├── manifest.json
├── modifier.ts        # AssemblyScript, compiled to modifier.wasm
└── ui.ts              # optional custom panel (plain TS)
```

A built package (in storage, cache, exports) is:

```ts
interface ContentPluginPackage {
  hash: string;                // 'sha256:<hex>' over canonical(manifest) ‖ wasm ‖ uiJs?
  manifest: ContentPluginManifest;
  wasm: Uint8Array;
  uiJs?: string;               // transpiled ui.ts
  source: Record<string, string>;   // 'modifier.ts', 'ui.ts' — kept for AI editing and recompile-verification; not hashed
  toolchain: string;           // e.g. 'pm-toolchain@1.0.0+asc@0.28.x' (exact)
}
```

`canonical(manifest)` = JSON with sorted keys, no whitespace, `hash` field omitted.

### 6.2 Manifest

```jsonc
{
  "schema": 1,
  "kind": "modifier",                       // later: "shader", "visual" (reserved, not implemented)
  "alias": "@pixelmapper/waveform",
  "name": "Waveform",
  "version": "1.0.0",
  "apiVersion": "^1.0.0",                   // plugin ABI/SDK range
  "description": "Periodic waveform (sine, square, triangle, …) over the modifier phase.",
  "signatures": ["scalar"],                 // which signatures this modifier supports
  "output": "bipolar",                      // "bipolar": [-1,1] modulation scaled by strength | "absolute": target value [0,1] mixed by blend mode
  "params": [
    { "key": "shape", "type": "enum", "options": ["sine","square","triangle","sawtooth","bounce","ramp","smooth"], "default": "sine", "label": "Shape" },
    { "key": "pulseWidth", "type": "number", "min": 0, "max": 1, "default": 0.5, "label": "Width", "ui": "pm.fader" }
  ],
  "ui": { "panel": "ui.ts", "placement": "below-params" }   // optional
}
```

**Param schema** (shared with fixture-kind `configSchema`):

| `type` | Extra fields | Wire encoding (f32 slots) | Default input |
|---|---|---|---|
| `number` | `min`, `max`, `step?`, `unit?` | 1 | `pm.fader` |
| `int` | `min`, `max` | 1 | `pm.numberInput` |
| `bool` | — | 1 (0/1) | `pm.toggle` |
| `enum` | `options: string[]` | 1 (index) | `pm.select` |
| `color` | — | 3 (linear RGB 0–1) | `pm.colorInput` |
| `angle` | — | 1 (radians) | `pm.angle` |
| `point` | — | 2 (normalized 0–1) | `pm.xyInput` |
| `curve` | `default: CurvePoint[]` | 128 (host-sampled LUT, 0–1) | `pm.curve` |

Common fields: `key` (camelCase, unique), `label`, `default`, `description?`, `ui?` (override the default `pm.*` input), `group?` (visual grouping). The **params block** is the concatenation of all params' f32 slots in manifest order.

### 6.3 Host-owned instance fields

Every modifier instance (persisted in the project) has generic fields the host owns; the plugin never re-implements them:

```ts
interface ModifierInstance {
  id: string;
  plugin: string;                         // content hash
  signature: Signature;                   // one of manifest.signatures
  targetChannels?: ChannelType[];         // scalar only: which channel types (e.g. ['DIMMER'])
  targetFixtureIds?: FixtureId[];         // undefined = all
  blendMode: 'add' | 'override' | 'multiply' | 'max' | 'min';
  strength: number;                       // 0–1
  speed: SpeedConfig;                     // time | beat | infinite (existing type)
  direction: EffectDirection;             // spatial phase distribution (existing type)
  originX: number; originY: number; angle: number;
  fanning: number; reverse: boolean;
  params: Record<string, ParamValue>;
}
```

The project stores `modifiers: ModifierInstance[]` (replaces `activeEffects`). Presets/pinned modifiers snapshot `ModifierInstance` (replaces `PresetModifierSnapshot` with its per-type fields).

### 6.4 Signature mapping (core, Rust: `rs-engine/core/src/signatures.rs`)

For each fixture and modifier instance the core resolves **signature targets**:

- `scalar`: every channel of the fixture whose type ∈ `targetChannels`. Normalized value ↔ DMX via `range_min/range_max` and 8/16/24-bit fine offsets.
- `rgb`: the fixture's color system, chosen in this order: RGB(+W/A/UV) intensity channels → CMY → color wheel. Write path: RGBW: `w = min(r,g,b)`, subtract from RGB; RGBA: amber derived from red/green ratio (approximation, documented in code); CMY: `1 − rgb`; color wheel: nearest wheel slot by perceptual distance (slot colors from layout data). Read path (base value) is the inverse where defined, otherwise the last written value.
- `panTilt`: PAN and TILT (+fine) channels, normalized within the fixture's movement range limits.

A beam/head is one **sample**. Fixtures without a matching channel for the signature are skipped.

### 6.5 Render pipeline (per frame, Rust core)

1. `beatTime` = piecewise integral of BPM since `clockEpoch` (BPM changes are timestamped and synced, so all clients compute the same value).
2. Base values: chasers/base/overrides → `base` per signature target (normalized).
3. For each modifier instance in list order:
   1. Collect samples (targets × heads) and compute per sample: normalized position, group index/count, head index, `seed` (stable hash of fixture id + head + instance id), `phase` = speed phase + spatial offset (direction/origin/angle/fanning/reverse — logic moved from today's `effects.rs` into `phase.rs`).
   2. `runtime.render(instance, ctx, samples, out)`.
   3. Blend `out` into the working values: `bipolar` → `v = base + out × strength` (per component); `absolute` → mix per `blendMode` with `strength` as amount.
4. Map working values back to DMX (§6.4), clamp, write the DMX buffer.

### 6.6 ABI v1 (AssemblyScript exports)

The module MUST be compiled by `@pixelmapper/plugin-toolchain` with **imported memory** (`--importMemory`, host-provided `WebAssembly.Memory` with `maximum` = 256 pages = 16 MiB).

Exports:

```ts
export function pm_abi_version(): i32;                       // returns 1
export function pm_alloc(bytes: i32): usize;                 // host uses for ctx/params/sample/out buffers
export function pm_prepare(params: usize, paramCount: i32): void;   // f32[paramCount]; called on load and on param change
export function pm_render(ctx: usize, samples: usize, count: i32, out: usize): void;
```

Layouts (all little-endian f32, 4-byte aligned):

```
FrameCtx  (16 × f32):  timeMs, beatTime, bpm, phaseSpeed, arity, seedLo, seedHi, reserved[9]
Sample    (16 × f32):  x, y, phase, groupIndex, groupCount, headIndex, headCount, seed,
                       base0, base1, base2, reserved[5]
out       (count × arity × f32)
```

Allowed imports (anything else ⇒ rejected at validation): `env.abort` (AssemblyScript), `env.memory`, `pm.log(ptr, len)` (rate-limited, dev only), `pm.budget()` (injected by instrumentation, see §6.7). No WASI, no `Date`, no `Math.random` (the SDK provides `hash01(seed, i)`, `noise1/2/3`, `Mathf` wrappers).

The SDK (`packages/plugin-sdk/assembly/index.ts`) hides the ABI behind:

```ts
export abstract class Modifier {
  prepare(params: Params): void {}
  abstract render(ctx: Frame, s: Sample, out: Out): void;   // per sample; the SDK loops in pm_render
}
// usage in modifier.ts:
class Waveform extends Modifier { render(ctx: Frame, s: Sample, out: Out): void { out.set(0, Mathf.sin(s.phase * TAU)); } }
export const pm = register(new Waveform());
```

### 6.7 Sandbox & robustness

- **Instrumentation:** the toolchain injects a call to `pm.budget()` at every loop back-edge and function entry. The host's `budget()` counts calls per `pm_render` and throws (trap) beyond a limit derived from `count` (default `50_000 + 2_000 × count`). A trap disables the instance for the session and shows a toast.
- **Validation harness** (`plugin-toolchain/validate`): instantiate with a synthetic layout (64 fixtures × up to 8 heads, all signatures declared), render 240 frames (4 s @ 60 fps) across varied params; reject on: unknown imports, trap, NaN/∞, `absolute` outputs outside [0,1] or `bipolar` outside [−1,1] (beyond 1e-4 tolerance), non-determinism (render frame 120 twice in fresh instances → bitwise equal), > 2 ms median per frame for 512 samples. Warn on: constant output.
- **Import from others** requires `source`; the host recompiles with the pinned toolchain and verifies the hash. Binary-only imports are rejected.
- **Watchdog:** the worker posts a heartbeat with every frame. If the main thread receives none for 1 000 ms, it terminates and respawns the worker, re-sends state, and marks every non-built-in plugin as *suspended* (UI shows "suspended — click to re-enable"). Re-enabling resumes plugins one at a time.

### 6.8 Runtime integration

Rust (`rs-engine/core/src/runtime.rs`):

```rust
// ── Modifier runtime ────────────────────────────
pub trait ModifierRuntime {
    fn prepare(&mut self, instance: u32, plugin: &PluginRef, params: &[f32]) -> Result<(), RuntimeError>;
    fn render(&mut self, instance: u32, ctx: &FrameCtx, samples: &[Sample], arity: usize, out: &mut [f32]) -> Result<(), RuntimeError>;
}
```

Browser implementation `JsModifierRuntime` uses `#[wasm_bindgen(module = "/…/plugin-bridge.js")] extern "C"` functions implemented in `app/utils/plugins/worker-bridge.ts`, which owns a `Map<hash, WebAssembly.Module>` and `Map<instance, { instance, memory, buffers }>` and copies `samples`/`out` between the core's memory and the plugin's memory. Worker messages: `plugin-load { hash, wasm }`, `plugin-unload { hash }`, `modifiers-sync { packet }` (replaces `TYPE_FX_BIN`).

**Previews** (modifier cards, thumbnails, param UI) instantiate the same `.wasm` on the main thread via `app/utils/plugins/preview-pool.ts` and call `pm_render` on preview sample grids. The TS effect classes (`app/utils/engine/effects/*`) and their `render`/`getPreviewCSS` duplicates are deleted.

### 6.9 Custom panel (iframe)

```ts
// ui.ts
export function mount(el: HTMLElement, api: PanelApi): () => void;   // returns unmount

interface PanelApi {
  params: Readonly<Record<string, ParamValue>>;
  onParams(cb: (p: Record<string, ParamValue>) => void): void;
  setParam(key: string, value: ParamValue): void;
  beginScrub(): void; endScrub(): void;            // history coalescing
  onFrame(cb: (f: { timeMs: number; beatTime: number; bpm: number }) => void): void;
  render(samples: Float32Array, count: number): Float32Array;   // runs the plugin's own wasm for previews
  theme: Record<string, string>;                   // resolved CSS custom properties
}
```

- `PluginIframePanel.vue` creates `<iframe sandbox="allow-scripts" srcdoc="…">` (no `allow-same-origin`), injects the bridge runtime + theme variables + the plugin's `uiJs`, and proxies `PanelApi` over `postMessage` with message validation (schema-checked, origin `null`, per-instance channel id).
- `ui.ts` is transpiled with `sucrase` (TS → JS) in the browser; no bundling, no imports allowed (validated).

### 6.10 Storage & sync

- Supabase migration `005_content_plugins.sql`: table `content_plugins (hash text primary key, alias text, name text, version text, kind text, manifest jsonb, source jsonb, toolchain text, owner_id uuid, visibility text check in ('private','project','public'), project_id uuid null, created_at timestamptz)`; bucket `content-plugins/<hash>.wasm`, `<hash>.ui.js`. RLS: select if public, owner, or collaborator of `project_id`; insert by authenticated owner; **no update** (immutable); no delete in v1.
- Client cache: IndexedDB store `pm-content-plugins` keyed by hash.
- Built-ins: `plugins/*` are compiled at build time by `scripts/build-plugins.ts` into `public/plugins/<hash>.{wasm,json}` + a generated `app/utils/plugins/builtin-index.ts` (alias → hash). They are never uploaded.
- Live collaboration: creating/importing a plugin uploads it, then the existing modifier ops carry only the hash. A receiving client resolves the hash via cache → Supabase → (Tauri) export bundle.
- Project export: `.pmproject` (zip) = project JSON + `plugins/<hash>.*` for all referenced hashes + `extensions/<id>@<version>/…` for all `requires`.

---

## 7. Persistence changes (schema v2)

- `ProjectSnapshot.schemaVersion = 2`; v1 is rejected (D24).
- `activeEffects` → `modifiers: ModifierInstance[]`.
- `Fixture.stripConfig` → `Fixture.kind?: { id, version, config, compiled }`.
- New `Fixture.extensionData?`, `Project.extensionData?`, `LiveWidget.extensionData?`: `Record<extensionId, Record<string, Json>>`.
- New `Project.requires: { id: string; version: string }[]`.
- Removed: `ProjectSnapshot.connectors` (D18), all `*Params` fields of `Effect`, `PresetModifierSnapshot` per-type fields.

---

## 8. Consequences

**Positive**
- One modifier implementation (AS) instead of two (TS + Rust); built-ins double as AI templates.
- Generated modifiers run deterministically on every client and can be shared by hash.
- NeoPixel-specific code leaves the core; the core gets generic primitives that also serve future kinds.
- Controls are defined once (`pm.*`) and appear everywhere.
- Extension authors (and agents) get one typed API file to work against.

**Negative / costs**
- Large refactor of `engine-store.ts`, `effects.rs`, `engine.rs`, the canvas, presets and live ops.
- WASM boundary per modifier per frame (batched; acceptable for thousands of samples).
- Trusted extensions can do anything — the install dialog is the only protection in v1 (signing later).
- Existing projects are lost (clean break).
- ESP32 on-device effect rendering and the `ffi` crate are removed; ESP connectors depend on firmware that accepts streamed frames.

---

## 9. Out of scope (explicitly)

- AI generation loop, model/provider integration (Codex/ChatGPT), prompt design.
- Shaders and generated visuals (only `kind: "shader" | "visual"` is reserved in manifests).
- Tauri port (only the `ModifierRuntime` seam and file-system storage hooks are prepared).
- Firmware changes in `pio*/`.
- Extension signing / marketplace UI beyond install-by-id/link.

---

## 10. Enforcement

- ESLint `no-restricted-imports` for `extensions/**`: only `@pixelmapper/extension-api`, `vue`, `pinia`, relative imports.
- `scripts/check-extensions.ts` (CI + `bun run check:extensions`): unique ids, namespaced command types, no duplicate replacements among first-party extensions, `apiVersion` compatibility.
- `scripts/build-plugins.ts` fails the build if any built-in plugin fails validation.
- Vitest suites: slot matching, scope inheritance, requires computation, param encoding, signature mapping (Rust `cargo test`), plugin validation harness, migrate functions.

---

## Amendments

Deviations found while implementing the plan. Each names the plan task.

- **A1 (P0.4) — native cargo builds.** `rs-engine/canvas` only compiles for `wasm32` (WebGL via femtovg). The workspace sets `default-members = ["core"]` so `cargo build` / `cargo test` in `rs-engine/` work natively; canvas is built with `wasm-pack`. Removing `rs-engine/ffi` also breaks the tag-triggered firmware CI (`pio/` still links it) until the firmware accepts streamed frames (§8).
- **A2 (P1.3) — extra core command.** `CoreCommandFactory` additionally exposes `setChannelRange({ fixtureId, channelIndex, min, max })` (needed by the pan-tilt movement range, plan P2.2). `setFixtureKindConfig`, `addFixture` and `setExtensionData` throw "not available yet" until plan P5.
- **A3 (P1.3) — legacy modifier ids.** Until the modifier rebuild (P3), `ModifierInstanceView.plugin` is `'builtin:<type>'` (`waveform`, `noise`, `sequencer`, `color-adjust`, `displacement`, `speed-curve`) and `strength` is normalized from the legacy 0–100 %.
- **A4 (P1.6) — context menus.** The global context menu renders at the app root, so openers pass `{ id, scopes }` to `openMenu`; the menu re-provides the opener's non-global scopes and renders `PmMenuGroup` → slot `context-menu/<id>:items` (`fixture`, `group`, `channel`, `preset`).
- **A5 (P1.6) — primitive placement.** Primitives auto-place their slots; callers with custom markup list positions in a `manual` prop and render the slot-prop outlets (`Actions`, `Badges`, …) themselves. `PmPanelSection` renders `before`/`after` as siblings of its root unless placed manually (the properties sidebar places them inside its scroll area). `PmMenuGroup as="fragment"` renders no root element.
- **A6 (P1.6/P1.9) — registration order.** `registerExtension` is also exported from the API package. Calls made before the host installed its shared globals are queued in `globalThis.__PIXELMAPPER_PENDING__` and drained at boot, so layer plugin order does not matter.
- **A7 (P1.7) — contract additions.** `FaderProps` gains optional presentation hints (`variant: 'track' | 'box'`, `icon`, `fill`, `ringColor`) so the property-sidebar box and the live slider share `pm.fader`; replacements MAY ignore them. `NumberInputEmits` gains `commit: [value]` (final value on drag end / Enter / blur). `TapTempoProps` gains `color`.
- **A8 (P1.7) — raw DMX faders stay core-internal.** The universe inspector's `DmxChannelFader` writes the DOM directly every frame for many channels; it is a diagnostic view, not a domain input, and is not routed through `pm.fader`.
- **A9 (P2.2) — API additions for multi-fixture extensions.** `ExtensionContext` gains `getFixture(id)` (readonly view of any fixture, e.g. every id of the `selection` scope) and `preview: OutputPreview` (`setChannel(fixtureId, channelIndex, dmx)` / `clear()`: local, temporary DMX overrides — not persisted, not synced, no history; auto-cleared on unmount). `CoreCommandFactory` gains `setChannelRanges({ changes, description? })` (several channels, one undo step). `ChannelView` gains `isFine`. The properties sidebar provides a section-level `signature` scope (pan/tilt of the first moving fixture) in the position tab. The pan-tilt movement range previews via `preview` and writes ranges only on Apply (it no longer live-writes raw channel ranges).
- **A10 (P2.2) — scope reactivity.** Fixtures are plain class instances; projections additionally depend on a model tick (`app/utils/extensions/model-tick.ts`) that the engine store bumps on layout/channel revision or scene changes.
- **A11 (P2.2) — contract typing.** `pm.*` props interfaces declare `modelValue` concretely on a non-generic `BaseInputProps` (Vue's SFC compiler mis-resolves generic type arguments when deriving runtime props). `CommonInputProps<T>` remains as a type alias. `MovementRangeSlider` stays in core as well (used by `ChannelLimitsDialog`); the extension carries its own copy.
- **A12 (P2.4) — no `live-widgets` extension.** After the live-widget dedupe (P2.3) every remaining widget type is core (`button`, `slider`, `xy`, `color`, `label`, `beat`, `fixture-preview`); `controller-twin` moves into the controller extensions (P6.4). `extensions/live-widgets` is therefore not created and is removed from the distribution set (§5.9), which becomes `color-picker`, `pan-tilt`, `connector-artnet`. Extension live widgets are registered through `contributes.liveWidgets` and resolved by `app/utils/live/widget-registry.ts`; extension `icon` names resolve against a small lucide map (fallback: puzzle).
- **A13 (P3.1–P3.3) — modifier semantics and ABI details.**
  - *Bipolar mapping:* the host maps `v = base + strength × (out − 1) / 2` (out = 1 lands on the base, −1 on base − strength), preserving the former deliberate "peak = base" behavior (a red fixture pulses red↔black, never red↔white) instead of §6.5's `base + out × strength`. `add` blending applies `prev + (v − base)`; `override`, `multiply`, `max`, `min` as before. Absolute outputs: `mixed = blendOp(prev, out)`, then `prev + (mixed − prev) × strength`.
  - *Validation range:* `bipolar` outputs are checked against [−2, 2] (the waveform offset shifts the wave by up to ±1); `absolute` stays [0, 1].
  - *ABI v1 layout:* `FrameCtx[7]` = instance strength (0–1, informational, e.g. for the waveform floor). Sample `phase` is in cycles (1.0 = one cycle); `base0..2` are the working values before this modifier (normalized); `Sample[11..12]` = channel-type seed (lo/hi 16 bit) for scalar samples; `seed` is a 24-bit integer. `groupIndex`/`groupCount` are the rank among targeted fixtures / their count.
  - *Registration:* modifiers call `register(new X())` as a top-level statement (AssemblyScript cannot export class-typed globals); the toolchain compiles `modifier.ts` as a second entry file because only entry files run top-level code.
  - *Built-in deviations* (goldens cover the common paths exactly): color-adjust uses the common spatial phase (the old color effect used a quarter-wave spatial factor); sequencer flow uses the real BPM (the old code assumed 120 in beat mode); scatter ranks within the targeted fixtures.
