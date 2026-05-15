# State Management & Reactivity

## Pinia Stores

### engine-store.ts

The single source of truth for the workspace. Owns:

- **`sceneNodes`** (`shallowRef<SceneNode[]>`) — The fixture/group tree
- **`flatFixtures`** (`computed`) — All fixtures flattened, used by watchers and the render loop
- **`activeEffects`** (`ref<Effect[]>`) — Currently active effects
- **`globalBases`** (`ref<Record<string, number>>`) — Default channel values (DIMMER=255, RGB=0, etc.)
- **`selectedIds`** (`shallowRef<Set>`) — Currently selected fixture/group IDs
- **`engine`** (`markRaw(EffectEngine)`) — The WASM wrapper, entirely outside Vue's tracking

Also holds the binary packet cache (`layoutPacket`, `channelsPacket`, `effectsPacket`) and revision counters (`layoutRevision`, `channelsRevision`, `effectsRevision`). See [Engine & Render Loop](engine.md) for details.

### connections-store.ts

Registry of active connectors. Called by the render loop each frame:

- **`sendFrame(dmxBuffer)`** — Calls `connector.sendFrame()` on all connected connectors (for DMX-output connectors)
- **`notifyEngineState(state)`** — Calls `connector.onEngineState()` on all connected connectors (for parameter-based connectors like SerialConnector)

## Reactivity Strategy (Data-Oriented Design)

Pixelmapper processes hundreds of DMX calculations per frame. Deep Vue reactivity over 50+ fixtures with nested channels, step values, and config objects would create massive dependency graphs rebuilt 60 times per second.

The solution is strict Data-Oriented Design:

1. **`engine` is `markRaw()`** — The `EffectEngine` and its typed array buffers exist entirely outside Vue's observation. Math runs in contiguous WASM memory.

2. **`sceneNodes` is `shallowRef`** — Fixtures are plain JS objects. Adding or removing a fixture triggers the array reference. Modifying a deep property (e.g. `channel.chaserConfig.stepValues[0]`) does **not** trigger Vue observers — which is intentional.

3. **Explicit packet watchers** — Instead of watching deeply nested fixture state for the engine, dedicated `watch` calls in `engine-store.ts` rebuild binary packets and increment revision counters:
   ```typescript
   watch(flatFixtures, () => {
       layoutPacket   = buildLayoutBin(flatFixtures.value)
       channelsPacket = buildChannelsBin(flatFixtures.value)
       layoutRevision.value++
       channelsRevision.value++
   }, { deep: true, immediate: true })
   ```
   These are the only deep watchers — they run once on change, not 60× per second.

4. **globalBases ordering** — A `watchEffect` bakes global base values into `channel.chaserConfig.stepValues[0]` before the channels packet is read. A separate `watch(globalBases)` then explicitly invalidates `channelsPacket` to guarantee rebuild order after the watchEffect runs.

## The History Ticker

Because fixtures are plain objects inside a `shallowRef`, Vue components can't observe deep property changes natively. The History Ticker solves this:

- `useHistory()` exposes a reactive `version` ref.
- Every user action that mutates fixture data (dragging a fader, checking a checkbox, undo/redo) is wrapped in a `Command`.
- When a command executes, `version.value++` is triggered.
- UI components that need to reflect deep changes (e.g. preset "unsaved" dot, properties panel) read `history.version.value` inside their `computed` callbacks.

This forces re-evaluation precisely when the user acts, bypassing the need for deep proxies entirely.

```typescript
// UI component example
const currentChannelValue = computed(() => {
    history.version.value  // explicit dependency — re-runs on any command
    return selectedFixture.channels[0].chaserConfig.stepValues[0]
})
```

## Preset System

Presets store a snapshot of channel states (and modifier effects) for specific fixtures:

- **Selective application**: Each preset stores `fixtureIds` indicating which fixtures it covers. Loading a preset does not affect fixtures not listed in it.
- **Diffing**: The engine compares live programmer state against a preset's snapshot (filtered by `fixtureIds`) to detect unsaved changes. Editing a non-preset fixture doesn't mark the preset as modified.
- **Save / delete / overwrite** go through the command system (`preset-commands.ts`), so they are fully undoable.

### Active preset — single source of truth

`engineStore.selectedPresetId` (`ref<string | null>`) is **the** answer to "which preset is currently running". Both the design view (`PresetsSidebar`) and the live view (buttons, controller twins, section members) read it; whoever changes it must change it through one path.

That path is **`setActivePreset(presetId, opts?)`** in `app/components/engine/composables/preset-activation.ts`. Every entry point funnels through it:

- `PresetsSidebar` — `togglePresetApply` / category click
- `LiveButtonWidget`, `LiveControllerTwinWidget` — preset-mapped buttons
- `use-section-binding.ts` — section members (`sectionPress`)
- the `preset.set` live op — remote activations

`setActivePreset` does three things:

1. **`applyActivePreset(ctx, presetId)`** — the pure core transition: stop the previously-active preset (resetting its channels/effects), apply the target preset, set `selectedPresetId`. Works against either the engine store or a project-load `ReplayContext`.
2. **Broadcast** — dispatches the `preset.set` live op (unless the change *came from* a remote op — see `isApplyingRemote()`).
3. **Persist** — `persistChange('SetActivePreset', …)` writes a `SetActivePreset` row to the change tail.

### Persistence across reload

Preset activation is **persisted but not undoable** — it must survive a reload and reach collaborators, but `Ctrl+Z` should not toggle presets.

- `selectedPresetId` is part of `ProjectSnapshot` (`serialize.ts`), restored by `applyProjectSnapshot`.
- Activations *after* the last snapshot are replayed from the tail via the `SetActivePreset` command (`preset-commands.ts`), whose `execute()` re-runs `applyActivePreset` so the restored fixture state matches the restored `selectedPresetId`. It is registered with `registerCommand` for replay but pushed via `persistChange()` — i.e. it bypasses the undo stack. See [Live Collaboration → Preset Activation](live-collaboration.md) for the broadcast + persist flow.
