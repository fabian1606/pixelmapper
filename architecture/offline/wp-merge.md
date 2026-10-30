# WP-MERGE — Generic 3-way merge and rebase adapters

Implements the merge part of [ADR 0004](../adr/0004-offline-first.md) (D4, D5, D7, §3.2 step 4, §3.3).
Code: `app/utils/sync/merge/`. The code is pure TypeScript: it has no Vue, Pinia or Supabase imports, and only imports types from `serialize.ts`, `types.ts`, `preset-types.ts` and `live/types.ts`.

```
merge/
  types.ts               MergeConflict, MergeResult, MergeOptions, EntityId
  values.ts              deepEqual, deepClone, isPlainObject, isEntityId
  context.ts             internal recursion context
  merge-values.ts        mergeValues, mergeObjects
  merge-entity-lists.ts  mergeEntityLists (+ entity-list detection)
  merge-order.ts         ordering rule
  adapters/
    registry.ts          registerRebaseAdapter, rebaseChange, pass-through default
    helpers.ts           result builders, scene/live lookups, conflict helpers
    modifiers.ts presets.ts scene.ts fixtures.ts channels.ts live-pages.ts engine.ts
    index.ts             registerBuiltinRebaseAdapters()
  index.ts               public API; importing it registers the built-in adapters
```

## Public API

```ts
mergeObjects<T>(base: object | undefined, local: T, remote: T, options?: { idKey?: string }): { value: T; conflicts: MergeConflict[] }
mergeEntityLists<T>(base: T[] | undefined, local: T[], remote: T[], options?: { idKey?: string }): { value: T[]; conflicts: MergeConflict[] }
mergeValues<T>(base: unknown, local: T, remote: T, options?): { value: T; conflicts: MergeConflict[] }
deepEqual(a, b): boolean;  deepClone<T>(v: T): T

interface MergeConflict {
  entityId: string | number | null;  // innermost entity, null outside entity lists
  path: (string | number)[];          // from the merge root; entity-list elements are addressed by id
  base: unknown; local: unknown; remote: unknown;
  kind: 'modify-modify' | 'remove-modify' | 'order';
}

registerRebaseAdapter(type: string, adapter: RebaseAdapter): void
rebaseChange(change: { type: string; payload: unknown }, current: ProjectSnapshot, previous?: ProjectSnapshot): RebaseResult
type RebaseAdapter = (payload, ctx: { current; previous? }) => RebaseResult
interface RebaseResult { payload: unknown; conflicts: MergeConflict[]; skipped?: string /* reason */ }
```

## Merge rules (§3.3)

| Situation | Result |
|---|---|
| Changed on one side | That side wins |
| Changed on both sides to the same value | That value, no conflict |
| Changed on both sides to different values | Local wins, `modify-modify` conflict |
| Entity added on one side | Kept |
| Entity added on both sides with the same id | Field merge with base `{}`. Fields that differ are conflicts, local wins |
| Entity removed on one side, untouched on the other | Removed |
| Entity removed on one side, modified on the other | Kept with the modification, `remove-modify` conflict |
| Nested plain objects | Merged recursively per key |
| Arrays whose elements are all objects with a unique `idKey` | Merged recursively as an entity list |
| Arrays of primitives, arrays without ids, duplicate ids | Atomic (local wins on a true conflict) |

Further details:

- `undefined` and a missing key are the same thing, so deleting a field counts as a change.
- `1` and `'1'` are different ids.
- Results never alias the inputs. Every value that is returned is deep-cloned, and this also works on Vue proxies. Inputs are never mutated.

**Ordering.** The ADR rule is: "remote order, with local-only additions inserted after their local predecessor". An addition with no placed predecessor goes to the front. I refined this in one way: the relative order of entities that all three sides share is treated like a field.

- If only the local side reordered them, the local order is the skeleton, and remote additions are inserted after their remote predecessor. Without this, an offline reorder (for example of modifiers via `SetModifiers`) would be silently dropped.
- If both sides reordered them differently, the local order wins and an `order` conflict is reported, consistent with D4.
- In every other case the remote order is used, exactly as the ADR says.

## Rebase adapters

The SyncEngine (WP-SYNC) calls `rebaseChange` once per pending outbox entry, in order. Each call uses `current` = new base + the pending changes rebased so far. If the SyncEngine also passes `previous` (the local state the change was originally applied to), adapters with after-only payloads can detect remote modifications. Every adapter works without `previous`.

A `skipped` change must be dropped from the outbox (acked locally, not pushed). If an adapter throws, `rebaseChange` logs a warning and falls back to pass-through. **Unknown types** pass through unchanged (`passThroughAdapter`). These include extension commands `'<ext>/<name>'`, whose payloads are opaque.

