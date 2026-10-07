# Implementation Plan — Extension & Content-Plugin System

Executes [ADR 0001](adr/0001-extension-and-content-plugin-system.md). Read the ADR first; it is the spec. This plan is the order of work.

## How to work through this plan

- Work **phase by phase, task by task**, in order. Each phase leaves the app building and usable (`bun run dev`, `bun run build`).
- Tick the checkbox of a task when its acceptance criteria hold. Commit per task (or small group of tasks) with a message referencing the task id, e.g. `feat(ext): P1.3 scope system`.
- After each phase: run `bun run typecheck`, `bun run test`, `cargo test` (in `rs-engine/`), `bun run build`; update `architecture.md` and the sub-docs listed in the phase's *Docs* item.
- Follow `AGENTS.md` (Bun, TS only, comments on all new code, `<script setup lang="ts">`, kebab-case files, PascalCase components, Rust section-header comments).
- If the code contradicts an assumption in this plan, prefer the ADR's intent, document the deviation in the ADR under a new "Amendments" section, and continue.
- **Do not** touch out-of-scope areas (ADR §9).

Legend: **Files** = main files to create (+) / change (~) / delete (−). **Done when** = acceptance criteria.

---

## Phase 0 — Tooling foundation

- [x] **P0.1 Bun workspaces.** Add `"workspaces": ["packages/*", "extensions/*", "plugins/*"]` to root `package.json`. Create empty packages `packages/extension-api`, `packages/extension-build`, `packages/plugin-sdk`, `packages/plugin-toolchain` (each with `package.json` named `@pixelmapper/<name>`, `tsconfig.json`, `src/index.ts`).
  *Done when:* `bun install` succeeds; `import {} from '@pixelmapper/extension-api'` resolves in `app/`.
- [x] **P0.2 Vitest.** Add `vitest` + `@vue/test-utils` + `happy-dom`; `vitest.config.ts` with Nuxt aliases (`~`, `@`); script `"test": "vitest run"`. Existing `alignment-guides.test.ts` and `photometry.test.ts` must run green.
- [x] **P0.3 Typecheck script.** `"typecheck": "nuxt typecheck"` (add `vue-tsc` if needed). Fix nothing else yet; record the baseline error count in the commit message.
- [x] **P0.4 Remove ESP32 FFI.** Delete `rs-engine/ffi/`, remove it from `rs-engine/Cargo.toml` workspace members, remove FFI mentions from `AGENTS.md` commands. Leave `pio*/` untouched.
  *Done when:* `cargo build` and `cargo test` in `rs-engine/` succeed.
- [x] **P0.5 Docs.** In `architecture.md` mark the ESP32 rendering target as removed (already done by the ADR rewrite; verify).

---

## Phase 1 — Extension host foundation (no behavior change)

Goal: the extension machinery exists and the existing UI is rebuilt from layout primitives, but nothing is extracted yet.

- [x] **P1.1 `@pixelmapper/extension-api` types.** + `packages/extension-api/src/{index,manifest,scopes,slots,replaceables,live,kinds,connectors,commands,params}.ts`. Contains **only** types, `define*` identity helpers (`defineExtension`, `defineFixtureKind`, `defineConnector`, `defineController`, `defineLiveWidget`), and the API surface of composables as *declared* functions that read their implementation from `globalThis.__PIXELMAPPER_SHARED__.api` (so bundles never contain host code). Full TSDoc on every export (ADR D25).
  *Done when:* types from ADR §5 compile; `bun run typecheck` in the package passes.
- [x] **P1.2 Registry.** + `app/utils/extensions/registry.ts` (`registerExtension`, `getExtensions`, `getContributions(kind)`, validation per ADR §5.1), + `registry.test.ts`.
  *Done when:* tests cover duplicate id, bad semver, incompatible `apiVersion`, un-namespaced command type → rejected with readable errors.
- [x] **P1.3 Scope system.** + `app/composables/extensions/{provide-scope,use-scope,use-extension-context}.ts`. Provide `project`, `selection`, `viewport` at the root (`app.vue` / project layout) from `engine-store` via readonly projections (`app/utils/extensions/scope-views.ts`).
  *Done when:* Vitest: nested providers shadow, inheritance across 3 levels, views are readonly (mutation attempt throws in dev).
