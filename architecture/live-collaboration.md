# Live Collaboration

Pixelmapper supports real-time multi-user editing over a single Supabase Realtime channel per project (`project:{id}`). Two clients open the same project and see each other's cursors, selections, modifier scrubs, fixture drags, and committed undo/redo history — with deterministic, time-synchronized effect rendering.

## Overview

Two sync tiers run on the same channel:

| Tier | Mechanism | Persistence | Use case |
|------|-----------|-------------|----------|
| **1. Committed Commands** | `SerializableCommand` → Supabase Edge Function `push-change` → `project_changes` table → Postgres CDC INSERT | Yes | Undoable history, version replay |
| **2. Live Ops** | `LiveOp` → Realtime Broadcast (`live_ops` event) | No | Cursor, selection, modifier scrub, drag preview, base channel values |

Tier 1 is the "source of truth" for project state; Tier 2 is for high-frequency ephemeral state that must reach other clients within a frame and need not survive a reload.

## State Layers

State splits into three layers; only the first two are synchronized:

| Layer | Examples | Synced? |
|-------|----------|---------|
| **A. Engine/Canvas state** (shared) | Fixture positions, channel `stepValues`, modifier params, active preset, BPM, `clockEpoch` | Yes — one truth across clients |
| **B. Per-user awareness** | Cursor, fixture selection, "I'm editing modifier X", chaser edit-step | Yes, but `Map<userId, T>` — each user sees the others' state |
| **C. Local UI** | Sidebar choice (Color vs Dimmer), property tabs, camera zoom/pan, expanded sections | No — stays local |

Validating example: User A opens the Colors sidebar, User B opens the Dimmers sidebar (Layer C — independent). User A scrubs a hue slider — that mutates a shared modifier param (Layer A) — and User B's canvas re-renders the new color even though their sidebar is still on Dimmers. User A selects three fixtures, User B selects two others (Layer B — both visible as colored outlines on the other client).

## Tier 1 — Committed Commands

Every undoable mutation is a `SerializableCommand` (`app/components/engine/commands/serializable-command.ts`) with a `commandType` discriminator and `toPayload()` for JSON serialization. The registry (`registerCommand`) also provides `commandFromPayload(commandType, payload, ctx)` for replay.

Flow:

1. UI action runs `useHistory().execute(cmd)`
2. `useHistory` calls `persistenceHooks.pushChange(commandType, payload)` (set by `engine-store.ts`)
3. The hook calls the `push-change` Edge Function (`supabase/functions/push-change/index.ts`), which inserts a row into `public.project_changes` and returns the assigned `sequence_number`
4. Postgres CDC fires an INSERT event on the table (publication enabled by `supabase/migrations/002_enable_realtime.sql`)
5. The CDC listener in `app/composables/use-collaboration.ts` receives the event and:
   - skips it if `sequence_number <= lastSeenSequenceNumber` (already processed)
   - skips it if `user_id === user.value?.id` (own command, already in local history)
   - otherwise reconstructs the command via `commandFromPayload(...)` with `engineStore.getReplayContext()` and runs `history.executeRemote(cmd)` — which executes locally without re-pushing

`lastSeenSequenceNumber` is also bumped on local pushes so a self-CDC event is silently absorbed.

## Tier 2 — LiveOp Bus

The live bus is a Pinia store (`app/stores/live-bus-store.ts`). It owns the channel reference, an op registry, per-tab session ID, batching state, and the echo-guard flag.

### Registry pattern

```ts
registerLiveOp<Payload>('cursor.move', {
  scope: 'per-user' | 'shared',
  throttle: 'raf' | 'immediate' | <number-of-ms>,
  merge: 'replace' | 'append',          // default 'replace'
  apply: (payload, userId, ctx) => { ... },
});
```

All ops live in `app/composables/live-ops/*.ts`. They register at module load via the side-effect import `app/composables/live-ops/index.ts`, which is itself imported by `use-collaboration.ts`.

The `apply` handler receives a `LiveContext` containing the per-user maps (`cursors`, `remoteSelections`, `remoteEditingModifier`, `remoteEditSteps`), trigger functions for `triggerRef`, identity helpers (`emailOf`, `colorOf`), and the `engineStore`.

