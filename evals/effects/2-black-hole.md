# Scenario 2 — Black hole / explosion

Target effect 2: light between the room corners and the center — implode (black hole) or explode — with an acceleration curve and a collision color. No reference plugin: the agent builds it (patterns.md §3).

## Prompt

> Black hole effect: light gets sucked in from the corners of the room into the center, speeding up as it goes, and when it arrives the whole room flashes in a collision color. I also want the opposite, an explosion from the center out to the corners. Let me pick the start mode, the acceleration curve and the collision color.

## Setup

Reference scene (README), targets `g-tubes` + `g-pars` (rgb). Room center `cx, cy` = center of the room box (bounding box of all heads) — the same point as `Sample.u/v = 0.5`.

## Expected controls

- **Card params** (English, by what is seen):
  - Start / Mode: `enum` Implode · Explode (segmented, `optionLabels`).
  - Curve: `enum` mapped to `EASE_*`, labelled by feel (e.g. Linear · Accelerate · Slow down · Smooth), not "expoIn".
  - Collision color: `color` (default white or a saturated accent).
  - Front color(s) (`color` or `gradient`), Width (front thickness), optionally Flash length.
- Room-relative geometry from `Sample.u/v` with `ctx.worldAspect` (no handles needed); a center `point` handle is acceptable if measured in world `x/y` with aspect 1.
- `distribution.modes: ["none"]`, `apiVersion: "^1.3.0"`, `absolute` rgb.
- **Recipes**: e.g. *Black hole* (implode, accelerate, default), *Big bang* (explode, slow down), *Pulse* (fast, linear); speed in each.
- **Live page** (optional; offered as performer controls): sliders Width, Level (`strength`), Speed only for time mode. Mode, curve and colors are enums/colors → card and recipes only; the report says so.

## Observe

Points for the radial feature: the room center in world coordinates (replace `cx`, `cy`). Implode, 4-beat cycle (2 s at 120 BPM), 8 beats:

```json
{
  "mode": "preview", "modifierId": "ai-black-hole",
  "targets": { "groupIds": ["g-tubes", "g-pars"] }, "window": { "duration": "8 beats" },
  "points": [{ "x": 0.5, "y": 0.5 }],
  "expect": [
    { "path": "group.temporal.kind", "eq": "periodic" },
    { "path": "group.temporal.beats", "within": [3.8, 4.2] },
    { "path": "group.radial.r", "lte": -0.5 },
    { "path": "group.radial.kind", "eq": "inward" },
    { "path": "group.mirror.x.r", "gte": 0.8 },
    { "path": "group.mirror.y.r", "gte": 0.8 },
    { "path": "fixtures.*.range.max", "gt": 0.5 },
    { "path": "group.issues", "oneOf": [[], ["clamped"]] }
  ]
}
```

Collision flash: the implosion reaches the center at the end of each cycle (t = 2 s, 4 s). A window right after the hit, shorter than the flash:

```json
{
  "mode": "preview", "modifierId": "ai-black-hole", "targets": { "groupIds": ["g-tubes", "g-pars"] },
  "window": { "from": "2s", "duration": "0.1s" }, "fps": 60,
  "expect": [
    { "path": "fixtures.*.range.max", "gte": 0.8 },
    { "path": "group.color.name", "eq": "white" }
  ]
}
```

(`group.color.name` = the collision color's bucket, e.g. `"red"` when the user picks red.) A window in the middle of the cycle (`from: "1s"`, `duration: "0.2s"`) must not flash: `{ "path": "fixtures.*.range.max", "quantifier": "any", "lte": 0.05 }`.

Explode: `modifiers.update { "modifierId": "ai-black-hole", "params": { "<mode key>": "explode" } }` (or the *Big bang* recipe), then the first observe with `{ "path": "group.radial.r", "gte": 0.5 }` and `{ "path": "group.radial.kind", "eq": "outward" }`.

Curve: switching the curve must change the timing without breaking the radial sign — re-run the radial expectation for two curves.

## Pass criteria

- [ ] Builds and validates; no division by zero (NaN) at the center or with width 0.
- [ ] Implode is inward, explode outward; both symmetric (`mirror.x`, `mirror.y`); periodic at the set speed.
- [ ] The flash appears at the computed collision time in the collision color and only then.
- [ ] Start mode, curve and collision color are card controls with readable labels; recipes give distinct looks.
- [ ] Modifier (+ page) in one `apply`; **one Undo removes the whole change**.
- [ ] No `error` findings; the report explains what is not live-controllable (enums, colors).