- [x] **P1.4 Slots.** + `app/components/extension-host/ExtensionSlot.vue`, + `app/utils/extensions/slot-matching.ts` (glob `*`/`**`, memoized index, priority + id tie-break), + `slot-path.ts` (provide/inject of the primitive id path). Tests for matching and ordering.
- [x] **P1.5 Layout primitives.** + `app/components/primitives/{PmPanel,PmPanelSection,PmToolbar,PmMenuGroup,PmListItem}.vue` with required `id` prop and auto-slots per ADR §5.3. Styling: reuse the current visual style of the components they replace.
- [x] **P1.6 Migrate core UI onto primitives.** Rebuild at least these with primitives and stable ids (keep behavior identical):
  - `FixturePropertiesSidebar.vue` → `properties` panel; channel sections → `properties/<section>` (`color`, `position`, `beam`, `intensity`, `other` — derive from `use-channel-sections.ts`).
  - `FixtureSidebar.vue` / `FixtureSidebarNode.vue` → `scene` panel, nodes as `PmListItem id="fixture"`.
  - `FixtureLibraryBrowser.vue` / `AddFixtureDialog.vue` → `library` panel, categories as `PmMenuGroup id="<category>"`.
  - `ChaserModifiersList.vue` → `modifiers` panel, items as `PmListItem id="modifier"`.
  - `PresetsSidebar.vue` → `presets`; `LiveToolbar.vue` → `PmToolbar id="live"`; `AppHeader.vue` → `PmToolbar id="header"`; `GlobalContextMenu.vue` groups → `PmMenuGroup`.
  - Provide scopes at the matching boundaries: `fixture` (fixture rows, property sidebar for single selection), `channel` + `signature` (channel controls), `modifier` (modifier items), `preset`, `liveWidget`, `livePage`.
  *Done when:* app looks and behaves as before; a dev-only debug extension (`extensions/_debug-slots`, excluded from production) that renders a small label into `**:actions` shows labels in all migrated places with correct slot ids.
- [x] **P1.7 `pm.*` contracts and defaults.** Define contracts (ADR §5.4) in the API package. + `app/components/pm/` defaults: `PmFader` (from `DmxChannelFader.vue`/`FixturePropertyControl` slider logic), `PmNumberInput` (wrap `DraggableNumberInput`), `PmColorInput` (minimal: 3 faders + hex field), `PmXyInput` (minimal: 2 faders), `PmSelect`, `PmToggle`, `PmCurve` (from `SpeedCurveEditor` curve logic), `PmAngle`, `PmTapTempo` (from `LiveBeatWidget`), `PmButton`. + `Replaceable.vue`, `use-replaceable.ts`, replacement conflict resolution (per-user setting in `localStorage` for now; choice dialog).
  *Done when:* every core call site of these inputs goes through `Replaceable`; a test extension replacing `pm.fader` changes the sidebar fader and the live slider.
- [x] **P1.8 Live-value channel.** + `app/utils/extensions/live-hub.ts` (ref-counted subscriptions, extraction from the worker `frame` message), + `use-live-value.ts`, `on-frame.ts`. Initially `channel`, `universe`, `beat` targets; `signature` arrives in P3.
  *Done when:* Vitest for ref counting; with no subscribers no extraction work happens (assert via spy).
- [x] **P1.9 Shared globals + first-party registration.** + `app/utils/extensions/shared-globals.ts` (populates `__PIXELMAPPER_SHARED__`), + Nuxt plugin `app/plugins/00.extensions.client.ts` (boot order ADR §5.9, steps 1–2). Add `extends: []` list in `nuxt.config.ts` for first-party layers.
- [x] **P1.10 Lint enforcement.** ESLint `no-restricted-imports` for `extensions/**` (ADR §10) and `scripts/check-extensions.ts`.
- [x] **P1.11 Docs.** + `architecture/extensions.md` (how slots, scopes, replaceables, live values work, with a minimal example extension). Update `architecture/ui-history.md` (primitives).

---

## Phase 2 — First extensions: color picker, pan/tilt, live widgets

Goal: prove the API by extracting UI-only features.

