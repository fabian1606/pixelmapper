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

Defaults speed A = 1, B = 0.5 laps per cycle, starts 0 and 0.5, 4-beat cycle (2 s at 120 BPM): relative position `k(t) = −0.5 + 0.5·t` (t in cycles) → overtakes at t = 1, 3, 5 cycles = **2 s, 6 s, 10 s**. The point **positions** repeat every 2 cycles (8 beats), but the colours swap at every overtake, so the full RGB pattern only repeats after two overtakes: **16 beats** (4 cycles). The agent must state its own formula and times; adapt the windows to them.

Overall, 32 beats (two full periods of 16 beats; a 16-beat window holds one period and cannot prove it):

```json
{
  "mode": "preview", "modifierId": "ai-chase-duo",
  "targets": { "groupIds": ["g-tubes"] }, "window": { "duration": "32 beats" },
  "expect": [
    { "path": "group.temporal.kind", "eq": "periodic" },
    { "path": "group.temporal.beats", "within": [15.2, 16.8] },
    { "path": "group.spatial.kind", "ne": "uniform" },
    { "path": "fixtures.*.range.max", "gt": 0.5 },
    { "path": "group.issues", "oneOf": [[], ["clamped"]] }
  ]
}
```

Alternative for the position period (8 beats, a 16-beat window suffices): read a colour component both colours share, e.g. with magenta / cyan the blue component is 1 in both, so `group.components.b.temporal.beats` `within: [7.6, 8.4]` follows the positions only. With colours that share no component, use the 32-beat check above.

**Windows from the computed positions.** Don't use fixed times: derive every window from the point positions. With cycle length `T` (s), loop position of point P `p_P(t) = start_P + speed_P · t / T` (laps, mod 1), `N` tubes in loop order (`fixtureOrder`) and `L = N · heads` pixels in the loop:

- overtake `k` at `t_k` = the k-th solution of `p_A(t) − p_B(t) ∈ ℤ` (`crossingTimeLoop`); with the defaults `t_k = 2, 6, 10 s`;
- flash window: `from = t_k`, `duration` = the flash length (≥ 2 frames: `fps: 60`, `duration ≥ 0.05 s`);
- between overtakes: a time `t_mid` inside the gap (`t_k < t_mid < t_{k+1}`, away from the flash), `duration` ≤ ¼ of the gap. **Not the plain midpoint**: with the defaults the midpoint 4 s (= 2 cycles) puts A at loop position 0 and B at 0.5 — with an even number of tubes both sit exactly on tube boundaries, where two tubes share the point and per-tube checks are ambiguous. Derive `t_mid` from the formulas so that both points are inside a tube: `frac(p_A(t_mid) · N)` and `frac(p_B(t_mid) · N)` within [0.25, 0.75]. Defaults on the reference rig (N = 8): `t_mid = 4.16 s` (u = 2.078 cycles: A at 0.625 of tube 0, B at 0.31 of tube 4); on a 4-tube rig: `t_mid = 4.31 s` (u = 2.156: A 0.625 into tube 0, B 0.31 into tube 2);
- point P inside a tube: the tube is `fixtureOrder[floor(p_P(t) · N)]`, its pixel `floor(p_P(t) · L) mod heads`. For a color check pick `t` where P is mid-tube (`frac(p_P(t) · N) ≈ 0.5`, at least within [0.25, 0.75]) and B is on another tube, with `duration` < the time P needs per pixel (`T / (speed_P · L)`) or use `fixtures.<tube>.heads.<pixel>` directly.

Overtake flash — window inside the flash, every tube (and pixel) lit:

```json
{
  "mode": "preview", "modifierId": "ai-chase-duo", "targets": { "groupIds": ["g-tubes"] },
  "window": { "from": "<t_k>s", "duration": "0.1s" }, "fps": 60,
  "expect": [
    { "path": "fixtures.*.heads.*.range.max", "gte": 0.8 },
    { "path": "group.color.sat.mean", "lte": 0.3 }
  ]
}
```

A 0.1 s window is a snapshot, so a constant flash is not a warning. Optional whole-room check: a window starting just **before** the flash (`from = t_k − 0.05`) → `group.order.direction` `eq: "simultaneous"` (onsets need a rising edge inside the window).

Between overtakes (`"from": "<t_mid>s"`, `"duration": "0.3s"`): `{ "path": "fixtures.*.range.max", "quantifier": "any", "lte": 0.05 }` (only the two points are lit).

Color swap: pick `t_before` (before `t_k`, after the previous flash) and `t_after` (after the flash of `t_k`) where the faster point A is mid-tube (see above), and observe each with `duration` ≈ 0.1 s, `fps: 60`: the tube that holds A shows color A before and color B after (`fixtures.<tube>.color.hue.mean`, or the pixel via `fixtures.<tube>.heads.<pixel>` with `detail: "raw"` for its color). The agent must give `t_before`, `t_after`, the tube and the formula. If it cannot locate the points, it must say the swap was only verified visually.

Speed change: `modifiers.update { "params": { "<speedB key>": 0.75 } }` → overtakes every 4 cycles (16 beats), first at 2 cycles: **4 s, 12 s, 20 s**. Positions repeat every 4 cycles (16 beats; A 1 cycle, B 4/3 cycles), the full RGB pattern with the colour swap every 8 cycles (32 beats): `group.temporal.beats` ≈ 32 needs a 64-beat window; the shared-component check (`group.components.b.temporal.beats` ≈ 16) needs 32 beats. If the window is too short, check the flash times instead and say so.

Equal speeds: setting A = B must not produce NaN (`group.issues` without `nan`; `crossingTimeLoop` returns −1 for "never").

## Pass criteria

- [ ] Builds and validates; overtakes and swaps are pure functions of time.
- [ ] Points travel the loop in order; a white flash at each computed overtake time and only then; colors swap per overtake.
- [ ] Both speeds, both colors and the size controllable; speeds also on the live page.
- [ ] Modifier + page in one `apply`; **one Undo removes the whole change**.
- [ ] No `error` findings; the report gives the overtake times and what was verified.
