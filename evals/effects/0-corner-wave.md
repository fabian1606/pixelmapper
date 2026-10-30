# Scenario 0 — Corner wave

Target effect 0: a wave from four draggable corner points. Reference plugin: `@pixelmapper/corner-wave` (the agent may reuse it or build its own; both pass).

## Prompt

> Make waves roll out from the four corners of the room across all the tubes and PARs, in cyan and magenta. I want to drag the four start points around on the canvas and set how far the waves reach.

## Setup

Reference scene (README). Targets: `g-tubes` + `g-pars` (all rgb). Room box from all heads.

## Expected controls

- **Card params** (3–6 primary, English, named by what is seen): colors (gradient, cyan → magenta), spacing between fronts, width, softness, direction (Outward / Inward, segmented), reach.
- **Canvas handles**: four `point` params with `ui.canvas: "point"` (labels A–D), set on add to the room corners inset ~5 % (`a ≈ (minX+5 %, minY+5 %)` …), card fields `tier: "advanced"`; reach as `number` with `ui: { canvas: "radius", anchor: "a" }`.
- A points count (`int` 1–4) may hide unused handles via `when`.
- **Recipes**: 2–4 distinct looks, one default (reference: *Corners*, *Implode*, *Ripple*); speed in every recipe; `distribution.modes: ["none"]` (own geometry, no spread dropdown).
- **Instance**: one modifier, `speed: { mode: "beat", value: 4 }` (one front per bar) unless the agent argues otherwise; blend `override` (absolute rgb).
- **Live page** "Corner Wave" (only required if the agent offers performer controls; the prompt does not ask for one): sliders Spacing, Width, Reach, Level (`strength`), all `effect-param` mappings to the new modifier id. No widgets for colors/points.

## Apply checks (in the agent's final `apply`)

```json
[
  { "path": "state.modifiers.*.id", "quantifier": "any", "eq": "ai-corner-wave" },
  { "path": "state.modifiers.*.params.a.x", "quantifier": "any", "within": [0.05, 0.25] },
  { "path": "state.modifiers.*.params.c.y", "quantifier": "any", "within": [0.65, 0.95] }
]
```

## Observe

Preview of the added instance (`modifierId`), 8 beats = 2 cycles:

```json
{
  "mode": "preview", "modifierId": "ai-corner-wave",
  "targets": { "groupIds": ["g-tubes", "g-pars"] }, "window": { "duration": "8 beats" },
  "expect": [
    { "path": "group.temporal.kind", "eq": "periodic" },
    { "path": "group.temporal.beats", "within": [3.8, 4.2] },
    { "path": "group.temporal.beatLock", "eq": true },
    { "path": "group.radial.r", "gte": 0.7 },
    { "path": "group.radial.kind", "eq": "outward" },
    { "path": "group.radial.from.length", "eq": 4 },
    { "path": "group.range.min", "lte": 0.05 },
    { "path": "group.range.max", "gte": 0.8 },
    { "path": "group.color.sat.mean", "gte": 0.5 },
    { "path": "fixtures.*.range.max", "gt": 0.2 },
    { "path": "group.issues", "oneOf": [[], ["clamped"]] }
  ]
}
```

`group.radial.from` lists the instance's four canvas points (preview adds them automatically). `clamped` is expected (dark gaps between fronts).

Inward check after `modifiers.applyRecipe { "modifierId": "ai-corner-wave", "recipe": "implode" }` (or `params: { "direction": "in" }`), window 4 beats:

```json
[{ "path": "group.radial.r", "lte": -0.7 }, { "path": "group.radial.kind", "eq": "inward" }]
```

Handle check: drag point A to the room center in the app, then `observe` again — `group.radial.from.0.x` follows the new value and `group.radial.r` stays ≥ 0.7.

Live (last): `{ "mode": "live", "targets": { "groupIds": ["g-tubes", "g-pars"] }, "window": { "duration": "4s" }, "expect": [{ "path": "group.temporal.kind", "ne": "constant" }, { "path": "group.range.max", "gte": 0.5 }] }`.

## Pass criteria

- [ ] Plugin builds and validates (`ok: true`, no error diagnostics) — or the built-in is reused with a reason.
- [ ] All preview expectations pass; implode flips the radial sign; live is not constant.
- [ ] Four draggable handles at the room corners and a reach ring around A; dragging moves the wave origins.
- [ ] Controls as above, English labels, recipes switch visibly different looks.
- [ ] Effect (+ page if built) added in one `apply`; **one Undo removes the whole change**.
- [ ] No `error` findings; no `mapping-ignored-by-widget` warning.
- [ ] Report names the controls, what `observe` confirmed and the assumptions.