- [x] **P2.1 `extensions/color-picker`.** Move `FixtureColorPicker.vue` (and `ColorEditor.vue` parts used for picking) into the layer; rewrite to the `pm.colorInput` contract (props/emits only, `useExtensionContext` for anything else); contribute `replaces: 'pm.colorInput'`. Remove direct usages from `FixturePropertyControl*.vue`.
  *Done when:* with the extension: full picker in properties sidebar, live color widget, and (later) color params; without it (remove from `extends`): RGB faders + hex, no errors.
- [x] **P2.2 `extensions/pan-tilt`.** Move `FixturePanTiltPad.vue` → replaces `pm.xyInput`. Move `FixtureMovementRange.vue`, `MovementRangePad.vue`, `MovementRangeSlider.vue` → slot contribution `properties/position:after` with `when: s => !!s.signature && s.signature.signature === 'panTilt'`, writing via core commands (`set-channel-range-command`).
  *Done when:* same with/without check as P2.1.
- [x] **P2.3 Live widget dedupe.** Core widgets per ADR §5.7 (`button`, `slider`, `xy`, `color`, `label`, `beat`, `fixture-preview`) rendering `pm.*` inputs; delete `LiveColorWheelWidget.vue` and `LiveXYPadWidget.vue` (replaced by `color`/`xy` using `pm.colorInput`/`pm.xyInput`). Map old type names `color-wheel`→`color`, `xy-pad`→`xy` (no persistence migration needed — clean break comes in P3, but keep the names consistent from now on). Add `LiveWidgetDefinition` registry so extensions can add widget types; unknown types render a placeholder.
- [x] **P2.4 `extensions/live-widgets`.** Holds any non-core widget kinds that remain (if none remain after P2.3, skip creating it and remove it from the ADR distribution set via an amendment).
- [x] **P2.5 Docs.** `architecture/extensions.md`: add color-picker as the reference example.

---

## Phase 3 — Modifier rebuild (AssemblyScript + ModifierRuntime)

Goal: one modifier pipeline; built-ins in AS; TS/Rust effect duplicates gone. **This phase introduces schema v2 (clean break).**

### 3A — SDK and toolchain
- [ ] **P3.1 `@pixelmapper/plugin-sdk`.** AssemblyScript package: `assembly/index.ts` (`Modifier`, `Frame`, `Sample`, `Out`, `Params`, `register`, ABI exports per ADR §6.6), `assembly/math.ts` (`TAU`, `hash01`, `noise1/2/3` — port Perlin/value noise from `rs-engine/core/src/effects.rs` / `app/utils/engine/effects/noise-math.ts`), `assembly/curves.ts` (LUT sampling), `assembly/color.ts` (HSV↔RGB, port from `engine.rs` `rgb_to_hsl`/`hsl_to_rgb`).
- [ ] **P3.2 `@pixelmapper/plugin-toolchain`.** Isomorphic (Bun + browser), pinned exact `assemblyscript` version:
  - `compile({ files }) → { wasm, diagnostics }` (flags: `-O3 --importMemory --maximumMemory 256 --runtime incremental`, SDK resolved from an in-memory file map),
  - `instrument(wasm)` — inject `pm.budget()` calls (Binaryen transform or AS transform at compile time; pick the simpler working option and document it),
  - `validateManifest(json)`, `encodeParams(manifest, values) → Float32Array`,
  - `validate(pkg) → { ok, errors, warnings, metrics }` (harness ADR §6.7),
  - `hashPackage(manifest, wasm, uiJs?) → 'sha256:…'` (WebCrypto),
  - `transpileUi(ts) → js` (sucrase) + import check.
  Vitest: compile a fixture plugin, validate passes; fixtures for each rejection reason (infinite loop, NaN, bad import, out-of-range, non-determinism).
- [ ] **P3.3 Built-in plugins.** + `plugins/waveform` (port all shapes + `WaveformShapeParams` from `waveform-math.ts`/`effects.rs`), `plugins/noise` (white/perlin/step), `plugins/sequencer` (split/checkerboard/sections/scatter/flow), `plugins/color-adjust` (`ColorParams`: hue shift, saturation, … — `signatures: ["rgb"]`, `output: "absolute"`). Each with `manifest.json` incl. `description`. Golden tests: for a fixed sample grid and times, outputs match the current Rust implementation within 1e-3 (generate goldens from the old code **before** deleting it).
- [ ] **P3.4 Build script.** + `scripts/build-plugins.ts` → `public/plugins/<hash>.wasm|.json`, generated `app/utils/plugins/builtin-index.ts`. Hook into `dev` (watch) and `build`.

