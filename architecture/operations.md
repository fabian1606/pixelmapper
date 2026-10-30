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

0. **Envelope** (`packages/agent-kit/src/envelope.ts`): a batch op is `{ "op": "<id>", "input": { …the op's input… } }`. `normalizeApplyRequest` runs first (in the `apply` tool and in `applyOperations`) and accepts a lenient form, each with an `info` finding naming the canonical entry: input keys placed next to `op` are folded into `input` (`input-folded`), `params` / `args` / `arguments` are read as `input` (`input-alias`), and a top-level `{ label, op, input }` becomes a one-op batch (`ops-wrapped`). An entry with `input` **and** extra keys is ambiguous and fails (`invalid-envelope`: "put `moves` inside `input`"). Decision: lenient instead of strict, because the folded form is unambiguous and the info note still teaches the canonical shape.
1. Each op's input is validated with Zod. An invalid input becomes an `invalid-input` error finding whose message names the expected shape: the Zod issues, the op's input summary from its JSON schema (`summarizeInputSchema`, `?` = optional) and the entry shape `{ "op", "input": … }`; a missing `input` says so explicitly.
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
   - `state.modifiers` are `modifiers.list` views (`blend`, `spread`, `speed.value`, `targets.fixtureIds`), not the stored instance (WP-L: `state.modifiers.N.blendMode` / `.distribution.*` / `.speed.timeMs` became `.blend` / `.spread.*` / `.speed.value`).
   - `results.N` is op N's output value; `results.N.value.<key>` (the outcome shape the output shows) is accepted as `results.N.<key>` when that value has no own `value` key (`resultValuePath`).
   - A failed expectation flags the tool call as an error but does not roll back.
9. **End-of-batch postconditions** (`OperationDefinition.verifyAfterBatch`): checked once after the last op, on the final state, for problems a later op of the same batch may still fix. Same semantics as `verify` (errors roll back). `modifiers.add` / `update` / `applyRecipe` use it for the `dark-base` warning, so "add chase, then `channels.set` the dimmer" in one batch stays quiet.

## Modifier ergonomics for agents (WP-L)

- **Colored scalar effects.** Waveform / Noise / Sequencer are `scale` output on the DIMMER, so the visible color is the fixtures' base color. `modifiers.add` / `update` take `color: "#rrggbb"` (`core/modifier-color.ts`): one `SetChannelValues` per fixture (RED/GREEN/BLUE of the targets with RGB, plus DIMMER 0 → full where it was 0) before the `SetModifiers`, same undo step. Output `baseColor { color, fixtureIds, dimmerRaised }`, info finding `base-color-set`. Decision: an option on the existing op instead of a new `fixtures.setColor`, because the common phrase "a blue chase" is then one op, and `channels.set` stays the general tool.
- **Dark base** (`core/modifier-dark.ts`): `dark-base` warning when targets of a `scale` / `bipolar` layer (or blend `multiply`) have DIMMER base 0 or an all-zero color base, unless the layer itself (absolute output) or an absolute layer below drives that channel. The message names the fixtures and carries a ready `channels.set` op. `observe` adds the same warning in preview (the instance) and live (stack layers on the observed fixtures).
- **Blend semantics** per output kind are in the `modifiers.add` / `update` description and `docs/ai/skills/effect-authoring/ui-rules.md` *Output and blend*.
- **Direction.** Agent ops do not use the card's PCA main axis (which can run front-to-back on a two-row rig): `targetShape` replaces it with `directedAxis` (`core/modifier-spread.ts`): left→right along x by default (top→bottom when all targets share one x; a single fixture keeps its own axis). `spread.direction` (`left-to-right` | `right-to-left` | `top-to-bottom` | `bottom-to-top`) on `spatial` / `order` re-places the handle / order line; `origin`/`end`, `ranks`/`fixtureOrder` and `reverse` still win. The card UI keeps PCA.

## Apply result shape (WP-L)

- `diff`: field-level `{ entity, field, from, to }`. A whole new / removed entity is ONE entry `{ field: "added", to: <summary> }` / `{ field: "removed", from: <summary> }` with a one-line summary (e.g. `Wave · chase · scalar DIMMER · 21 fixtures · order left→right · 8 beats/cycle · blend add`), listed first. Path change: `diff.N.to.<field>` of an added entity no longer exists; read new entities through `state.*` or `detail: "full"`.
- `affected`: `{ entity, summary }`; `detail: "full"` on the request adds `view` (the complete post-state, `null` when removed).
- Modifier entities in the diff and inspect `modifier:<id>` use the `modifiers.list` view (`core/modifier-view.ts`), so list → update round-trips; the stored `ModifierInstance` is unchanged.
- The `apply` tool's text summary (`diffLines`) groups entities with identical changes into one line (`fixture bar-1, bar-2, … (21): channels.3.value 0 → 255`), new entities first.

## Agent vocabulary of live mappings

Live widgets are stored as `{ type: 'effect-param', effectId, paramKey: 'params.<key>' }` but every agent-facing view speaks the input vocabulary of `live.addWidget`: `{ modifierId, paramKey: '<key>' }` (built-in keys `strength` / `speed` / `fanning` stay; a plugin param named like a built-in keeps `params.`). Mapping happens at the presentation boundary only (`fromLiveMapping` / `presentParamKey` in `core/live-mapping.ts`, `liveWidgetView` / `livePageView` in `core/live.ts`): `live.listPages`, inspect `livePage:<id>` / `liveWidget:<id>` (`app/utils/agents/host-inspect.ts`) and the `liveWidget:*` entries of the apply diff.

