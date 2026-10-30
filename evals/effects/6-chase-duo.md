# Scenario 6 — Chase duo with overtake events

Target effect 6: two independent points chase each other around the room; an event (flash + color swap) fires on every overtake. No reference plugin (patterns.md §4 + §7).

## Prompt

> Two light points chase each other around the room along the tubes at different speeds. Every time one overtakes the other, flash the whole loop white and swap their colors. I want to set both speeds, both colors and the size of the points.

## Setup

Reference scene (README), targets `g-tubes` (clockwise loop). Same loop order as scenario 3: `spread: { "type": "order", "fixtureOrder": [tubes by angle around the room center] }`.

## Expected controls

- **Card params**: Speed A, Speed B (`number`, relative to the host speed, "laps per cycle", e.g. defaults 1 and 0.5 — never equal by default), Color A, Color B (`color`), Size (fraction of the loop), Flash length; optional Softness.
- Overtakes computed from time: `crossingTimeLoop` / `crossingCount` (`& 1` swaps the colors); no state.
- Host speed for the overall tempo (`speedUnit` e.g. "per cycle"); `distribution.modes` includes `"order"`; `absolute` rgb.
- **Recipes**: 2–4 (e.g. *Duo* default, *Hunt* close speeds, *Sprint*).
- **Live page** "Chase Duo": sliders Speed A, Speed B, Size, Level (`strength`); colors card-only (report says so).

## Observe

Defaults speed A = 1, B = 0.5 laps per cycle, starts 0 and 0.5, 4-beat cycle (2 s at 120 BPM): relative position `k(t) = −0.5 + 0.5·t` (t in cycles) → overtakes at t = 1, 3, 5 cycles = **2 s, 6 s, 10 s**. The pattern repeats every 2 cycles (8 beats). The agent must state its own formula and times; adapt the windows to them.

Overall, 16 beats (two pattern periods):

```json
{
  "mode": "preview", "modifierId": "ai-chase-duo",
  "targets": { "groupIds": ["g-tubes"] }, "window": { "duration": "16 beats" },
  "expect": [
    { "path": "group.temporal.kind", "eq": "periodic" },
    { "path": "group.temporal.beats", "within": [7.6, 8.4] },
    { "path": "group.spatial.kind", "ne": "uniform" },
    { "path": "fixtures.*.range.max", "gt": 0.5 },
    { "path": "group.issues", "oneOf": [[], ["clamped"]] }
  ]
}
```

Overtake flash — window inside the flash, every tube lit:

```json
{
  "mode": "preview", "modifierId": "ai-chase-duo", "targets": { "groupIds": ["g-tubes"] },
  "window": { "from": "2s", "duration": "0.1s" }, "fps": 60,
  "expect": [
    { "path": "fixtures.*.range.max", "gte": 0.8 },
    { "path": "group.color.sat.mean", "lte": 0.3 }
  ]
}
```

Between overtakes (`"from": "4s"`, `"duration": "0.3s"`): `{ "path": "fixtures.*.range.max", "quantifier": "any", "lte": 0.05 }` (only the two points are lit).

Color swap: in a window right before the overtake (`"from": "1.5s"`, `"duration": "0.1s"`) and right after the flash (`"from": "2.5s"`, `"duration": "0.1s"`), the tube that holds the faster point shows color A before and color B after (`fixtures.<id>.color.hue.mean`; pick the tube from the computed positions, or use `detail: "raw"`). This is the weakest check: if the agent cannot locate the points, it must say the swap was only verified visually.

Speed change: `modifiers.update { "params": { "<speedB key>": 0.75 } }` → overtakes every 4 cycles (16 beats); the pattern period grows accordingly (`group.temporal.beats` ≈ 16 over a 32-beat window, or `group.temporal.kind` `ne: "constant"` if the window is too short — say so).

Equal speeds: setting A = B must not produce NaN (`group.issues` without `nan`; `crossingTimeLoop` returns −1 for "never").

## Pass criteria

- [ ] Builds and validates; overtakes and swaps are pure functions of time.
- [ ] Points travel the loop in order; a white flash at each computed overtake time and only then; colors swap per overtake.
- [ ] Both speeds, both colors and the size controllable; speeds also on the live page.
- [ ] Modifier + page in one `apply`; **one Undo removes the whole change**.
- [ ] No `error` findings; the report gives the overtake times and what was verified.