### 3B — Rust core
- [ ] **P3.5 Signatures.** + `rs-engine/core/src/signatures.rs` (ADR §6.4) with `cargo test` for RGB, RGBW, CMY, color wheel, pan/tilt 16-bit, range limits.
- [ ] **P3.6 Phase & beat time.** + `phase.rs` (speed phase + spatial offset, moved out of `effects.rs`), + `beat_clock.rs` (piecewise BPM integral with timestamped BPM changes). Tests incl. BPM change mid-cycle continuity.
- [ ] **P3.7 Runtime trait + JS runtime.** + `runtime.rs` (`ModifierRuntime`, `FrameCtx`, `Sample`, `RuntimeError`), + `runtime_js.rs` (wasm-bindgen externs). Rewrite `engine.rs` render loop to ADR §6.5. New packet `TYPE_MODIFIERS_BIN` (reuse id `0x16`) in `bin_protocol.rs`: per instance generic fields + plugin index + params f32 block; plugin table separately.
- [ ] **P3.8 Remove old effects.** Delete `effects.rs` effect structs, `create_effect`, `EffectConfig` `*_params` fields, `SpeedCurve`/`Displacement` code paths (incl. `displacement_offsets`, speed-curve LUTs).

### 3C — Worker & frontend
- [ ] **P3.9 Worker bridge.** + `app/utils/plugins/worker-bridge.ts` (module cache, instances with own `Memory`, buffer copy, budget import, error → disable instance + message to main), wire messages `plugin-load`, `plugin-unload`, `modifiers-sync` in `engine-worker.ts`; heartbeat in `tick()`.
- [ ] **P3.10 Watchdog.** + `app/utils/plugins/watchdog.ts` in the main thread next to the worker owner (`app/utils/engine/engine.ts`): 1 000 ms without heartbeat → terminate, respawn, re-dispatch all packets, suspend non-built-in plugins, toast.
- [x] **P3.11 Modifier model in TS.** `ModifierInstance` type (ADR §6.3) replaces `Effect` in `app/utils/engine/types.ts`; `engine-store.ts` `activeEffects` → `modifiers`; encoder for `TYPE_MODIFIERS_BIN` in `binary-encoder.ts`; rewrite `set-modifiers-command.ts` (`cloneEffectsList` → plain structured clone), `use-chaser-modifiers.ts` (split logic keeps working on generic fields), `preset-*.ts`, `pinned-modifiers-store.ts` (`autoName` → manifest `name` + first enum param label), `live-ops/modifier-ops.ts`.
- [x] **P3.12 Delete TS effect classes.** Remove `app/utils/engine/effects/` entirely and every `new WaveformEffect()` etc. (e.g. `preset-apply.ts`).
- [x] **P3.13 Param UI.** + `app/components/plugin-host/ParamForm.vue` (schema → `Replaceable` inputs, `group` sections, scrub coalescing). Replace `WaveformEditor.vue`, `NoiseEditor.vue`, `SequencerEditor.vue`, `ColorEditor.vue` (modifier part) with `ParamForm`; delete `DisplacementEditor.vue`, `SpeedCurveEditor.vue`, `SpeedControl.vue`'s curve parts. Keep generic-field UI (speed, direction, fanning, origin, strength, blend) as one core component `ModifierGenericFields.vue`. Modifier "add" menu lists plugins (built-ins + project/user plugins) instead of hard-coded `add-*-modifier` emits; `switch-modifier-type` switches `plugin`.
- [x] **P3.14 Previews.** + `app/utils/plugins/preview-pool.ts`; modifier card previews and canvas preview overlays (previous `getPreviewCSS`) use it.
- [x] **P3.15 Live value `signature` target.** Extend live hub: worker sends requested signature tuples.
- [x] **P3.16 Schema v2.** `serialize.ts`: `schemaVersion: 2`, `modifiers`, reject v1 with message (ADR D24); presets likewise.
- [x] **P3.17 Docs.** Rewrite `architecture/engine.md` (pipeline, signatures, runtime, ABI) and `architecture/binary-protocol.md` (`TYPE_MODIFIERS_BIN`, removed packets); + `architecture/guides/authoring-content-plugins.md` (SDK, manifest, params, examples, validation rules — written so it can be handed to an AI as context).

