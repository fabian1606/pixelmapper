# Verifying effects with `observe`

`observe` renders or captures the output and returns a compact text report plus a JSON feature object; `expect` entries are checked against that JSON (ADR 0002 §6). Expectations are `{ path, <comparator> }` with one comparator out of `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `within: [min, max]`, `oneOf`, `contains`, `exists`; `*` in a path fans out (`quantifier: "all"` default, or `"any"`); numeric segments index arrays; `length` gives an array's length. An `all` over zero matches fails — usually a wrong path.

## How to observe

1. **Preview first**: `observe { "mode": "preview", "modifierId": "<id>", "targets": …, "window": { "duration": "8 beats" } }` renders just that instance on the real fixture positions, deterministically. Choose the window to cover ≥ 2 cycles of the effect (8 beats for a 4-beat cycle).
2. **Read the JSON once without `expect`** when you are unsure of the feature names, then write expectations against the paths you actually see. The paths below follow ADR §6.3; the implementation may name some differently (see *Assumed paths*).
3. **Then `live`** (`"mode": "live"`, a few seconds) to check what the app really outputs with the whole stack: overrides above the effect, blackout, presets.
4. `detail: "fixture"` for per-fixture features when a group summary hides a problem (one fixture dark, one tube reversed).
5. Targets: the group/fixtures the effect is on — observing `"all"` mixes in untouched fixtures and weakens spatial features.

## Expectations per effect property

| Property to prove | Expectation (JSON path) | Notes |
|---|---|---|
| it moves at all | `group.temporal.kind` `ne: "constant"` | a constant result means params kill the output (width 0, reach too small, points outside the rig) |
| periodic at the intended tempo | `group.temporal.kind` `eq: "periodic"`; `group.temporal.beats` `within: [3.8, 4.2]` (4-beat cycle) or `group.temporal.hz` `within: […]` | period = `speed.value` beats ÷ events per cycle (a ping-pong runner passes each pixel twice per cycle) |
| locked to the BPM | `group.temporal.beatLock` `eq: true` | only for `speed.mode: "beat"` |
| radiates from the points | `group.radial.r` `gte: 0.7` | phase grows with distance to the nearest `point` param; negative r = converging (Inward) |
| converges to the points | `group.radial.r` `lte: -0.7` | |
| travels as a chase in a direction | `group.spatial.kind` `eq: "chase"`; `group.spatial.direction.x` `gt: 0` (left → right) | world axes: x left→right, y top→bottom |
| follows an order / contour loop | `group.spatial.kind` `eq: "chase"`; per-fixture onset times increase with rank (`detail: "fixture"`) | compare against the `ranks` from `modifiers.list` |
| mirror symmetry | `group.mirror.x.r` `gte: 0.9` (left/right) or `group.mirror.y.r` (front/back) | output of mirrored fixtures correlates; without that feature compare `fixtures.<left>.temporal.phase` with the mirrored fixture |
| all fixtures take part | `fixtures.*.range.max` `gt: 0.2` (`detail: "fixture"`) | catches tubes outside the reach or wrong targets |
| has contrast | `group.range.min` `lte: 0.05` and `group.range.max` `gte: 0.8` | "lit against dark" |
| colors as asked | `group.color.hueMean` `within: [170, 200]` (cyan) / `group.color.hueRange` | hue in degrees |
| no clamping / stuck values | `group.issues.clamped` `eq: false` (or `lte: 0.01`); `group.issues.stuck` `eq: false` | clamping = output piles up at 0/1: rescale, don't saturate |
| trigger: hold = blackout | press the trigger (live button / card), observe `live` while held: `group.range.max` `lte: 0.02` | a preview cannot press buttons; say so if you could not test it live |
| trigger: release = wave | `group.temporal.kind` `eq: "events"` after release, onset times growing with distance from the corners | |
| collision / overtake flash | `group.temporal.events.length` `gte: 1` within the window that contains the computed meeting time | compute the expected time from your `crossingTime*` formula |

Apply-side checks (in the `apply` call, subject `{ state, diff, results }`):

```json
[
  { "path": "state.modifiers.*.id", "quantifier": "any", "eq": "ai-corner-wave" },
  { "path": "state.livePages.*.id", "quantifier": "any", "eq": "ai-corner-wave-page" },
  { "path": "results.0.modifierId", "eq": "ai-corner-wave" }
]
```

## Reacting to failures

| Symptom | Likely cause | Fix |
|---|---|---|
| `temporal.kind = constant`, everything dark | width/reach too small, points far from the targets, wrong signature/channels, an override layer above | check params vs. the room box; `modifiers.list` for the stack order; `targets.signature` |
| constant and bright | scale output at 1 everywhere (tail ≥ cycle), or `absolute` writing a constant | shorten tail / width; check `pos` uses `ctx.timePhase` |
| period off by 2× | ping-pong passes each point twice; mirror doubles events | adjust `speed.value`, not the code |
| `radial.r` near 0 | distances measured in `u/v` against world points, or `aspect` ≠ 1 for world coords | use `dist2(s.x, s.y, px, py, 1.0)` |
| radial sign wrong | `+`/`−` of `timePhase` swapped | Outward is `d / spacing − timePhase` |
| mirror correlation low | flip decided per fixture vs. per pixel, tubes patched in opposite directions | per-pixel `s.u`/`s.v` flip; ask the user about tube orientation or add a `Reverse` |
| chase in the wrong order | ranks along the main axis, not the contour | pass `fixtureOrder` sorted by angle around the room center |
| clamping reported | sums of layers > 1 | `Mathf.max` instead of `+`, or normalize |
| one fixture always dark | outside `reach`, not targeted, or no channel of the signature | `detail: "fixture"`; `fixtures.get` |
| build ok, nothing on stage in `live` but fine in `preview` | layer order / blend / strength 0, live blackout or preset override | `modifiers.list`; move the layer (`index`) or change `blend` |

Fix params with `modifiers.update`; fix behavior in code, rebuild, and replace the instance in one batch (`modifiers.remove` + `modifiers.add` with the same `id`). Re-run the same expectations. If something cannot be verified (live triggers, look-and-feel), say so in the report instead of claiming success.

## Assumed paths

The observe implementation is built separately from this skill (WP-E). The tables above assume group-level features named after ADR §6.3: `group.range.{min,max,mean,sd}`, `group.color.{hueMean,hueRange,saturation,value}`, `group.temporal.{kind,hz,beats,beatLock,events}`, `group.spatial.{kind,direction,phaseStep}`, `group.radial.r` (phase vs. distance to the nearest `point` param), `group.mirror.{x,y}.r`, `group.issues.{clamped,stuck}`, and per-fixture `fixtures.<id>.…` with `detail: "fixture"`. When the report uses other names, follow the report.
