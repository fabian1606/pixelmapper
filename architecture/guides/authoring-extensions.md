# Authoring Extensions

This guide is self-contained: hand it (together with `packages/extension-api/src/`) to a developer or an AI to write a Pixelmapper extension. Background: [ADR 0001 §5](../adr/0001-extension-and-content-plugin-system.md), [extensions.md](../extensions.md). For code that shapes light output (modifiers) write a **content plugin** instead: [authoring-content-plugins.md](authoring-content-plugins.md).

## What an extension can do

| Task | Contribution | Section |
|---|---|---|
| Replace a domain input everywhere (color picker, fader, XY pad …) | `replaces` | [Add a control](#add-a-control-replace-a-pm-input) |
| Add buttons, badges, sections or menu entries to the UI | `slots` | [Add a panel section or action](#add-a-panel-section-or-action) |
| Add a new kind of fixture compiled from a config (strips, rings …) | `fixtureKinds` | [Add a fixture kind](#add-a-fixture-kind) |
| Send DMX/pixels to hardware | `connectors` | [Add a connector](#add-a-connector) |
| Support a hardware controller (MIDI grid …) | `controllers` | [Add a controller](#add-a-controller) |
| Add a live-mode widget | `liveWidgets` | [Add a live widget](#add-a-live-widget) |
| Persist own state / own undoable operations | `setExtensionData`, `commands` | [State and commands](#state-and-commands) |
| Add fixtures from definitions, change address/mode, guard or observe patch changes | `ctx.commands`, `onBeforeFixtureChange`, `onFixturePatchChange`, `saveCustomFixtureDefinition` | [Patch fixtures](#patch-fixtures-api-13) |

## Rules (enforced)

1. Import **only** `@pixelmapper/extension-api`, `vue`, `pinia` and files inside your folder. No `~/…`, no `@/components/ui/…`, no `lucide-vue-next`, no other packages. (`bun run lint`, `bun run check:extensions`.)
2. **Read** state through scopes (`useScope`), `ctx.getFixture`, `getFixture`, live values. **Write** only through commands: `ctx.run(ctx.commands.…)` or your own namespaced commands. Never mutate a view (views are frozen in dev).
3. Use theme tokens only: Tailwind classes like `bg-primary`, `text-muted-foreground`, `border-border`, or `var(--primary)`. No hard-coded colors (dark/light themes).
4. Ids: folder name = extension id, kebab-case, globally unique. Command types and live widget types are namespaced `<extensionId>/<name>`.
5. Every manifest and contribution has a human/AI-readable `description`.
6. Write `<script setup lang="ts">` components and TypeScript; comment your code.

## Skeleton

```
extensions/<id>/
  package.json          { "name": "@pixelmapper/ext-<id>", "private": true, "type": "module", "main": "./nuxt.config.ts" }
  nuxt.config.ts        export default defineNuxtConfig({});
  plugins/register.ts   registers the manifest (below)
  extension.ts          the manifest (default export)
  components/*.vue
  <id>.test.ts          optional; tests may import core (`~/…`)
```

```ts
// plugins/register.ts
import { registerExtension } from '@pixelmapper/extension-api';
import manifest from '../extension';

export default defineNuxtPlugin(() => {
  registerExtension(manifest);
});
```

```ts
// extension.ts
import { defineExtension } from '@pixelmapper/extension-api';

export default defineExtension({
  id: 'my-extension',
  version: '1.0.0',
  apiVersion: '^1.0.0',
  displayName: 'My extension',
  description: 'What it does, in one or two sentences (read by humans and AI).',
  contributes: { /* see the tasks below */ },
  // Optional imperative hook, called once after registration; may return a disposer.
  activate(api) { /* api.extensionId, api.commands, api.run(command) */ },
});
```

For development add the folder to `FIRST_PARTY_EXTENSIONS` (bundled with the app) or `CATALOG_EXTENSIONS` (installed on demand) in `nuxt.config.ts`. `PM_DEBUG_SLOTS=1 bun run dev:nuxt` labels every slot in the UI with its id and scopes.

## Add a control (replace a `pm.*` input)

Core UI renders domain inputs through `<Replaceable name="pm.*">`. Replacing one upgrades every call site at once: properties sidebar, live widgets, modifier params and fixture-kind configs.

| Input | Props (besides `disabled`, `label`, `size`) | Value |
|---|---|---|
| `pm.fader` | `min`, `max`, `step`, `color`, `orientation`, `showValue`, `unit`, `variant` (`track`/`box`), `icon`, `fill` | `number` |
| `pm.numberInput` | `min`, `max`, `step`, `precision`, `unit` | `number` (+ `commit`) |
| `pm.colorInput` | `swatches` | `RgbColor` (0–1) |
| `pm.xyInput` | `axisLabels`, `bounds` | `Vec2` (0–1) |
| `pm.select` | `options: { value, label }[]`, `variant` | `string` |
| `pm.toggle` | — | `boolean` |
| `pm.curve` | — | `CurvePoint[]` |
| `pm.angle` | — | radians |
| `pm.tapTempo` | `phase`, `color` | bpm (+ `tap`) |
| `pm.button` | `mode` (`momentary`/`toggle`), `color` | `boolean` (+ `press`, `release`) |

Every input emits `update:modelValue`, `scrubStart`, `scrubEnd` — wrap drags in `scrubStart`/`scrubEnd` so the caller makes **one** undo step. Exact contracts: `packages/extension-api/src/replaceables.ts`.

```ts
// extension.ts
import { defineExtension } from '@pixelmapper/extension-api';
import KnobFader from './components/KnobFader.vue';

export default defineExtension({
  id: 'knob-fader', version: '1.0.0', apiVersion: '^1.0.0',
  displayName: 'Knob fader', description: 'Renders every fader as a rotary knob.',
  contributes: { replaces: [{ replaces: 'pm.fader', component: KnobFader }] },
});
```

```vue
<!-- components/KnobFader.vue -->
<script setup lang="ts">
/** Rotary knob implementing the pm.fader contract. */
import { computed } from 'vue';
import type { FaderProps, CommonInputEmits } from '@pixelmapper/extension-api';

const props = withDefaults(defineProps<FaderProps>(), { min: 0, max: 1, disabled: false, size: 'md' });
const emit = defineEmits<CommonInputEmits<number>>();

/** 0–1 position of the value. */
const t = computed(() => (props.modelValue - props.min) / (props.max - props.min || 1));

/** Vertical drag changes the value; one scrub per drag. */
function onPointerDown(e: PointerEvent) {
  if (props.disabled) return;
  const startY = e.clientY;
  const start = props.modelValue;
  emit('scrubStart');
  const move = (m: PointerEvent) => {
    const v = start + ((startY - m.clientY) / 150) * (props.max - props.min);
    emit('update:modelValue', Math.min(props.max, Math.max(props.min, v)));
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); emit('scrubEnd'); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
</script>

<template>
  <div class="flex flex-col items-center gap-1 select-none">
    <div
      class="size-10 rounded-full border border-border bg-muted relative cursor-ns-resize"
      :style="{ transform: `rotate(${-135 + t * 270}deg)` }"
      @pointerdown="onPointerDown"
    >
      <div class="absolute left-1/2 top-1 h-3 w-0.5 -translate-x-1/2 rounded bg-primary" />
    </div>
    <span v-if="label" class="text-[10px] text-muted-foreground">{{ label }}</span>
  </div>
</template>
```

If several installed extensions replace the same input, the user picks once (stored per user). Without your extension the core default is used.

## Add a panel section or action

Layout primitives generate **slots**: slot id = the `/`-joined ids of the enclosing primitives + `:` + position.

| Slot ids | Where |
|---|---|
| `properties:header\|before\|after`, `properties/<category>:actions\|before\|after\|items` (`intensity`, `color`, `position`, `beam`, `shaping`, `effects`, `control`), `properties/<category>/channel:badges\|actions` | fixture properties sidebar |
| `scene:header`, `scene/fixture:badges\|actions`, `scene/group:badges\|actions` | scene list |
| `modifiers:*`, `modifiers/modifier:badges\|actions`, `modifiers/add:items` | modifier stack |
| `presets:header\|before\|after`, `presets/preset:badges\|actions` | presets |
| `library:*`, `library/categories:items`, `library/<manufacturer>:items`, `add-fixture/sources:items` | fixture library / add dialog |
| `header:start\|end`, `live:start\|end` | app header, live toolbar |
| `context-menu/<fixture\|group\|channel\|preset>:items` | context menus |

Globs: `*` = one path segment, `**` = any number (`'properties/*:actions'`, `'**:badges'`). Contributions are ordered by `priority` (desc), then extension id; `when(scopes)` decides visibility reactively.

**Scopes** available to a contribution are those of its location: `project` (id, bpm, `requires`, `fixtures` list), `selection` (`fixtureIds`, `nodeIds`), `viewport` everywhere; `fixture` in fixture rows and single-selection properties; `channel` + `signature` in channel controls; `modifier` in modifier cards; `preset` in preset rows; `liveWidget`/`livePage` in live mode. Types: `packages/extension-api/src/scopes.ts`.

Example — a "Full" button in the intensity section that sets every selected dimmer to 255 in one undo step:

```ts
// extension.ts
import { defineExtension } from '@pixelmapper/extension-api';
import FullButton from './components/FullButton.vue';

export default defineExtension({
  id: 'dimmer-full', version: '1.0.0', apiVersion: '^1.0.0',
  displayName: 'Dimmer full', description: 'Adds a button that drives all selected dimmers to full.',
  contributes: {
    slots: [{
      slot: 'properties/intensity:actions',
      component: FullButton,
      when: s => (s.selection?.fixtureIds.length ?? 0) > 0,
    }],
  },
});
```

```vue
<!-- components/FullButton.vue -->
<script setup lang="ts">
/** Sets all DIMMER channels of the selection to 255 (one history step per fixture). */
import { useExtensionContext, useScope } from '@pixelmapper/extension-api';

const ctx = useExtensionContext();
const selection = useScope('selection');

function full() {
  for (const id of selection.value?.fixtureIds ?? []) {
    const fixture = ctx.getFixture(id);
    const values = (fixture?.channels ?? [])
      .filter(c => c.type === 'DIMMER' && !c.isFine)
      .map(c => ({ channelIndex: c.index, value: 255 }));
    if (values.length) ctx.run(ctx.commands.setChannelValues({ fixtureId: id, values, description: 'Dimmer full' }));
  }
}
</script>

<template>
  <button class="px-2 py-0.5 rounded border border-border text-xs hover:bg-accent" @click="full">Full</button>
</template>
```

Menu entries need no component — use `menuItem` in an `:items` slot:

```ts
{ slot: 'context-menu/fixture:items', menuItem: { label: 'Log fixture', icon: 'bug', action: s => console.log(s.fixture) } }
```

**Previewing** without changing the project: `ctx.preview.setChannel(fixtureId, channelIndex, dmx)` forces an output value locally (not saved, not synced, cleared on unmount) — useful while a user hovers or edits before committing.

### Core command factory (`ctx.commands`)

| Command | Purpose |
|---|---|
| `setChannelValues({ fixtureId, values: [{ channelIndex, value }], description? })` | programmed static values |
| `setChannelRange({ fixtureId, channelIndex, min, max })`, `setChannelRanges({ changes })` | output range limits |
| `setFixtureKindConfig({ fixtureId, config })` | replace a kind fixture's config (rebuilds) |
| `addFixture({ kind: { id, config? }, position })` | add one kind fixture at a position |
| `addFixtures(items)` → `Promise<AddFixturesCommand>` | add fixtures from definitions (OFL / custom) or kinds, like the add dialog; `fixtureIds` known up front (API 1.3) |
| `setStartAddress({ fixtureId, startAddress })` | absolute DMX start address (sets the universe too) (API 1.3) |
| `setFixtureMode({ fixtureId, modeIndex })` → `Promise<Command>` | switch a definition fixture to another mode (API 1.3) |
| `batch(commands, description?)` | several commands as ONE undo step (API 1.3) |
| `setExtensionData({ owner, ownerId?, key, value })` | namespaced JSON state (see below) |
| `rename({ nodeId, name })`, `move({ moves })`, `rotate({ fixtureId, rotation })` | scene edits |

Run every command with `ctx.run(command)`: that gives undo/redo, persistence and live collaboration.

## Patch fixtures (API 1.3)

For connectors and tools that manage the DMX patch (e.g. devices discovered on the network). Requires `apiVersion: '^1.3.0'`.

**Definitions.** A definition key is `'<manufacturer>/<fixture>'` (Open Fixture Library) or `'custom/<id>'` (the user's custom fixtures). Fixtures built from a definition expose `fixture.source = { key, modeIndex }` in their view. Find the definition of a device by its RDM IDs — custom fixtures first, then the library:

```ts
import { findFixtureDefinitionByRdm } from '@pixelmapper/extension-api';

const match = await findFixtureDefinitionByRdm(0x7ff0, 1);
// { key: 'custom/custom-…', source: 'custom', name, manufacturer, modes: [{ index, name, channelCount, rdmPersonalityIndex? }],
//   modeByPersonality: { 1: 0, 2: 1, … } }   — null when nothing matches
```

No definition? Generate one (OFL JSON) and store it as a **new custom fixture** the user can edit (API 1.4; never replaces an existing one, a taken name gets " (2)"); set the RDM IDs and `rdmPersonalityIndex` so the next lookup finds it:

```ts
import { saveCustomFixtureDefinition } from '@pixelmapper/extension-api';

const key = saveCustomFixtureDefinition({
  name: 'Acme Bar', categories: ['Pixel Bar'], rdm: { modelId: 1 }, pixelmapper: { rdmManufacturerId: 0x7ff0 },
  availableChannels: { Dimmer: { capability: { type: 'Intensity' } } },
  modes: [{ name: '1 ch', rdmPersonalityIndex: 1, channels: ['Dimmer'] }],
}); // 'custom/custom-…'; throws for invalid definitions
```

**Add fixtures + your data as one undo step.** `addFixtures` is async (library definitions load on demand) and returns a command that already knows the new ids; `batch` combines it with `setExtensionData`:

```ts
const add = await ctx.commands.addFixtures(devices.map(d => ({
  definition: match.key,
  modeIndex: match.modeByPersonality[d.personality] ?? 0,
  startAddress: d.address,             // absolute, 1-based; omit to append like the add dialog
  name: d.label,
})));
ctx.run(ctx.commands.batch([
  add,
  ...add.fixtureIds.map((id, i) => ctx.commands.setExtensionData({ owner: 'fixture', ownerId: id, key: 'device', value: { uid: devices[i]!.uid } })),
], 'Add all devices'));
```

New fixtures are placed at the centre with a small diagonal cascade and selected, exactly like the add dialog. Overlapping addresses are allowed — flag them yourself.

**Addresses and modes.** `ctx.commands.setStartAddress({ fixtureId, startAddress })`, `await ctx.commands.setFixtureMode({ fixtureId, modeIndex })` (keeps id, name, position, address and extension data). Free addresses:

```ts
import { findFreeAddressSpan, listFixtures } from '@pixelmapper/extension-api';

const start = findFreeAddressSpan(listFixtures(), footprint, 1, { universe: 2, ignore: [fixtureId] }); // null = no room in universe 2
```

`listFixtures()` entries carry `extensionData` when a fixture has some (API 1.4), so finding "my" fixtures needs no full fixture views: `listFixtures().filter(f => f.extensionData?.['my-extension']?.link)`.

**Guard user changes.** `onBeforeFixtureChange(change => …)` runs before the core UI (inspector address fields, address grid drag, Mode select) changes a fixture's address, universe or mode. Return nothing / `{ action: 'allow' }`, `{ action: 'confirm', message, confirmLabel? }` (core dialog; default button "Change anyway") or `{ action: 'deny', message? }`. `change.before` / `change.after` are `FixturePatchState`s (`startAddress`, `universe`, `localAddress`, `channelCount`, `modeIndex`). Guards never block `ctx.run`, undo/redo or collaborators — derive state such as "unlinked" from the fixture (e.g. its universe) instead of from the guard answer.

**Observe patch changes.** `onFixturePatchChange(changes => …, { fixtureIds })` reports every change of start address, universe, channel count or mode — local commands (`origin: 'local'`, `initiator` = extension id when run through `ctx.run`), `undo`, `redo` and collaborators (`remote`); `before`/`after` is `null` when a fixture appears/disappears. Callbacks run a microtask after the history step, so they may run commands; opening a project is not reported. Typical use: push the new address/mode to a device for local changes, and ignore changes your own extension initiated in response to the device.

Both hooks return an unsubscribe function; register them in `activate` (return a disposer) or in a component's setup.

## Add a fixture kind

A kind compiles a JSON config into channels, beams, body primitives and handles — the core renders them in 2D and 3D; no custom renderers. Full concept: [core-concepts.md › Fixture kinds](../core-concepts.md#fixture-kinds-adr-56); complete example: [extensions.md › Fixture kind example](../extensions.md#fixture-kind-example) (an LED ring) and `extensions/neopixel-strip`.

Essentials:

- `build(config, ctx)` is **pure** and returns geometry in world pixels **relative to the fixture origin** (`ctx.pixelsPerMeter` = 250). The core applies position and rotation.
- `configSchema` (same param language as content plugins) yields the add form and the selection-panel editor for free; provide `library.addForm` only for richer UIs (prop `modelValue`, emits `update:modelValue`, `add(config, count)`).
- `handles` with role `anchor` are active when selected; `vertex`/`midpoint`/`rotate` in edit mode (second click). `onHandleMove(startConfig, handleId, pos, ctx)` is called with the **drag-start config** on every move; `onHandleDelete` handles Delete/right-click.
- Bump `version` when the config shape changes and implement `migrate(config, fromVersion)`.
- Using a kind makes projects require your extension (`requiredWhenUsed: false` to opt out).

## Add a connector

Connectors receive rendered output; they never render. Extend `ConnectorBase`:

```ts
import { ConnectorBase, defineConnector } from '@pixelmapper/extension-api';

class LogConnector extends ConnectorBase {
  readonly meta = { type: 'log-out', label: 'Console log', icon: 'terminal' };
  constructor(id: string) { super(id); this.initOutputs(1); }              // one DMX output (mapped to a universe)
  async connect() { this.status.value = 'connected'; }
  async disconnect() { this.status.value = 'disconnected'; }
  override sendFrame(data: Uint8Array, universe?: number) { if (data[0]) this.pushLog(`U${universe} ch1=${data[0]}`); }
}

// in contributes:
connectors: [defineConnector({
  type: 'log-out', label: 'Console log', icon: 'terminal', description: 'Logs channel 1 of a universe.', direction: 'output',
  create: id => new LogConnector(id),
  fromConfig: (id, config) => { const c = new LogConnector(id); c.applyConfig(config); return c; },
})]
```

- `outputCount > 0`: the host calls `sendFrame(512 bytes, universe)` per mapped output per frame. `outputCount = 0`: implement `onEngineState({ bpm, elapsedMs, beatTime, dmxBuffer })`.
- Keep config in fields; `getConfig()`/`applyConfig(patch)` (call `super`) round-trip it. The host persists it **per user and device** (never in the project).
- A `settings` component (prop `connector`, emits `change(patch)`) renders type-specific fields; label, connect/disconnect, output mapping and logs are rendered by the host. Set `ownsOutputMapping: true` on the definition when your settings component renders the output → universe mapping itself (e.g. a port table): the host then hides its generic Outputs section (API 1.4).
- `canAutoConnect()` → `true` when connecting needs no user gesture.
- **The user's connector set** (API 1.4, needs `apiVersion: '^1.4.0'`): `connectors.list(type?)` (reactive), `connectors.add(connector)` (e.g. *Connect* on a device you discovered; always-connected instances connect at once), `connectors.remove(id)`, and `connectors.persist(id)` — call it when a connector changed its own config outside the settings component (learned a device id, followed a new IP), so it survives a reload without the card being open.
- **Per-user state** outside the project (dismissed suggestions …): namespace storage keys with `getUserKey()` (signed-in user id, else `'local'`; reactive).
- Fixture data from a connector: `getFixture(id)` (re-read occasionally, not per frame).
- Details and the ESP protocol: [connectors.md](../connectors.md).

## Add a controller

```ts
import { ControllerDriverBase, defineController, type ControlFeedback } from '@pixelmapper/extension-api';

class MyDriver extends ControllerDriverBase {
  readonly definitionKey = 'vendor-model';
  async connect() { /* navigator.requestMIDIAccess(); on message: this.emitInput({ controlId: 'pad-0', type: 'press' }) */ }
  async disconnect() { /* close ports */ }
  sendFeedback(fb: ControlFeedback) { /* LED output; fb.state: 'on' | 'off' | { type: 'rgb', r, g, b } */ }
}

// in contributes:
controllers: [defineController({
  id: 'vendor-model', label: 'Vendor Model', description: '…',
  createDriver: id => new MyDriver(id),
  layoutSvg,                       // import layoutSvg from './layout.svg?raw' (viewBox, no <style>)
  viewBox: { w: 400, h: 300 }, defaultGridSize: { w: 16, h: 12 },
  controls: [{ id: 'pad-0', type: 'button', svgId: 'pad0', rect: { x: 10, y: 10, w: 30, h: 30 } }],
})]
```

Keep hardware handles (`MIDIAccess`, `HIDDevice`) as plain private fields — Vue proxies break native events. The core's controller-twin widget renders your layout and maps controls to live actions.

## Add a live widget

```ts
liveWidgets: [defineLiveWidget({
  type: 'my-extension/meter', label: 'Meter', icon: 'gauge',
  component: Meter,                 // reads the `liveWidget` scope; no props
  defaultConfig: () => ({ channel: 0 }),
  defaultSize: { w: 4, h: 4 },
})]
```

The widget's configuration lives in `widget.extensionData[extensionId]` (seeded from `defaultConfig()`); write it with `setExtensionData({ owner: 'liveWidget', ownerId: widget.id, key, value })`. Without your extension the widget renders a placeholder and creates **no** project dependency.

## Live values

- `useLiveValue(target, { fps })` → throttled `shallowRef`, only while mounted and visible. Targets: `{ kind: 'channel', fixtureId, channelIndex }` (rendered byte), `{ kind: 'signature', fixtureId, signature }` (normalized tuple after modifiers), `{ kind: 'beat' }`, `{ kind: 'universe', universe }`.
- `onFrame(cb, { targets })` for per-frame canvas drawing (typed arrays, no Vue state at frame rate).

## State and commands

**Extension data** (preferred): `ctx.run(ctx.commands.setExtensionData({ owner: 'fixture' | 'project' | 'liveWidget', ownerId, key, value }))` stores JSON at `owner.extensionData[<your id>][key]` — undoable, persisted, synced. Read it from the `fixture`/`project`/`liveWidget` scope views (`extensionData`). Projects with your data require your extension.

**Own commands** (when a key/value write is not enough): implement `SerializableCommand` (`commandType: '<id>/<name>'`, `toPayload()`, `execute()`, `undo()`), compose core commands where possible, touch only state you own (your kind's fixtures, your extension data), and register the replay factory:

```ts
commands: [{ type: 'my-extension/reset', fromPayload: (payload, ctx) => new ResetCommand(payload, ctx) }]
```

The host registers it for replay from the change log and for collaborators; executing it adds your extension to the project's `requires`.

## Testing and shipping

- Tests next to the code (`<id>.test.ts`, Vitest + happy-dom); tests may import core modules (`~/…`) to mount hosts, e.g. `registerExtension(manifest)` + `installSharedGlobals()`. Shared test helpers that import core go into `*.test-support.ts` files (exempt from the import rule like tests; never import them from extension code).
- `bun run lint && bun run check:extensions && bun run test`.
- Catalog bundle: `bun run build:extensions` → `public/extensions/<id>/<version>/{index.js, style.css, extension.json}`. Users install it from the Extensions page; projects that use it list it in `requires` and ask for it when opened elsewhere.

## Checklist

- [ ] Only allowed imports; theme tokens only; no hard-coded colors.
- [ ] Manifest and every contribution have a clear `description`.
- [ ] Writes go through `ctx.run(...)`; drags bracketed by `scrubStart`/`scrubEnd`.
- [ ] Slot contributions have a `when` where they only make sense in some contexts.
- [ ] Kinds: pure `build`/`onHandleMove`, `version` + `migrate` for config changes.
- [ ] Connectors: non-blocking `sendFrame`, config via `getConfig`/`applyConfig`.
- [ ] `bun run check:extensions` passes.