*Phase done when:* all four built-ins render identically (goldens) in the app; live collaboration of modifier edits works between two browsers; killing a plugin with an infinite loop (dev test plugin) triggers budget trap, not a hang.

---

## Phase 4 — Content-plugin infrastructure

- [x] **P4.1 Supabase migration** `supabase/migrations/005_content_plugins.sql` (ADR §6.10) + regenerate `app/types/database.types.ts`.
- [x] **P4.2 Plugin store.** + `app/utils/plugins/plugin-store.ts`: `resolve(hash)` (memory → IndexedDB → `public/plugins` built-ins → Supabase), `publish(pkg, visibility)`, `listAvailable()` (built-ins, mine, project, public).
- [x] **P4.3 Local compile & create flow (no AI).** Dev-facing "New modifier from code" dialog: edit `modifier.ts` + manifest (+ `ui.ts`), compile/validate in the browser via toolchain, preview, publish. This is the seam the future AI loop will drive.
- [x] **P4.4 Import.** Import by hash/alias/link: download package incl. source, recompile, verify hash (ADR §6.7), cache.
- [x] **P4.5 Live sync by hash.** Modifier ops already carry `plugin`; on unknown hash the receiver resolves it before applying; pending state shows a spinner on the modifier card.
- [x] **P4.6 Custom panel iframe.** + `app/components/plugin-host/PluginIframePanel.vue` + bridge runtime (`app/utils/plugins/iframe-runtime.ts`, inlined into `srcdoc`) per ADR §6.9; message schema validation; theme variables; scrub coalescing.
- [x] **P4.7 Docs.** Extend the authoring guide with the custom panel API; update `architecture/live-collaboration.md` (hash sync).

---

## Phase 5 — Fixture kinds & NeoPixel extraction