### Dispatch flow

`liveBus.dispatch(type, payload)`:

1. Looks up the registered config; drops if not connected
2. Wraps the payload as `{ type, payload, userId, sessionId: TAB_SESSION_ID }`
3. Routes by throttle:
   - **immediate** — sent right away via one-op `channel.send`
   - **raf** — pushed into `pendingReplace` (or `pendingAppend`); a single `requestAnimationFrame(flushPending)` is scheduled
   - **number** — pushed into pending; a `setTimeout` per type schedules the flush
4. `flushPending` collects all `pendingReplace` values + `pendingAppend` items and sends them in **one** `channel.send({ type: 'broadcast', event: 'live_ops', payload: { ops } })`

### Echo guard

Two mechanisms prevent feedback loops:

1. **Per-tab `TAB_SESSION_ID`** — a random string generated at module load. Inbound ops with the same `sessionId` are dropped. We do not filter by `userId` because the same user editing in two tabs should still see their own ops.
2. **`isApplyingRemote()` flag** — set to `true` while `handleIncoming` runs an op's `apply`. Reset on the next `nextTick`, *not* synchronously, because Vue watchers (default `flush: 'pre'`) fire on the next microtask. The central channel-sync watcher in `engine-store` checks this flag and skips re-dispatching when a remote op caused the mutation.

### Connection setup (`use-collaboration.ts`)