| Type | Strategy |
|---|---|
| `SetModifiers` | `mergeEntityLists(before, after, current.modifiers)` → `{ before: current, after: merged }` |
| `modifier.sync` (live-op) | `mergeEntityLists(previous?.modifiers ?? [], modifiers, current.modifiers)`. Without `previous`, remote additions survive, but a modifier deleted locally can reappear |
| `modifier.update` (live-op) | Pass through if the modifier exists, otherwise skip. With `previous`, remote edits of the same field are reported |
| `OverwritePreset` | Skip if the preset is gone. Categories have no ids, so the array is atomic: `mergeValues(oldCats, newCats, current.categories)`. Rebased `oldCats` = current, `presetName` = current name |
| `UpdatePresetMetadata` | Skip if the preset is gone. Per-field overwrite check; `before` is rebased to the current values |
| `DeletePreset` | Skip if already gone. Skip with a `remove-modify` conflict if the preset differs from the payload copy (it was modified remotely) |
| `SavePreset` | Pass through (UUID id; replay is idempotent by id) |
| `SetActivePreset`, `preset.set` | Skip if the preset is gone (`null` is allowed). With `previous`, a concurrent remote activation is a conflict |
| `color.override` (live-op) | Skip if the preset (`key`) is gone |
| `AddFixtures` | Pass through |
| `DeleteNodes` | Drop ids that no longer exist. With `previous`, keep nodes modified remotely (`remove-modify`). Skip if nothing is left |
| `GroupNodes` | Keep only node ids that still exist. Skip if none is left |
| `UngroupNodes` | Skip if the group is gone |
| `RenameNode` | Skip if the node is gone. Concurrent rename is a conflict (local wins); `oldName` = current name |
| `MoveFixture`, `RotateFixture` | Per fixture, a 3-way merge of before / after / current fields. Entries for missing fixtures are dropped. `before` = current |
| `UpdateDmx` | Skip if the fixture is gone. 3-way merge of `startAddress` |
| `SetFixtureKindConfig` | Skip if the kind fixture is gone. Field-level merge of `kind.config` |
| `SetExtensionData` | Skip if the owner (fixture or widget) is gone. 3-way merge of the single value |
| `SetChannelValues` | Per channel, merge `{ colorValue, chaserConfig }`; `stepValues` mirrors the merged chaser. Missing channels are dropped |
| `SetChannelRange` | Per channel, merge `{ rangeMin, rangeMax, defaultValue? }` |
| `fixture.drag`, `channel.update` (live-ops) | Drop entries whose fixture or channel is gone. Skip if empty |
| `live.addPage`, `live.addController` | Pass through |
| `live.updatePage`, `live.addWidget`, `live.addSection` | Skip if the page is gone |
| `live.moveWidget`, `live.updateMapping`, `live.setControllerInstance`, `live.updateChildMapping` | Skip if the widget is gone |
| `live.updateSection`, `live.setSectionMembers`, `section.setActive` | Skip if the section is gone |
| `live.batchMoveWidgets`, `live.batchSetGroupIds`, `live.groupWidgets`, `live.ungroupWidgets` | Keep only widgets that still exist. Skip if none is left |
| `live.removePage`, `live.removeWidget`, `live.removeSection` | Skip if already gone. With `previous`, skip with a `remove-modify` conflict if modified remotely |
| `live.removeController` | Skip if already gone |
| `engine.bpm` | Pass through. With `previous`, a concurrent BPM change is a conflict |
| `engine.speed`, `engine.clock` | Pass through (the clock is min-merged on apply) |

### Known limits

- **`live.setSectionMembers`** and **`live.updatePage`** with `sections`, and **`live.updateMapping`** (`mapping` is replaced whole): these are whole-value replacements with no `before`, so they cannot be 3-way merged. They replay last-writer-wins. Adding `before` to these payloads would make them mergeable.
- **`modifier.sync`** has no `before`. Without `previous`, local deletions can be resurrected. Adding `before` to the payload would fix this.
- **`OverwritePreset`**: `PresetCategory` has no id, so a concurrent edit of the same preset's categories is atomic (local wins).
- **`DeleteNodes`, `live.remove*`**: the remove-vs-modify check needs `previous`. Without it, the delete proceeds.
- **`SetActivePreset` / `preset.set`**: these have side effects on channels and modifiers when applied, which are not modelled here.
- **`modifier.update`**: its live-op `dedupKey` is the type alone, so scrubs on two different modifiers within one coalescing window collapse. This is an outbox concern (WP-P0), not a merge concern.
