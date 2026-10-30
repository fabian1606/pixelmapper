# Scenario 4 — Crossing diagonals (X collision)

Target effect 4: two runners on the room diagonals cross in the center; a strobe fires at the crossing. Controls: speed, color pair, strobe. No reference plugin (patterns.md §5).

## Prompt

> Two lights race along the two diagonals of the room and cross in the middle. When they collide, strobe the whole room for a moment. I want to set the speed, the two colors and how long the strobe lasts.

## Setup

Reference scene (README), targets `g-tubes` + `g-pars` (rgb). The PARs sit on the diagonal ends (`par-tl` → `par-br` for runner A, `par-tr` → `par-bl` for runner B).

## Expected controls

- **Card params**: Color A, Color B (`color`, contrasting defaults, e.g. cyan / magenta), Size (runner radius), Strobe length (fraction of the cycle or ms, with `unit` if ms), optionally Strobe rate (Hz) and Softness.
- Room coordinates `s.u/s.v` with `ctx.worldAspect` (true diagonals of the room box); `distribution.modes: ["none"]`; `absolute` rgb; `apiVersion: "^1.3.0"`.
- Speed: host speed (`speedUnit` e.g. "per crossing"); the meeting time follows from it (half a cycle in patterns.md §5).
- **Recipes**: 2–4, e.g. *Crossfire* (default), *Slow X*, *Hard strobe*.
- **Live page** (optional, if offered): sliders Size, Strobe length, Level (`strength`), Speed only in time mode. Colors are card-only (not live-mappable) — the report says so.

## Observe

Assume a 4-beat cycle (2 s) with the meeting at half the cycle (t = 1 s, 3 s); adapt the times to the agent's formula (`crossingTime*`), which the agent must state.

General, 8 beats:

```json
{
  "mode": "preview", "modifierId": "ai-diagonals",
  "targets": { "groupIds": ["g-tubes", "g-pars"] }, "window": { "duration": "8 beats" },
  "expect": [
    { "path": "group.temporal.kind", "eq": "periodic" },
    { "path": "group.temporal.beats", "within": [3.8, 4.2] },
    { "path": "group.mirror.x.r", "gte": 0.8 },
    { "path": "fixtures.*.range.max", "gt": 0.5 },
    { "path": "group.issues", "oneOf": [[], ["clamped"]] }
  ]
}
```

`mirror.x`: runner B is runner A reflected across the vertical center line, so intensities mirror left ↔ right (colors are not compared).

Strobe at the crossing — window inside the strobe, every fixture flashes:

```json
{
  "mode": "preview", "modifierId": "ai-diagonals", "targets": { "groupIds": ["g-tubes", "g-pars"] },
  "window": { "from": "1s", "duration": "0.15s" }, "fps": 120,
  "expect": [
    { "path": "fixtures.*.range.max", "gte": 0.9 },
    { "path": "group.range.min", "lte": 0.1 }
  ]
}
```

(`range.min` low = it strobes, not a steady white.) Away from the crossing (`"from": "0.2s"`, `"duration": "0.3s"`): `{ "path": "fixtures.*.range.max", "quantifier": "any", "lte": 0.05 }` (most of the room is dark; only the runners are lit).

Colors: at the start of the cycle runner A is at the top-left corner — window `"from": "0s"`, `"duration": "0.1s"`: `fixtures.par-tl.color.hue.mean` within ±20° of color A's hue, `fixtures.par-tr.color.hue.mean` within ±20° of color B's.

Strobe length: `modifiers.update` it to half → the flash window shrinks (re-run the strobe window ending at the new length; a window just after it is dark again).

## Pass criteria

- [ ] Builds and validates; strobe computed from time (no state).
- [ ] Runners follow the diagonals and meet in the center; strobe exactly around the computed crossing; everything else dark.
- [ ] Speed, both colors and strobe length are controllable; recipes distinct.
- [ ] Modifier (+ page) in one `apply`; **one Undo removes the whole change**.
- [ ] No `error` findings; the report gives the crossing time formula and what was verified.