- Channel is created with `{ private: true, presence: { key: userId }, broadcast: { self: false, ack: false } }`
- Before subscribe: `await supabase.auth.refreshSession()` then `await supabase.realtime.setAuth()` (private channels require a non-expired JWT for RLS on `realtime.messages`)
- On `SUBSCRIBED`:
  - `liveBus.connect({ channel, userId })` (guarded so reconnect doesn't double-wire)
  - `channel.track({ userId, email, clockEpoch })` — clock epoch carried in presence
- On `CHANNEL_ERROR`: refresh session and re-auth so the next reconnect succeeds
- `presence: 'sync'` builds the `presenceUsers` list (drives `CollaboratorsPanel`) and converges `clockEpoch` to the minimum across all peers
- Postgres CDC INSERT listener attached to the same channel for Tier 1

## Op Catalog

| Op | Layer | Scope | Throttle | Merge | What it does |
|----|-------|-------|----------|-------|--------------|
| `cursor.move` | B | per-user | raf | replace | Sets `cursors[userId] = { wx, wy, email, color }` |
| `selection.set` | B | per-user | immediate | replace | `remoteSelections[userId] = new Set(ids)` — drives WASM-rendered colored outlines |
| `modifier.editing` | B | per-user | immediate | replace | Awareness: which modifier the user is highlighting |
| `chaser.editstep` | B | per-user | immediate | replace | Active chaser step the user is editing (per fixture) |
| `fixture.drag` | A | shared | raf | replace | Live drag of `fixturePosition.{x,y}` — calls `triggerCanvasSync` + `triggerRef(sceneNodes)` |
| `channel.update` | A | shared | raf | replace | Bulk channel state — `stepValues[]` and `colorValue` per fixture/channel |
| `modifier.update` | A | shared | raf | replace | Incremental param patch on a single effect by id (`Object.assign(effect, changes)`) |
| `modifier.sync` | A | shared | raf | replace | **Full effects-list replace**, dispatched when a structural change (split) happens locally so remotes get the new effect tree atomically |
| `preset.set` | A | shared | immediate | replace | `{ presetId: string \| null }` — applies/stops the preset and updates `selectedPresetId` via `setActivePreset(…, { broadcast: false, persist: false })` |
| `engine.clock` | A | shared | immediate | replace | Sets shared `clockEpoch` (only adopts if remote epoch is earlier) |

## Special Concerns

### Shared Clock Epoch

Effects are time-driven (`elapsed` is fed into the WASM render every frame; noise/chaser patterns derive from it). If each client used `performance.now() - localStartTime`, two clients started seconds apart would render different patterns at the "same" moment.

Fix:

- `engine-store.ts` exposes `clockEpoch: ref<number>` (default `Date.now()`) and `setClockEpoch(ms)`
- The render loop computes `const elapsed = Date.now() - clockEpoch.value`
- Each client puts its `clockEpoch` in its `channel.track({ ..., clockEpoch })` presence payload
- On every `presence: 'sync'`, `use-collaboration.ts` computes `min(epoch across all presences)` and adopts it. `Date.now()` is wall-clock so the earliest epoch belongs to whoever started first; everyone else converges to it.
- The `engine.clock` op exists as a redundant push path; its `apply` only adopts the incoming epoch if it is strictly earlier than the local one.

Pinia setup-store unwrapping note: `engineStore.clockEpoch` is the unwrapped number — do **not** access `.value` on it from outside the store; that returns `undefined` and silently breaks convergence.

### Central Channel Sync Watcher

The deep watcher on `flatFixtures` in `engine-store.ts` already rebuilds the channels binary packet whenever any nested channel field changes. The same watcher is the central live-sync point:

```ts
watch(flatFixtures, () => {
  channelsPacket = buildChannelsBin(flatFixtures.value);
  channelsRevision.value++;
  if (!useLiveBusStore().isApplyingRemote()) dispatchChannelUpdate(flatFixtures.value);
}, { deep: true });
```

This replaces per-callsite `dispatchChannelUpdate` calls in components like `FixturePropertyControl.vue`, `FixtureColorPicker.vue`, `FixturePanTiltPad.vue`. Any UI mutation reaches all peers without per-component instrumentation. The `isApplyingRemote()` guard prevents echo loops when the mutation came from an inbound `channel.update` op.

`dispatchChannelUpdate` (`app/composables/dispatch-channel-update.ts`) builds a `{ channels: [{ fixtureId, channelIndex, stepValues, colorValue }] }` payload and dispatches `channel.update`.

### Modifier Split Sync

`getSafeEffectToMutate` in `app/components/engine/composables/use-chaser-modifiers.ts` splits an effect when the user edits it with only a subset of its target fixtures selected:

- Original keeps the unselected target IDs
- A clone is created via `cloneModifier` (which delegates to `cloneEffectsList` so all effect classes — Waveform/Noise/Sequencer/Color — are properly instantiated, not just Waveform)
- The clone gets a freshly generated UUID via `crypto.randomUUID()` so it is distinguishable from the original on remote
- The clone takes the selected target IDs and is added to `effectEngine.effects`

The dispatcher branches:

- **No split** (`didSplit === false`) → `liveBus.dispatch('modifier.update', { effectId, changes })` — the cheap incremental patch
- **Split** (`didSplit === true`) → `liveBus.dispatch('modifier.sync', { effects: JSON.parse(JSON.stringify(effectEngine.effects)) })` — the full effects list, so remotes can replace their tree atomically

The `modifier.sync` apply on the receiver runs `cloneEffectsList(effects)` to rebuild proper class instances, then `splice`s the existing `activeEffects` array in place. Subsequent `modifier.update` ops in the same drag carry the clone's new id, so they land on the correct effect.

### Effect Class Reconstruction From Plain JSON

`JSON.stringify` strips class info; `JSON.parse` returns plain `Object`s. Components that detect modifier type via `instanceof` (e.g. `ChaserModifiersList.modifierTypeName`) silently fall through to "Waveform" for any effect that has been round-tripped through JSON.

Three places hit this: `SetModifiersCommand` payloads (history replay), `deserializeProject` (project load from snapshot), and `modifier.sync` apply (remote receive).

The fix lives in `set-modifiers-command.ts`:

```ts
function instantiateEffect(effect: any): Effect {
  if (effect instanceof ColorEffect) return new ColorEffect();
  if (effect instanceof SequencerEffect) return new SequencerEffect();
  if (effect instanceof NoiseEffect) return new NoiseEffect();
  if (effect instanceof WaveformEffect) return new WaveformEffect();
  // Plain JSON — fingerprint by characteristic property
  if (effect?.colorParams) return new ColorEffect();
  if (effect?.sequencerParams) return new SequencerEffect();
  if (effect?.noiseParams) return new NoiseEffect();
  return new WaveformEffect();
}
```

`cloneEffectsList(effects)` calls this for every entry and copies the common + per-class properties onto the new instance. It is invoked by `SetModifiersCommand.execute/undo`, by `deserializeProject` in `app/utils/engine/serialize.ts`, and by the `modifier.sync` op apply.

### Preset Activation — both tiers, not undoable

Activating a preset must reach collaborators *within a frame* (Tier 2) **and** survive a reload (Tier 1) — but it must **not** sit on the undo stack. `setActivePreset` (`preset-activation.ts`) therefore does both pushes itself:

- **Tier 2** — dispatches the `preset.set` live op for immediate cross-client sync.
- **Tier 1** — calls `persistChange('SetActivePreset', { presetId })`. This is the same persistence hook `useHistory().execute` uses, but invoked directly so the change is written to `project_changes` and replayed on load **without** being pushed onto `past[]`. The `SetActivePreset` command is registered with `registerCommand` purely for tail replay; its `undo()` is a no-op.

Both pushes are skipped when `isApplyingRemote()` is true (the activation came from an inbound `preset.set`), and when called from the `SetActivePreset` replay command. `selectedPresetId` is also stored directly in `ProjectSnapshot` so a fresh snapshot doesn't depend on the tail.

## File Map

| File | Role |
|------|------|
| `app/composables/use-collaboration.ts` | Wires the Supabase channel, presence sync (incl. `clockEpoch` min), CDC listener, JWT refresh on `CHANNEL_ERROR` |
| `app/stores/live-bus-store.ts` | LiveOp registry, dispatch + rAF batching, echo guard (`TAB_SESSION_ID`, `isApplyingRemote` held until `nextTick`), per-user awareness maps |
| `app/composables/live-ops/index.ts` | Side-effect index — imports each op file so registrations happen at module load |
| `app/composables/live-ops/colors.ts` | Deterministic `userColor(userId)` — used by cursors, selections, presence |
| `app/composables/live-ops/cursor-ops.ts` | `cursor.move` |
| `app/composables/live-ops/fixture-ops.ts` | `fixture.drag`, `selection.set` |
| `app/composables/live-ops/modifier-ops.ts` | `modifier.update`, `modifier.sync`, `modifier.editing` |
| `app/composables/live-ops/channel-ops.ts` | `channel.update` |
| `app/composables/live-ops/preset-ops.ts` | `preset.set` — delegates to `setActivePreset` |
| `app/components/engine/composables/preset-activation.ts` | `setActivePreset` / `applyActivePreset` — the single funnel for preset activation (apply + broadcast + persist) |
| `app/composables/live-ops/engine-ops.ts` | `engine.clock` |
| `app/composables/dispatch-channel-update.ts` | Helper that serializes `flatFixtures` channels and dispatches `channel.update` |
| `app/components/engine/composables/use-history.ts` | `execute / executeRemote`, `lastSeenSequenceNumber`, persistence hooks, `persistChange` (persist a change without an undo entry) |
| `app/components/engine/commands/serializable-command.ts` | Command registry, `registerCommand`, `commandFromPayload`, `ReplayContext` |
| `app/components/engine/commands/set-modifiers-command.ts` | `cloneEffectsList`, `instantiateEffect` (fingerprint reconstruction) |
| `app/components/engine/composables/use-chaser-modifiers.ts` | `getSafeEffectToMutate` (split logic), `dispatchModifierUpdate` (`modifier.update` vs `modifier.sync` branching) |
| `app/utils/engine/serialize.ts` | `deserializeProject` runs effects through `cloneEffectsList` to restore class instances |
| `app/stores/engine-store.ts` | `clockEpoch`, central channel-sync watcher, render loop using shared epoch |
| `supabase/functions/push-change/index.ts` | Edge function — auth, validate, INSERT into `project_changes`, return `sequence_number` |
| `supabase/migrations/002_enable_realtime.sql` | `ALTER PUBLICATION supabase_realtime ADD TABLE project_changes` so CDC fires |
