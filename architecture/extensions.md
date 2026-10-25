# Extensions — How the Extension Host Works

Extensions add features to Pixelmapper (controls, panel sections, fixture kinds, connectors, controllers, live widgets) through one typed package: **`@pixelmapper/extension-api`** (`packages/extension-api`). The normative spec is [ADR 0001 §5](adr/0001-extension-and-content-plugin-system.md#5-extension-specification); deviations are listed under its *Amendments*. This page explains how the pieces fit together in the code.

```
extensions/<id>/                     app/ (core)
├── extension.ts  ──defineExtension──► utils/extensions/registry.ts      validate + store manifests
├── plugins/register.ts ─registerExtension (queued until the host is ready)
└── components/*.vue                 utils/extensions/shared-globals.ts  globalThis.__PIXELMAPPER_SHARED__
        │                            plugins/00.extensions.client.ts     boot: install globals, drain queue
        │ useScope / useExtensionContext / useLiveValue / onFrame / useReplaceable
        ▼
 @pixelmapper/extension-api  ──reads implementation from──►  __PIXELMAPPER_SHARED__.api
```

## Rules for extension code

- Import **only** `@pixelmapper/extension-api`, `vue`, `pinia` (own stores) and your own files. `bun run lint` (ESLint `no-restricted-imports`) and `bun run check:extensions` (relative imports must stay inside the folder, manifest validation, no duplicate `pm.*` replacements among first-party extensions) enforce this.
- Read state through **scopes**, write through **commands** (`ctx.run(ctx.commands.setChannelValues(...))`).
- Use theme tokens (`bg-primary`, `text-muted-foreground`, `var(--primary)`), never hard-coded colors.
- Folder name = extension id (kebab-case; a leading `_` marks dev-only extensions).

## Boot and registration

1. `app/plugins/00.extensions.client.ts` calls `installSharedGlobals()` (`app/utils/extensions/shared-globals.ts`): `vue`, `pinia` and the API (package exports + host implementations) go to `globalThis.__PIXELMAPPER_SHARED__`.
2. The **distribution set** (`color-picker`, `pan-tilt`, `connector-artnet`) are Nuxt layers listed in `FIRST_PARTY_EXTENSIONS` in `nuxt.config.ts` (`extends`). Each layer has `plugins/register.ts` calling `registerExtension(manifest)`. Calls that run before step 1 are queued in `globalThis.__PIXELMAPPER_PENDING__` and drained by `installSharedGlobals`, so plugin order does not matter.
3. `app/plugins/03.extension-loader.client.ts` loads the user's **installed bundles** (see below); `engineStore.loadProject` awaits `extensionsReady()` before it checks `requires` and deserializes fixtures.

Catalog extensions (`neopixel-strip`, `connector-esp`, `controller-akai-apc-mini-mk2`) are installed on demand in production; in dev they are additionally layered for HMR (`PM_CATALOG_LAYERS=0` turns that off). `PM_NO_EXTENSIONS=1` builds the core with `extends: []` (`bun run check:zero-extensions`, ADR D17).

`registerExtension` validates the manifest (`validateManifest` in `registry.ts`): kebab-case unique id, semver `version`, `apiVersion` range compatible with `API_VERSION`, command types `<id>/<name>`, live widget types `<id>/<name>`, unique fixture-kind ids and connector types, no duplicate replacement within the extension. Invalid manifests are logged, not thrown, at boot.

## Bundles, installation and loading (ADR §5.9)

**Build.** `packages/extension-build` bundles an extension folder in Vite library mode (`bun run build:extensions` builds every non-distribution first-party extension into `public/extensions/<id>/<version>/` plus `public/extensions/catalog.json`; `nuxt build` runs it first):

- `index.js` — ESM; default export = the manifest. `vue`, `pinia` and `@pixelmapper/extension-api` are virtual modules reading `globalThis.__PIXELMAPPER_SHARED__`, so a bundle never ships its own Vue and shares the host's instances (`ConnectorBase`, `ControllerDriverBase` come from the API module).
- `style.css` — Tailwind utilities scanned from the extension's own sources (no preflight), colors mapped to the host's theme variables.
- `extension.json` — metadata without components: id, version, apiVersion, names, contribution summary (kind ids + `requiredWhenUsed`, connector types, controllers, slots, replacements, commands).

**Sources.** The app catalog (`/extensions`) and the Supabase registry (`extensions` table + public `extensions` bucket, migration `006_extensions.sql`: anyone reads, a publisher owns the ids it published first, rows are immutable).

**Installed list.** Per user: Supabase `user_extensions` (mirrored to localStorage) when signed in, else `localStorage["pm:installed-extensions:local"]`. Installed = active (D19); there is no per-project toggle.

**Loading** (`app/utils/extensions/loader.ts`): for every installed `{ id, versionRange }` — skip when a layer already registered the id; pick the highest version satisfying the range (newest published, else cached); download into IndexedDB (`pm-extensions`, offline afterwards); inject the CSS (`<style data-pm-extension="id@version">`); `import()` the JS from a blob URL; `registerExtension(manifest, 'bundle')`. Failures are reported per extension, never fatal.

**Installing** (Extensions page, `/extensions`): install by catalog entry, id, `id@range` or a link ending in the id, after the dialog showing id, version, source and *“Extensions run with full access to your projects and this app.”* Install/update/uninstall change the list and reload the app. Bundles from imported `.pmproject` files are offered from the cache (works offline).

## Project requirements and the open gate (ADR D20, §5.10)

`project.requires: { id, version: '^major.minor' }[]` is maintained by `app/utils/extensions/requires.ts`:

- executing an extension's namespaced command, or `SetFixtureKindConfig`/`AddFixtures` for a kind of E (unless the kind sets `requiredWhenUsed: false`), adds E — a new requirement is written to a snapshot immediately;
- every snapshot write recomputes the list from the state: E stays while a fixture uses one of its required kinds or any `extensionData[E]` exists (fixtures, project, live widgets); removals happen with that snapshot, so the change log after it holds no E commands.

On open, the snapshot's `requires` plus the owners of namespaced commands in the change-log tail are checked against the registered extensions (`semver.satisfies`). Missing or incompatible ones stop the load: `MissingExtensionDialog` lists them with Install/Update buttons (catalog, registry or cached bundles) and “Back to projects”. There is no degraded mode.

## Scopes

Scopes (`ScopeMap` in `packages/extension-api/src/scopes.ts`) are readonly views of domain state. Core components provide them with `provideScope(name, getter)` (`app/composables/extensions/provide-scope.ts`); every descendant reads them with `useScope(name)`. Each scope name has its own injection key, so a nested provider shadows only that scope.

- Views are **fresh plain objects** built by projections in `app/utils/extensions/scope-views.ts` (`fixtureView`, `channelView`, `signatureTargetFor`, `modifierView`, …). In dev they are deep-frozen: mutating one throws a `TypeError`.
- Projections are lazy (`computed`): they only run when something reads the scope, e.g. a slot contribution with a `when` predicate.
- For `v-for` items use `<ScopeProvider name="modifier" :get="() => modifierView(m, blend)">` (no DOM).
- A component cannot inject what it provides itself; to capture its own scopes (e.g. for a context menu) pass them: `useScopeSnapshot({ fixture: fixtureScopeRef })`.

| Scope | Provided by |
|---|---|
| `project`, `selection`, `viewport` | `app.vue` via `provideRootScopes()` (`viewport` mirrors the project page's 2D/3D/raw switch and the live route) |
| `fixture` | scene rows (`FixtureSidebarNode`), properties sidebar (single selection) |
| `channel`, `signature` | channel controls (`FixturePropertyControl`) |
| `modifier` | modifier cards (`ChaserModifiersList`) |
| `preset` | preset rows (`PresetsSidebar`) |
| `liveWidget`, `livePage` | `LiveWidget.vue`, live page |

## Slots

Layout primitives (`app/components/primitives/`) take a required `id`, append it to the inherited path (`app/utils/extensions/slot-path.ts`) and render `ExtensionSlot`s at their positions. Slot id = path joined by `/` + `:` + position.

| Primitive | Positions | Default placement |
|---|---|---|
| `PmPanel` | `header`, `before`, `after` | inside root: header, before, content, after |
| `PmPanelSection` | `before`, `after`, `actions`, `items` | before/after as siblings of the root; actions in the title row (or root start); items after content |
| `PmToolbar` | `start`, `end` | around the content |
| `PmMenuGroup` | `items` | after the content; contributed menu items render through the `#item` slot in the menu's own style; `as="fragment"` renders no root |
| `PmListItem` | `badges`, `actions` | appended to the row |

Callers with custom markup list positions in `manual` and render the outlets they get as slot props:

```vue
<PmListItem id="fixture" :as="SidebarMenuItem" :manual="['badges', 'actions']" v-slot="{ Badges, Actions }">
  <span>{{ node.name }}</span>
  <component :is="Badges" /><component :is="Actions" />
</PmListItem>
```

Current slot ids (run `PM_DEBUG_SLOTS=1 bun run dev:nuxt` to see them labelled in the UI, open `/dev/slots` in dev for the catalog of slots rendered in the session with their scopes and contributors, or read `docs/ai/index.json`):

- `scene:header`, `scene/fixture:badges|actions`, `scene/group:badges|actions`
- `properties:header|before|after`, `properties/<category>:actions|before|after|items` (`intensity`, `color`, `position`, `beam`, `shaping`, `effects`, `control`), `properties/<category>/channel:badges|actions`
- `modifiers:*`, `modifiers/modifier:badges|actions`, `modifiers/add:items`
- `presets:header|before|after`, `presets/preset:badges|actions`
- `library:*`, `library/categories:items`, `library/<manufacturer>:items`, `add-fixture/sources:items`
- `header:start|end` (app header), `live:start|end` (live mode toolbar)
- `connections/outputs:before` (Connectors page, Outputs tab, above the output connectors — e.g. devices found on the network)
- `context-menu/<id>:items` with `id` ∈ `fixture`, `group`, `channel`, `preset`

`ExtensionSlot` resolves contributions through a memoized index (`slot-matching.ts`; `*` = one segment, `**` = any number), orders them by `priority` (desc) then extension id, evaluates `when` against the scope snapshot, renders each component inside `ExtensionContributionHost` (provides the owning extension id + slot id, isolates render errors) and renders nothing when empty.

## Replaceable `pm.*` inputs

Domain inputs have typed contracts (`PmInputContracts` in `replaceables.ts`) and core defaults in `app/components/pm/` (`PmFader`, `PmNumberInput`, `PmColorInput`, `PmXyInput`, `PmSelect`, `PmToggle`, `PmCurve`, `PmAngle`, `PmTapTempo`, `PmButton`). Core code renders them only through `<Replaceable name="pm.fader" …/>` or `useReplaceable('pm.fader')`; the defaults compose each other the same way (the minimal color input uses the active `pm.fader`).

Every contract has `modelValue` / `update:modelValue`, `scrubStart` / `scrubEnd` (callers bracket a drag into one undo step), `disabled`, `label`, `size`. Resolution (`app/utils/extensions/replacements.ts`): no replacement → default; one → it; several → the user's stored choice (`localStorage['pm.replacements']`), otherwise the default plus a one-time `ReplacementChoiceDialog`.

Call sites: property sidebar box fader (`pm.fader` `variant="box"`) and value field, live slider (`pm.fader` vertical), live beat (`pm.tapTempo`), live button (`pm.button`), engine number fields (`pm.numberInput`), property sidebar color (`pm.colorInput`) and pan/tilt (`pm.xyInput`), live `color` and `xy` widgets, and every param of content plugins and fixture-kind configs through `ParamForm` (`number` → `pm.fader`, `int` → `pm.numberInput`, `bool` → `pm.toggle`, `enum` → `pm.select`, `color` → `pm.colorInput`, `angle` → `pm.angle`, `point` → `pm.xyInput`, `curve` → `pm.curve`; a param's `ui` overrides).

## Live values

`app/utils/extensions/live-hub.ts` receives every rendered frame from the engine store (`liveHub.ingest`) and extracts only subscribed targets; with no subscribers it returns immediately. Subscriptions are reference-counted per target key.

- `useLiveValue(target, { fps })` → throttled `shallowRef`, active only while mounted, the document is visible and the component's root is on screen.
- `onFrame(cb, { targets })` → raw frame (`timeMs`, `beat`, `dmx`), disposed on unmount. Never drive Vue state at frame rate from it.
- Targets: `channel` (rendered coarse byte), `universe` (512-byte copy), `beat` (`beatTime`, `bpm`, `phase`), `signature` (normalized tuple of the fixture's first head after modifiers — `scalar` = dimmer; read back from the engine worker only while subscribed).

## Live widgets

Live widget types come from `app/utils/live/widget-registry.ts`: the core types (`button` → `pm.button`, `slider` → `pm.fader`, `xy` → `pm.xyInput`, `color` → `pm.colorInput`, `label`, `beat` → `pm.tapTempo`, `fixture-preview`, and the generic `controller-twin` for any registered controller) plus `contributes.liveWidgets` from extensions. Extension widget types are namespaced (`<extensionId>/<name>`), receive no props (read the `liveWidget` scope), keep their configuration in `widget.extensionData[extensionId]` (seeded from `defaultConfig()`), and render a "not installed" placeholder when the extension is missing — without creating a project dependency. Legacy type names `xy-pad`/`color-wheel` are mapped to `xy`/`color` on load.

## Reference example: `extensions/color-picker`

The color picker is the smallest complete replacement extension and the template for new ones:

```
extensions/color-picker/
├── package.json              # @pixelmapper/ext-color-picker (Bun workspace member)
├── nuxt.config.ts            # empty layer config
├── plugins/register.ts       # registerExtension(manifest)
├── extension.ts              # manifest: replaces pm.colorInput
├── components/ColorPicker.vue
├── utils/hsv.ts              # own helpers — core utils are off limits
└── color-picker.test.ts      # host-side test (may import core)
```

```ts
// extension.ts
export default defineExtension({
  id: 'color-picker',
  version: '1.0.0',
  apiVersion: '^1.0.0',
  displayName: 'Color Picker',
  description: 'HSV color wheel with swatches for every color input (fixtures, live widgets, modifier params).',
  contributes: {
    replaces: [{ replaces: 'pm.colorInput', component: ColorPicker }],
  },
});
```

`ColorPicker.vue` implements the contract and nothing else:

```ts
const props = withDefaults(defineProps<ColorInputProps>(), { disabled: false, size: 'md' });
const emit = defineEmits<ColorInputEmits>();
// pointerdown → emit('scrubStart'); every move → emit('update:modelValue', rgb); pointerup → emit('scrubEnd')
```

It never touches fixtures: the core `FixtureColorControl` maps the selection's RGB / color-wheel channels to one `RgbColor` (swatches = wheel slots), and the live `color` widget maps the active preset's color — both render `<Replaceable name="pm.colorInput">`. Installing the extension therefore upgrades the property sidebar, the live color widget and (from plan P3) color params at once; without it the core default (RGB faders + hex) works everywhere.

`extensions/pan-tilt` shows the other two patterns: a replacement (`pm.xyInput` → pad) and a scoped slot contribution (`properties/position:after`, `when: s => s.signature?.signature === 'panTilt'`) that reads `selection` + `ctx.getFixture()`, previews with `ctx.preview` and writes with `ctx.run(ctx.commands.setChannelRanges(...))`.

## Minimal example

```ts
// extensions/dmx-badge/extension.ts
import { defineExtension } from '@pixelmapper/extension-api';
import DmxBadge from './components/DmxBadge.vue';

export default defineExtension({
  id: 'dmx-badge',
  version: '1.0.0',
  apiVersion: '^1.0.0',
  displayName: 'DMX address badge',
  description: 'Shows the DMX address next to every fixture in the scene list.',
  contributes: {
    slots: [{ slot: 'scene/fixture:badges', component: DmxBadge }],
  },
});
```

```vue
<!-- extensions/dmx-badge/components/DmxBadge.vue -->
<script setup lang="ts">
import { useScope } from '@pixelmapper/extension-api';

const fixture = useScope('fixture');
</script>

<template>
  <span v-if="fixture" class="text-[10px] font-mono text-muted-foreground">
    {{ fixture.universe }}.{{ fixture.localAddress }}
  </span>
</template>
```

```ts
// extensions/dmx-badge/plugins/register.ts
import { registerExtension } from '@pixelmapper/extension-api';
import manifest from '../extension';

export default defineNuxtPlugin(() => registerExtension(manifest));
```

Add `./extensions/dmx-badge` to `FIRST_PARTY_EXTENSIONS` in `nuxt.config.ts` (with an empty `nuxt.config.ts` and a `package.json` in the folder) and run `bun run check:extensions`.

The dev-only `extensions/_debug-slots` is a complete working example (slot components and a menu item).

## Fixture kind example

A kind compiles a config into channels, beams, body primitives and handles (concepts: [core-concepts.md](core-concepts.md#fixture-kinds-adr-56)). A minimal LED ring with draggable radius:

```ts
// extensions/led-ring/extension.ts
import { defineExtension, defineFixtureKind, type Json } from '@pixelmapper/extension-api';

interface RingConfig { pixels: number; radius: number }

const ring = defineFixtureKind<Json>({
  id: 'led-ring',
  version: '1.0.0',
  label: 'LED ring',
  icon: 'circle',
  description: 'A ring of RGB pixels; drag the handle to change the radius.',
  configSchema: [{ key: 'pixels', type: 'int', min: 3, max: 120, default: 12, label: 'Pixels' }],
  defaults: () => ({ pixels: 12, radius: 60 }),
  build(raw) {
    const { pixels, radius } = raw as unknown as RingConfig;
    const pos = (i: number) => ({ x: Math.cos((i / pixels) * Math.PI * 2) * radius, y: Math.sin((i / pixels) * Math.PI * 2) * radius });
    return {
      channels: Array.from({ length: pixels * 3 }, (_, i) => ({
        type: (['RED', 'GREEN', 'BLUE'] as const)[i % 3]!, role: 'COLOR' as const, addressOffset: i,
        colorValue: ['#FF0000', '#00FF00', '#0000FF'][i % 3]!, defaultValue: 0, beamId: `p${Math.floor(i / 3)}`,
      })),
      beams: Array.from({ length: pixels }, (_, i) => ({ id: `p${i}`, pos: pos(i), emitterRadius: 5 })),
      body: [{ type: 'circle', center: { x: 0, y: 0 }, radius, style: { stroke: 'var(--border)' } }],
      handles: [{ id: 'radius', pos: { x: radius, y: 0 }, role: 'anchor' }],
      bounds: { x: -radius, y: -radius, w: radius * 2, h: radius * 2 },
    };
  },
  // Pure: called with the drag-start config on every pointer move.
  onHandleMove: (raw, _id, p) => ({ ...(raw as object), radius: Math.max(20, Math.hypot(p.x, p.y)) }) as Json,
  library: { category: 'Pixel Bar' },
});

export default defineExtension({
  id: 'led-ring', version: '1.0.0', apiVersion: '^1.0.0',
  displayName: 'LED ring', description: 'Circular pixel rings as a fixture kind.',
  contributes: { fixtureKinds: [ring] },
});
```

The kind appears as a card in **Add Fixture** and in the library under its category; the default add form and the selection-panel editor are generated from `configSchema` (provide `library.addForm` for a custom form: prop `modelValue`, emits `update:modelValue` and `add(config, count)`). Edits are core `SetFixtureKindConfig` commands; using the kind adds the extension to the project's `requires` (unless `requiredWhenUsed: false`). The full first-party example is `extensions/neopixel-strip`.

## Extension data

Extensions persist small JSON state with `ctx.run(ctx.commands.setExtensionData({ owner: 'fixture' | 'project' | 'liveWidget', ownerId, key, value }))`; it is stored at `owner.extensionData[extensionId][key]` and undone like any command.

Using extension data or kinds keeps the extension in the project's `requires` (see “Project requirements and the open gate” above).

## Fixture patching (API 1.3)

Added for the Art-Net/RDM work (plan M4) but generic: nothing here knows a protocol. API: `packages/extension-api/src/patch.ts` (helpers, guard, observation, lookup) and `commands.ts` (commands).

**Definitions and sources.** A fixture definition is identified by a key: `'<manufacturer>/<fixture>'` for the Open Fixture Library, `'custom/<id>'` for the user's custom fixtures (`app/utils/fixture-definitions/definition-keys.ts`). Fixtures built from a definition store `source: { key, modeIndex }` (`Fixture.source`, persisted in snapshots and `AddFixtures` payloads, exposed as `FixtureView.source`); library fixtures also get `oflKey`. `resolveFixtureDefinition(key)` loads custom definitions through the accessor and OFL definitions from `/api/fixtures/<mf>/<fixture>` (cached); `createFixtureFromDefinition(resolved, modeIndex)` builds the fixture and records the source. Custom fixtures are read and written only through `app/utils/fixture-definitions/custom-fixtures.ts` (`getCustomFixtures`, `saveCustomFixture`, …; storage is still `localStorage['pixelmapper:customFixtures']`, to move to the user account later).

**Commands** (core command factory, `app/utils/extensions/core-command-factory.ts`):

| Command | Core implementation |
|---|---|
| `addFixtures(items) → Promise<AddFixturesCommand>` (`fixtureIds` known before it runs) | `buildFixtures` → `placeNewFixtures` (`app/utils/engine/add-fixtures.ts`, shared with the add dialog: ids, explicit or appended addresses, centre + 0.02 cascade) → `AddFixturesCommand`; selects the new fixtures on its first local run |
| `setStartAddress({ fixtureId, startAddress })` | `UpdateDmxCommand` |
| `setFixtureMode({ fixtureId, modeIndex }) → Promise<Command>` | `buildSetFixtureModeCommand` (`app/utils/fixture-definitions/fixture-mode.ts`) → `SetFixtureModeCommand`: swaps channels, beams, source, definition and lens of the fixture **in place** (identity, id, name, position, size, address, group and extension data stay; programmed values carry over per head and channel type); serializable (`SetFixtureMode`, payload holds both mode states) |
| `batch(commands, description?)` | `createBatchCommand` (`commands/batch-command.ts`): one history entry, children in order, undo in reverse, all-or-nothing on errors; serializable `Batch` when all children are. Replay builds each child right before it runs, so a child may refer to fixtures added by an earlier one (`SetExtensionData` resolves its fixture through the live tree). `requires` bookkeeping and the open gate look inside batches (`flattenCommandTypes`). |

The inspector shows a **Mode** select (`FixtureModeSelect.vue`) for fixtures with a source.

**Free addresses.** `findFreeAddressSpan(fixtures, footprint, count, { ignore?, universe? })` (`app/utils/engine/free-address.ts`) is the add dialog's search; `universe` keeps the span inside one universe (else `null`). `listFixtures()` gives `FixtureSummary[]` outside components (with `extensionData` when present, API 1.4).

**Change guard** (`onBeforeFixtureChange`, host: `app/utils/extensions/fixture-change-guard.ts`). Core UI paths that change a fixture's start address, universe or mode — the inspector's U/A fields (`SelectionInfoSection.vue`), the address grid drag (`AddressGrid.vue`) and the Mode select — call `requestFixtureChanges([{ fixtureId, before, after }])` before running their command. All guards are asked; any `deny` wins (message as a warning toast), otherwise all `confirm` messages appear in one core confirm dialog (`requestConfirm()` in `app/composables/use-confirm-dialog.ts`, rendered by `ConfirmDialogHost.vue` in `app.vue`). Commands never consult guards, so `ctx.run`, undo/redo, collaborator changes and replays are never blocked.

**Change observation** (`onFixturePatchChange`, host: `app/utils/extensions/fixture-patch-observer.ts`). While subscribed, the host keeps a baseline of every fixture's patch state (`FixturePatchState`: start address, universe, local address, channel count, mode index) and diffs it after each history step (`onHistoryApplied` in `use-history.ts`: `local`, `undo`, `redo`, `remote` for `executeRemote`). Changes (including fixtures that appear/disappear) are delivered per step in a microtask, filtered by `fixtureIds` (list or getter); `initiator` is the extension whose `ctx.run`/`api.run` ran the step. Project loads replace the state outside the history; `loadProject` calls `rebaseFixturePatchObservation()`, so a load is never reported.

**Lookup by RDM IDs** (`findFixtureDefinitionByRdm(manufacturerId, modelId)`, `app/utils/fixture-definitions/rdm-lookup.ts`): custom fixtures first (`ofl.pixelmapper.rdmManufacturerId` + `ofl.rdm.modelId`), then OFL through `GET /api/fixtures/rdm?manufacturerId=&modelId=` (`server/api/fixtures/rdm.get.ts`: manufacturers' `rdmId`, fixtures' `rdm.modelId`). Returns the key, all modes with channel counts and `modeByPersonality` from the modes' `rdmPersonalityIndex`. The custom fixture editor imports OFL JSON files and edits these RDM fields (manufacturer ID, model ID, personality per mode).

**Generated definitions** (`saveCustomFixtureDefinition(definition)`, API 1.4, host: `app/utils/extensions/custom-definition-api.ts`): validates the OFL JSON like the editor's import (`parseOflFixtureJson`), builds every mode once, and adds it through the accessor's `addCustomFixture` — always a new entry, a taken name gets a numeric suffix — returning `'custom/<id>'`.

## Connector set and user key (API 1.4)

`connectors` (`packages/extension-api/src/connectors.ts`, host: `app/utils/extensions/connector-api.ts`) is a facade over the connections store: `list(type?)` (the store's reactive array, filtered), `add(connector)` (persisted; `alwaysConnected` instances connect at once), `remove(id)`, `persist(id)` (writes the current `getConfig()` of every instance; for connectors that learned config without their card being open). `getUserKey()` returns the signed-in user's id (set by `app/plugins/02.connectors.client.ts` together with loading that user's connectors) or `'local'`, reactively. `ConnectorDefinition.ownsOutputMapping` hides the generic Outputs section of `ConnectorCard.vue` for types whose settings component maps outputs itself.
