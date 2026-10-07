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
2. First-party extensions are Nuxt layers listed in `FIRST_PARTY_EXTENSIONS` in `nuxt.config.ts` (`extends`). Each layer has `plugins/register.ts` calling `registerExtension(manifest)`. Calls that run before step 1 are queued in `globalThis.__PIXELMAPPER_PENDING__` and drained by `installSharedGlobals`, so plugin order does not matter.
3. (Plan P6.6) cached installed bundles are imported, then the project loads.

`registerExtension` validates the manifest (`validateManifest` in `registry.ts`): kebab-case unique id, semver `version`, `apiVersion` range compatible with `API_VERSION`, command types `<id>/<name>`, live widget types `<id>/<name>`, unique fixture-kind ids and connector types, no duplicate replacement within the extension. Invalid manifests are logged, not thrown, at boot.

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

Current slot ids (run `PM_DEBUG_SLOTS=1 bun run dev:nuxt` to see them labelled in the UI):

- `scene:header`, `scene/fixture:badges|actions`, `scene/group:badges|actions`
- `properties:header|before|after`, `properties/<category>:actions|before|after|items` (`intensity`, `color`, `position`, `beam`, `shaping`, `effects`, `control`), `properties/<category>/channel:badges|actions`
- `modifiers:*`, `modifiers/modifier:badges|actions`, `modifiers/add:items`
- `presets:header|before|after`, `presets/preset:badges|actions`
- `library:*`, `library/categories:items`, `library/<manufacturer>:items`, `add-fixture/sources:items`
- `header:start|end` (app header), `live:start|end` (live mode toolbar)
- `context-menu/<id>:items` with `id` ∈ `fixture`, `group`, `channel`, `preset`

`ExtensionSlot` resolves contributions through a memoized index (`slot-matching.ts`; `*` = one segment, `**` = any number), orders them by `priority` (desc) then extension id, evaluates `when` against the scope snapshot, renders each component inside `ExtensionContributionHost` (provides the owning extension id + slot id, isolates render errors) and renders nothing when empty.

## Replaceable `pm.*` inputs

Domain inputs have typed contracts (`PmInputContracts` in `replaceables.ts`) and core defaults in `app/components/pm/` (`PmFader`, `PmNumberInput`, `PmColorInput`, `PmXyInput`, `PmSelect`, `PmToggle`, `PmCurve`, `PmAngle`, `PmTapTempo`, `PmButton`). Core code renders them only through `<Replaceable name="pm.fader" …/>` or `useReplaceable('pm.fader')`; the defaults compose each other the same way (the minimal color input uses the active `pm.fader`).

Every contract has `modelValue` / `update:modelValue`, `scrubStart` / `scrubEnd` (callers bracket a drag into one undo step), `disabled`, `label`, `size`. Resolution (`app/utils/extensions/replacements.ts`): no replacement → default; one → it; several → the user's stored choice (`localStorage['pm.replacements']`), otherwise the default plus a one-time `ReplacementChoiceDialog`.

Call sites today: property sidebar box fader (`pm.fader` `variant="box"`) and value field, live slider (`pm.fader` vertical), live beat (`pm.tapTempo`), live button (`pm.button`), engine number fields (`pm.numberInput`), property sidebar color (`pm.colorInput`) and pan/tilt (`pm.xyInput`), live `color` and `xy` widgets. Curve, select, toggle and angle call sites arrive with the param UI (plan P3.13).

## Live values

`app/utils/extensions/live-hub.ts` receives every rendered frame from the engine store (`liveHub.ingest`) and extracts only subscribed targets; with no subscribers it returns immediately. Subscriptions are reference-counted per target key.

- `useLiveValue(target, { fps })` → throttled `shallowRef`, active only while mounted, the document is visible and the component's root is on screen.
- `onFrame(cb, { targets })` → raw frame (`timeMs`, `beat`, `dmx`), disposed on unmount. Never drive Vue state at frame rate from it.
- Targets: `channel` (rendered coarse byte), `universe` (512-byte copy), `beat` (`beatTime`, `bpm`, `phase`); `signature` follows with the modifier runtime (P3.15).

## Live widgets

Live widget types come from `app/utils/live/widget-registry.ts`: the core types (`button` → `pm.button`, `slider` → `pm.fader`, `xy` → `pm.xyInput`, `color` → `pm.colorInput`, `label`, `beat` → `pm.tapTempo`, `fixture-preview`; `controller-twin` until plan P6.4) plus `contributes.liveWidgets` from extensions. Extension widget types are namespaced (`<extensionId>/<name>`), receive no props (read the `liveWidget` scope), keep their configuration in `widget.extensionData[extensionId]` (seeded from `defaultConfig()`), and render a "not installed" placeholder when the extension is missing — without creating a project dependency. Legacy type names `xy-pad`/`color-wheel` are mapped to `xy`/`color` on load.

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
