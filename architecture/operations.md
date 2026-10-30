# Operations layer

Implements ADR 0002 §4 (plan A0.2, A0.3, A1.1–A1.4). Every caller (later the UI, extensions, agents and the MCP bridge) changes the project through **operations**.

## Pieces

| Piece | File | Role |
|---|---|---|
| Types + Zod schemas | `packages/agent-kit/src/*` (`@pixelmapper/agent-kit`) | `OperationDefinition` (`query` / `mutation` / `action`), `Finding`, `Expectation` + evaluator, `Actor`, `ApplyRequest` / `ApplyResult` / `SemanticChange`, `ObserveRequest` / `ObserveReport`, `AgentHost`, `toJsonSchema` |
| Registry | `app/utils/operations/registry.ts` | unique ids (`namespace.name`, extensions `<extId>/<name>`), `list` / search, `describe` (JSON schemas, examples) |
| Read API | `app/utils/operations/read-api.ts` | `CoreReadApi`: plain, readonly views of fixtures, groups, modifiers, live pages, selection, BPM |
| Transactions | `app/utils/operations/apply.ts`, `diff.ts` | `applyOperations(request, { actor })` |
| Core catalog | `app/utils/operations/core/*.ts` | `registerCoreOperations()` |
| Composite command | `app/components/engine/commands/composite-command.ts` | one undo step for a batch; `Composite` payload with child payloads; replay, requires gate and rebase support |
| Event log | `app/utils/observability/event-log.ts` | ring buffer (5000) of attributed events; `useHistory` logs execute / undo / redo |

## Operation kinds

- **query**: reads state, returns a value.
- **mutation**: returns commands and never mutates state in `run`.
- **action**: a side effect outside history, e.g. `plugins.build`, `plugins.publish` or `modifiers.trigger`. Actions are skipped on `dryRun` and never rolled back. Build/publish are idempotent (content-addressed); `modifiers.trigger` is momentary performer input (like the live button) and changes modifier params without an undo step, so an action-only batch can have a non-empty diff and still reports "Ran", not "rolled back".

## Transaction semantics

1. Each op's input is validated with Zod. An invalid input becomes an `invalid-input` error finding.
2. Mutation commands run **immediately**, so later ops and `verify` see earlier effects through `ctx.read`.
3. Any error finding undoes every executed command in reverse. This covers an unknown op, invalid input, a throwing `run`, a failing command, and a `verify` error.
4. On success, the commands are recorded once as a `CompositeCommand` labelled `AI: <label>` for agent actors. The runner calls `useHistory().execute(cmd, { actor, applied: true })`, so the batch is a single undo step.
5. `dryRun` returns the same diff, findings and expectations, then restores the state.
6. Input key aliases (`input-aliases.ts`) are applied before validation, in `apply` and in inspect queries: `id` → `modifierId` wherever the schema requires `modifierId` (`modifiers.update`, `modifiers.applyRecipe`, `modifiers.trigger`), and a single `modifierId` / `id` → `modifierIds: [...]` (`modifiers.remove`). A missing id fails with a message naming the canonical key. Kept outside the Zod schemas so their JSON schemas stay intact (`z.preprocess` would render as `{}`).
7. Ops in one batch cannot read each other's results. To reference a new entity later in the same batch (e.g. a live slider mapped to a new modifier), choose its id yourself: `modifiers.add` and `live.addPage` take an optional `id` (1–64 letters, digits, `-`, `_`; must not exist yet). Effect + control page then stay **one** undo step.
8. `expect` is evaluated against `{ state, diff, results }`:
   - `state` holds `bpm`, `fixtures`, `groups`, `modifiers`, `livePages` and `selection`;
   - paths use dots, `*` fans out, and numeric segments index arrays;
   - `state.livePages` is the stored form (`mapping.effectId`, `paramKey: "params.<key>"`), unlike the views below.

## Agent vocabulary of live mappings

Live widgets are stored as `{ type: 'effect-param', effectId, paramKey: 'params.<key>' }` but every agent-facing view speaks the input vocabulary of `live.addWidget`: `{ modifierId, paramKey: '<key>' }` (built-in keys `strength` / `speed` / `fanning` stay; a plugin param named like a built-in keeps `params.`). Mapping happens at the presentation boundary only (`fromLiveMapping` / `presentParamKey` in `core/live-mapping.ts`, `liveWidgetView` / `livePageView` in `core/live.ts`): `live.listPages`, inspect `livePage:<id>` / `liveWidget:<id>` (`app/utils/agents/host-inspect.ts`) and the `liveWidget:*` entries of the apply diff.

## Coordinates

All positions are in normalized world space 0–1. `x` runs left to right and `y` top to bottom on the 2D canvas, the same space as plugin `Sample.x/y`. `z` is the height above the floor, normalized like `x`/`y`. Every operation description states this.

## Catalog

| Namespace | Operations |
|---|---|
| `project` | `digest` (q), `setBpm` (m, through the `engine.bpm` live-op) |
| `fixtures` | `find` (q: ids, kind, signature, channelType, groupId, name, bbox), `get` (q), `move` (m, with z), `rotate` (m), `setKindConfig` (m) |
| `nodes` / `groups` / `selection` | `nodes.rename` (m), `groups.list` (q), `selection.get` (q) |
| `extensionData` / `channels` | `extensionData.set` (m), `channels.set` (m: normalized values, channelType / index / `#rrggbb`) |
| `modifiers` | `list` (q), `add`, `update`, `remove`, `reorder`, `applyRecipe` (m), `trigger` (action). The mutations use the card vocabulary (ADR B3): plugin alias or hash, targets, params, recipe, spread `same` / `spatial` / `order` / `within`, strength, blend, speed; each produces one `SetModifiers`. `trigger { modifierId, paramKey, action: press \| release \| click, clicks? }` (`core/modifier-trigger.ts`) presses a `trigger` param through `setEffectTrigger` (same path as the card button / live button): no undo step, validates that the param is a trigger, returns `engineTimeMs` (the plugin's `ctx.timeMs` clock) and `wallTimeMs` for a following live `observe`; a click burst uses one timestamp for all edges. Ops addressing an instance resolve it through `requireModifier` (`core/shared.ts`): unknown ids fail with `modifierNotFound`, an id several instances share fails as ambiguous (`modifierAmbiguous`); `reorder` refuses a stack with shared ids, `live.*` effect-param mappings onto one get the error finding `modifier-ambiguous`, and `list` then adds `duplicateIds: [{ id, count }]` and readable `warnings` |
| `plugins` | `list`, `get` (q); `build`, `publish` (action) |
| `live` | `listPages` (q), `addPage`, `addWidget`, `updateWidget`, `removeWidget` (m; `effect-param` mappings by modifier id + param key: sliders → number/int/bool/trigger and the built-in keys, buttons → bool (latch/hold) and trigger, xy pads → point; other combinations warn `mapping-ignored-by-widget`) |

## Tests

- `app/utils/operations/**/*.test.ts`: every mutation is checked with execute, then undo, then an identical state fingerprint. Further tests cover dry runs, rollback, the single undo step and the diff.
- `composite-command.test.ts`: covers order, atomicity, payload replay, inverse, the requires gate and rebase.
- `event-log.test.ts`: covers ring eviction and actor attribution.
