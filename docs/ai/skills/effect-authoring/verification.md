# Verifying effects with `observe`

`observe` renders or captures the output and returns a compact text report plus a JSON feature object (`json`); `expect` entries are checked against that JSON. Expectations are `{ path, <comparator> }` with comparators `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `within: [min, max]`, `oneOf`, `contains`, `exists` (several in one entry must all hold). `*` in a path fans out (`quantifier: "all"` default, or `"any"`); numeric segments index arrays; `length` gives an array's length. An `all` over zero matches fails — usually a wrong path. There is **no negation**: `contains` passes when the element *is* present; to assert an issue is absent use `oneOf` with the allowed arrays (see *Issues*).

## How to observe

1. **Preview first**: `observe { "mode": "preview", "modifierId": "<id>", "targets": …, "window": { "duration": "8 beats" } }` renders just that instance through the real engine core on the real fixture and head positions, deterministically. Choose the window to cover ≥ 2 cycles of the effect (8 beats for a 4-beat cycle).
   - Preview the **added instance** (`modifierId`): it has the blend, speed, spread and targets you chose. A bare `plugin: { ref, params }` preview is a fresh instance with the manifest defaults — no recipe, speed 1 beat per cycle, blend `add` — so an `absolute` plugin may saturate on a lit base (`stuck-1`).
   - `modifierId` **and** `plugin: { ref, params }` together render the stored instance with that plugin and the params merged over its own (try a new build or param values without touching the project).
   - Other layers of the stack are not rendered in a preview.
2. **Read the report once without `expect`** when unsure, then write expectations against the JSON paths below.
3. **Then `live`** (`"mode": "live"`, a few seconds) to check what the app really outputs with the whole stack: overrides above the effect, blackout, presets. Live samples are per fixture (first head only) and carry no spread coordinate, so pixel-level and `spatial`/`radial` features are coarser than in a preview; the engine must be running.
4. **Targets**: the group/fixtures the effect is on — observing `"all"` mixes in untouched fixtures and weakens spatial features. `targets: { "groupIds": ["g1"] }` also adds `groups.g1.*` (the same features per group).
5. `detail: "fixture"` lists every fixture in the text report; `fixtures.<id>.*` is always in the JSON. `detail: "raw"` adds per-frame values (`raw.times`, `raw.fixtures.<id>`) for onset-order checks no feature covers.
6. Request extras: `points: [{ "x", "y" }]` (world) for `radial` — a preview adds the instance's `point` params with `ui.canvas: "point"` itself; `mirror: { "x": <world x>, "y": <world y> }` moves the mirror lines (default: the room center, the same line as `Sample.u/v = 0.5`).

## JSON paths

```
window       { from, duration, fps, frames, mode, bpm }
signature    "scalar" | "rgb" | "panTilt"
group        features over all samples          groups.<id>   same, per requested group
fixtures.<id> { name, x, y, heads, range, color?, temporal, issues[] }
```

| Path | Content |
|---|---|
| `group.range.{min,max,mean,sd}` | intensity 0–1 (rgb: HSV value) |
| `group.color.hue.{min,max,mean}`, `group.color.sat.mean`, `group.color.value.{min,max,mean,sd}`, `group.color.name` | rgb only; hue in degrees (`min > max` when the arc wraps through 0°); name `red` `orange` `yellow` `green` `cyan` `blue` `purple` `magenta` `white` `black` `gray` `mixed` |
| `group.temporal.kind` | `constant` · `periodic` · `aperiodic` · `events` |
| `group.temporal.{hz,period,beats,beatLock,strength}` | periodic only; `beatLock` = beats within 3 % of 1/8…16 |
| `group.temporal.band` | aperiodic only: `[loHz, hiHz]` |
| `group.temporal.on`, `.off` | events only: arrays of crossing times (s from the window start) of the group's mean intensity (≤ 12 crossings, mostly-on/off signal) |
| `group.spatial.kind` | `uniform` · `chase` · `independent` · `gradient` · `constant` |
| `group.spatial.direction` | chase/gradient: unit vector `[x, y]` → `direction.0` (x), `direction.1` (y); world x left→right, y top→bottom |
| `group.spatial.{step,speed,axis}` | chase: phase step between neighbours in cycles (8 fixtures in order → 0.125), world units/s, `"spread"` (follows the distribution: ranks / spatial) or `"position"` |
| `group.spatial.corr`, `.span` | independent: mean correlation; gradient: value difference |
| `group.radial.{r,speed,kind,from}` | Pearson r of lag vs. distance to the nearest point (positive = outward); `kind` `outward`/`inward`/`none` (\|r\| > 0.5); periodic effects use phase lags, others the time of peak intensity |
| `group.mirror.x.{at,r,pairs}` | left ↔ right across the vertical line `x = at`: r = correlation of mirrored pairs (1 mirror images, −1 complementary, ≈ 0 unrelated). Missing with < 2 pairs |
| `group.mirror.y.{at,r,pairs}` | front ↔ back across `y = at` |
| `group.active` | fraction of non-constant samples |
| `group.issues` | array, fixed order: `nan`, `constant`, `stuck-0`, `stuck-1`, `clamped` (or `no-targets`) |

## Expectations per effect property

| Property to prove | Expectation | Notes |
|---|---|---|
| it moves at all | `group.temporal.kind` `ne: "constant"` | constant = params kill the output (width 0, reach too small, points outside the rig) |
| periodic at the intended tempo | `group.temporal.kind` `eq: "periodic"`; `group.temporal.beats` `within: [3.8, 4.2]` (4-beat cycle) or `group.temporal.hz` `within: […]` | period = `speed.value` beats ÷ events per cycle (a ping-pong runner passes most pixels twice per cycle, so 2 or 4 beats can both be right) |
| locked to the BPM | `group.temporal.beatLock` `eq: true` | only for `speed.mode: "beat"` |
| radiates from the points | `group.radial.r` `gte: 0.7` (or `group.radial.kind` `eq: "outward"`) | room-corner/center effects without `point` params: pass `points` (world coordinates of the room corners / center) |
| converges to the points | `group.radial.r` `lte: -0.7` (`kind` `inward`) | |
| travels as a chase in a direction | `group.spatial.kind` `eq: "chase"`; `group.spatial.direction.0` `gt: 0.7` (left → right) | |
| follows an order / contour loop | `group.spatial.kind` `eq: "chase"`, `group.spatial.axis` `eq: "spread"`, `group.spatial.step` `within: […]` (≈ 1 / fixtures per loop) | the run direction around the loop is not a feature: use `detail: "raw"` and compare onset frames of the first ranks |
| mirror symmetry | `group.mirror.x.r` `gte: 0.9` (left/right) or `group.mirror.y.r` (front/back); `group.mirror.x.pairs` `gte: 4` | |
| all fixtures take part | `fixtures.*.range.max` `gt: 0.2` | catches tubes outside the reach or not targeted |
| has contrast | `group.range.min` `lte: 0.05` and `group.range.max` `gte: 0.8` | "lit against dark" |
| colors as asked | `group.color.hue.mean` `within: [170, 200]` (cyan); `group.color.name` `oneOf: ["cyan", "mixed"]` | a palette of two hues gives a wide `hue` arc and `mixed` |
| a flash at a computed moment | window around the moment: `window: { "from": "<t>s", "duration": "0.3s" }`, `fps: 60`, `fixtures.*.range.max` `gte: 0.9`; a window between flashes: `fixtures.*.range.max` `quantifier: "any"` `lte: 0.05` | every fixture lit only during the flash; compute `t` from your `crossingTime*` formula |
| a whole-room flash / blackout as events | `group.temporal.kind` `eq: "events"`, `group.temporal.on.length` `gte: 1` | needs a mostly on/off group signal |

### Issues

`clamped` means ≥ 20 % of the frames of a varying component sit exactly at 0 or 1. That is **normal** for lit-against-dark effects (dark gaps between fronts, bright heads) — only treat it as a problem for smooth modulators. `stuck-0` / `stuck-1` (a fixture constant dark / full) and `nan` are real problems.

- Nothing stuck or NaN, clamping allowed: `{ "path": "group.issues", "oneOf": [[], ["clamped"]] }`
- No issue at all: `{ "path": "group.issues.length", "eq": 0 }`
- One fixture: `fixtures.<id>.issues` the same way.

### Triggers (`trigger` params)

The tools cannot press a button. What can be verified:

- **Preview, yes — as a frozen trigger state.** In a preview the engine clock (`ctx.timeMs`) is the window time in ms (`window.from` = `from × 1000`), and a trigger value in the instance params is encoded as stored. Pass the state with `modifierId` + `plugin: { "ref": "<plugin>", "params": { "<key>": { "pressed": …, "pressedAt": …, "releasedAt": …, "clicks": … } } }`, timestamps in preview ms at or before `window.from` (ms-since values before a timestamp clamp to 0):
  - held: `{ "pressed": true, "pressedAt": 0, "clicks": 1 }` → e.g. blackout `group.range.max` `lte: 0.02`;
  - just released: `{ "pressed": false, "pressedAt": 0, "releasedAt": 0, "clicks": 1 }`, window 0–3 s → the release look (a wave: `group.radial.r` `gt: 0.5` with `points`; dark afterwards in a later window);
  - double click: `{ "pressed": false, "pressedAt": 0, "releasedAt": 0, "clicks": 2 }` (held: `"pressed": true`).
  The state does not change during the window, so one observation shows one state; a hold → release sequence needs one observation per state.
- **Live, only with the user.** No operation presses a trigger. Ask the user to press/hold the live button and capture `observe { "mode": "live", "window": { "duration": "4s" } }` meanwhile; otherwise say in the report that the live button was not tested.
- Never put trigger timestamps into `modifiers.update`: stored values use the app's engine clock, which you do not know.

## Apply-side checks

In the `apply` call, the subject is `{ state, diff, results }` (`state` = bpm, fixtures, groups, modifiers, livePages, selection; `results.<i>` = the value of op *i*):

```json
[
  { "path": "state.modifiers.*.id", "quantifier": "any", "eq": "ai-corner-wave" },
  { "path": "state.livePages.*.id", "quantifier": "any", "eq": "ai-corner-wave-page" },
  { "path": "results.0.modifierId", "eq": "ai-corner-wave" },
  { "path": "results.2.widgetId", "exists": true }
]
```

## Reacting to failures

| Symptom | Likely cause | Fix |
|---|---|---|
| `temporal.kind = constant`, everything dark | width/reach too small, points far from the targets, wrong signature/channels, an override layer above (live) | check params vs. the room box; `modifiers.list` for the stack order; `targets.signature` |
| constant and bright / `stuck-1` | scale output at 1 everywhere (tail ≥ cycle), `absolute` writing a constant, or a bare `plugin` preview blending `add` on a lit base | shorten tail / width; check `pos` uses `ctx.timePhase`; preview the added instance |
| period off by 2× | ping-pong passes each point twice; mirror doubles events | adjust `speed.value`, not the code |
| `radial.r` near 0 | distances measured in `u/v` against world points; no `points` passed for a room-relative effect | use `dist2(s.x, s.y, px, py, 1.0)`; pass `points` |
| radial sign wrong | `+`/`−` of `timePhase` swapped | Outward is `d / spacing − timePhase` |
| `mirror.x.r` low on side-wall tubes | the flip is per pixel by room half (`s.u > 0.5`); tubes running along y on opposite walls only mirror when patched in **opposite** directions (as a loop around the room). Patched the same way, they run against each other | check the tube directions (`fixtures.get`: rotation, head offsets); offer `Reverse` per tube (a second instance on one wall) or ask the user how the tubes are patched |
| `mirror.x.r` low on tubes along x | flip decided per fixture instead of per pixel | flip per pixel with `s.u` |
| `mirror.x` missing | < 2 mirror pairs: the rig is not symmetric around the line | pass `mirror: { "x": … }` at the real symmetry line |
| chase in the wrong order | ranks along the main axis, not the contour | pass `fixtureOrder` sorted by angle around the room center |
| one fixture always dark | outside `reach`, not targeted, or no channel of the signature | `fixtures.<id>.range`; `fixtures.get`; trace notes in the findings |
| build ok, nothing on stage in `live` but fine in `preview` | layer order / blend / strength 0, live blackout or preset override | `modifiers.list`; move the layer (`index`) or change `blend` |

Fix params with `modifiers.update`; fix behavior in code, rebuild, and replace the instance in one batch (`modifiers.remove` + `modifiers.add` with the same `id`). Re-run the same expectations. If something cannot be verified (live triggers, look and feel), say so in the report instead of claiming success.