## Coordinates

All positions are in normalized world space 0–1. `x` runs left to right and `y` top to bottom on the 2D canvas, the same space as plugin `Sample.x/y`. `z` is the height above the floor, normalized like `x`/`y`. Every operation description states this.

**Rotation and orientation** (`core/orientation.ts`). `rotation` is a clockwise yaw in degrees on the 2D canvas (y down): a local offset (px, py) lands at (px·cos − py·sin, px·sin + py·cos), the same formula in `beamWorldPx`, `kindToWorld` and rs-engine-canvas (`canvas.rotate`). A bar whose heads run along its own +x axis therefore runs left→right at 0°, top→bottom at 90°, right→left at 180° and bottom→top at 270°. Because not every fixture lays its pixels out along local x (OFL matrices, drawn LED strips), `project.digest`, `fixtures.find` and `fixtures.get` report the *measured* direction for every multi-head fixture: `orientation { runs: "left→right" | "top→bottom" | … (8 compass words), axis { dx, dy } (unit vector head 0 → last head), firstHead, lastHead }` from the layout-packet head positions. `fixtures.rotate` accepts per entry either `rotation` or `alignTo: "x" | "y" | { dx, dy }` (+ `direction: "forward" | "reverse"`), which resolves to the rotation that makes head 0 → last head point that way, and reports the new direction as an `orientation` info finding. The agent `screenshot` tool (see `architecture/mcp-bridge-protocol.md`) draws the same geometry.

## Catalog

| Namespace | Operations |
|---|---|
| `project` | `digest` (q), `setBpm` (m, through the `engine.bpm` live-op) |
| `fixtures` | `find` (q: ids, kind, signature, channelType, groupId, name, bbox), `get` (q), `move` (m, with z), `rotate` (m: `rotation` or `alignTo` + `direction`), `setKindConfig` (m), `arrange` (m, `core/fixtures-arrange.ts` + pure geometry `arrange-layout.ts`: `fixtureIds` / `groupIds` on a `layout` `grid` (rows/cols/auto, bounds, gap; shorter last row centered) / `line` (from → to) / `circle` \| `arc` (center, radius, start/end angle, clockwise, 0° = +x) / `distribute` (axis, from/to) / `align` (edge, value); `order` position (default) \| given; `orient` keep \| along \| across or absolute `rotation`. One MoveFixture (+ RotateFixture); verify checks every fixture on its target / the shape ±1e-6 and no two on one spot (error; warning for align/distribute). Rotation convention (from `beamWorldPx` / `kindToWorld`): local +x = world +x at 0°, clockwise on the y-down canvas; multi-head fixtures lay heads along local +x, so at 0° head 0 is left and heads run toward +x. `orient` subtracts each fixture's own first→last head axis (`localHeadAxis`)); views carry `rotation` + measured `orientation` |
| `nodes` / `groups` / `selection` | `nodes.rename` (m), `groups.list` (q), `selection.get` (q) |
| `extensionData` / `channels` | `extensionData.set` (m), `channels.set` (m: normalized values, channelType / index / `#rrggbb`) |
| `modifiers` | `list` (q), `add`, `update`, `remove`, `reorder`, `applyRecipe` (m), `trigger` (action). The mutations use the card vocabulary (ADR B3): plugin alias or hash, targets, params, recipe, spread `same` / `spatial` / `order` / `within`, strength, blend, speed; each produces one `SetModifiers`. `trigger { modifierId, paramKey, action: press \| release \| click, clicks? }` (`core/modifier-trigger.ts`) presses a `trigger` param through `setEffectTrigger` (same path as the card button / live button): no undo step, validates that the param is a trigger, returns `engineTimeMs` (the plugin's `ctx.timeMs` clock) and `wallTimeMs` for a following live `observe`; a click burst uses one timestamp for all edges. Ops addressing an instance resolve it through `requireModifier` (`core/shared.ts`): unknown ids fail with `modifierNotFound`, an id several instances share fails as ambiguous (`modifierAmbiguous`); `reorder` refuses a stack with shared ids, `live.*` effect-param mappings onto one get the error finding `modifier-ambiguous`, and `list` then adds `duplicateIds: [{ id, count }]` and readable `warnings` |
| `plugins` | `list`, `get` (q); `build`, `publish` (action) |
| `live` | `listPages` (q), `addPage`, `addWidget`, `updateWidget`, `removeWidget` (m; `effect-param` mappings by modifier id + param key: sliders → number/int/bool/trigger and the built-in keys, buttons → bool (latch/hold) and trigger, xy pads → point; other combinations warn `mapping-ignored-by-widget`) |

## Tests

- `app/utils/operations/**/*.test.ts`: every mutation is checked with execute, then undo, then an identical state fingerprint. Further tests cover dry runs, rollback, the single undo step and the diff.
- `composite-command.test.ts`: covers order, atomicity, payload replay, inverse, the requires gate and rebase.
- `event-log.test.ts`: covers ring eviction and actor attribution.