- [x] **P5.1 Kind API in core.** `Fixture.kind` model, `SetFixtureKindConfigCommand` (rebuild + store `compiled`), `AddFixtureCommand` accepts `kind`, `KindBuildContext` (`PIXELS_PER_METER`, world size). Generic `ParamForm` as default add form. Library shows kinds from the registry under their categories.
- [x] **P5.2 Rust canvas primitives.** In `rs-engine/canvas/src/types.rs` replace `StripData`/`strip` with `body: Vec<BodyPrimitive>` and `handles: Vec<Handle>` + `edit_mode`; in `render.rs` draw primitives generically and handles in edit mode; move Catmull-Rom/shape sampling **out** of Rust (into the extension's `build`). Hit-testing (`spatial.rs`) uses `bounds` + handles. `FixtureCanvas.vue` sends `body`/`handles` instead of `strip`.
- [x] **P5.3 3D primitives.** Generalize `strip-substrates.ts` → `body-polylines.ts`, `svg-planes.ts` → used for `svg` primitives; `fixture-adapter.ts` builds from `body` without kind branches.
- [x] **P5.4 `extensions/neopixel-strip`.** Move `neopixel-strip-factory.ts`, `strip-geometry.ts`, `strip-regenerator.ts`, `NeoPixelStripForm.vue`, `reshape-strip-command.ts`, `set-strip-shape-command.ts`, `update-strip-config-command.ts` into the layer; implement `defineFixtureKind` (`build` = channels/beams/polyline body/handles; `onHandleMove`; `migrate`). Commands namespaced `neopixel-strip/*`. Remove `'NeoPixel Strip'` from `OflCategory`/`FIXTURE_CATEGORIES` in `custom-fixture-types.ts` and every `stripConfig` reference in core (`engine-store.ts` fingerprint, `serialize.ts`, `use-selection.ts`, `use-workspace-operations.ts`, `SelectionInfoSection.vue`, `AddFixtureDialog.vue`, encoders).
  *Done when:* `grep -ri "strip" app rs-engine` finds no NeoPixel-specific code outside the extension (generic words excepted); strips work identically with the extension installed.
- [x] **P5.5 Requires bookkeeping.** + `app/utils/extensions/requires.ts` (ADR §5.8 rules) + tests; snapshot write when an extension leaves `requires`.
- [x] **P5.6 Docs.** `architecture/core-concepts.md` (canonical model, kinds, primitives); `architecture/extensions.md` (kind example).

---

## Phase 6 — Connectors, controllers, runtime loading, install, export

- [x] **P6.1 Connector extensions.** Move each connector from `app/utils/connectors/*-connector.ts` into `extensions/connector-<type>/` with `defineConnector`. Core keeps `base-connector.ts` contract (moved into the API package as types + a small base class exported via shared globals), `scoped-encoder.ts`/frame plumbing, and `connections-store.ts` driven by the registry. `registry.ts` hard-coded lists are deleted.
- [x] **P6.2 ESP specifics.** Move `buildStripConfigPacket`, `StripSlotPayload`, `STRIP_CHIP_TYPE_ID` and the strip part of `scoped-encoder.ts` into `extensions/connector-espnow` (and/or `connector-serial`/`connector-websocket`, wherever used), reading `fixture.kind`. Remove on-device effect packets (`TYPE_LAYOUT_BIN`/`TYPE_CHAN_BIN`/`TYPE_FX_BIN` sending to hardware); connectors send rendered frames.
- [x] **P6.3 Connector config per user/device (ADR D18).** Remove `connector.*` serializable commands from `connector-commands.ts` (keep local, non-persisted history if useful), remove `ProjectSnapshot.connectors`; persist connector configs in `localStorage` keyed by user (+ Tauri hook later).
- [x] **P6.4 Controller extensions.** Move `controllers/akai-apc-mini*` + `app/utils/controllers/catalog.ts` entries into `extensions/controller-akai-apc-mini*` with `defineController`; `controller-twin` live widget into these extensions. Delete root `controllers/` and the `~controllers` alias / tsconfig include in `nuxt.config.ts`.
- [x] **P6.5 Extension bundles.** Implement `packages/extension-build` (ADR §5.9) and `scripts/build-extensions.ts` producing catalog bundles for all non-distribution first-party extensions.
- [x] **P6.6 Runtime loader.** + `app/utils/extensions/loader.ts` (IndexedDB cache, blob-URL `import()`, CSS injection, registration), boot order step 3; Supabase migration `006_extensions.sql` (`extensions`, `user_extensions`, bucket).
- [ ] **P6.7 Install UI + missing-extension gate.** Extensions page (installed list, install by id/link with warning dialog, update); `MissingExtensionDialog.vue` on project open (ADR §5.10).
- [ ] **P6.8 Project export/import.** `.pmproject` zip (ADR §6.10): project JSON + referenced plugin packages + required extension bundles; import installs/caches bundled extensions and plugins (with the same warning dialog for extensions).
- [ ] **P6.9 Zero-extension check.** CI job / script that builds with `extends: []` and runs a smoke test (open project without kinds, add OFL fixture, add built-in modifier, render) — ADR D17.
- [ ] **P6.10 Docs.** Rewrite `architecture/connectors.md` (connectors as extensions, per-device config); `architecture/extensions.md` (bundling, loading, install, requires).

---

## Phase 7 — AI-readiness & documentation

- [ ] **P7.1 Authoring guides.** + `architecture/guides/authoring-extensions.md` (task-oriented: "add a control", "add a panel section", "add a fixture kind", "add a connector", with complete small examples and the rules from ADR §5) and finalize `authoring-content-plugins.md`. Both written to be pasted as AI context.
- [ ] **P7.2 Generated API reference.** Script that emits `docs/ai/extension-api.d.ts` and `docs/ai/plugin-sdk.d.ts` (bundled declaration files) + a JSON index of all `pm.*` contracts, scopes, slot ids (collected at runtime from the primitives in a dev build) and param types.
- [ ] **P7.3 Slot id catalog.** Dev-only page `/dev/slots` listing all slot ids currently rendered, with their available scopes (helps humans and agents choose a slot).
- [ ] **P7.4 Final architecture pass.** Update `architecture.md` overview + file structure; mark ADR 0001 implementation status; remove stale docs (`arcitecture.md` content merged or deleted — ask the owner before deleting).

---

## Dependency overview

```
P0 ──► P1 ──► P2
         │
         └──► P3 (3A ─► 3B ─► 3C) ──► P4
         │
         └──► P5 (needs P1; P5.4 needs P3.16 schema v2 to drop stripConfig cleanly)
P1 + P5 ──► P6 ──► P7
```

P2 and P3 are independent after P1 and MAY run in parallel branches; merge P2 first.
