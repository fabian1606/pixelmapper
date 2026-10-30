# Scenario 3 — Edge run around the room

Target effect 3: a segment of light rotating around the room contour (segment length, speed, direction). No reference plugin (patterns.md §4 *Path along ranks*).

## Prompt

> A segment of light that runs around the whole room along the walls, all the tubes as one continuous loop. I want to set how long the segment is, how fast it goes and which way it turns — and have that on a live page too.

## Setup

Reference scene (README), targets `g-tubes` (8 tubes, clockwise loop patching). The PARs are not part of the loop.

## Expected controls

- **Loop order** from the host spread: `modifiers.add` with `spread: { "type": "order", "fixtureOrder": [8 tube ids sorted by angle around the room center] }`, starting at a corner. `modifiers.list` must show ranks 0–7 following the outline (no two neighbours across the room).
- Plugin reads `s.spatial` (+ the pixel position `p / ctx.rankCount` inside each tube); `distribution.modes` includes `"order"`.
- **Card params**: Length (fraction of the loop), Softness (optional), Direction. For direction either the spread's reverse (card) **or** a plugin `bool` (e.g. "Counter-clockwise") — not both. Because the user wants direction on the live page, a plugin `bool` is required (the spread's reverse cannot be mapped to a live widget).
- Speed: host speed (`speedUnit` e.g. "per lap"); beat 4 or 8 by default.
- **Recipes**: 2–4 (e.g. *Lap* short segment, *Snake* long soft segment, *Sprint* fast).
- **Live page** "Edge Run": slider Length (`effect-param` → length key), button Direction (`effect-param` → the bool, latch), slider Level (`strength`), Speed slider only with time mode (or the report explains the beat-synced speed).

## Observe

Preview, 4-beat lap, 8 beats:

```json
{
  "mode": "preview", "modifierId": "ai-edge-run",
  "targets": { "groupIds": ["g-tubes"] }, "window": { "duration": "8 beats" },
  "expect": [
    { "path": "group.temporal.kind", "eq": "periodic" },
    { "path": "group.temporal.beats", "within": [3.8, 4.2] },
    { "path": "group.temporal.beatLock", "eq": true },
    { "path": "group.spatial.kind", "eq": "chase" },
    { "path": "group.spatial.axis", "eq": "spread" },
    { "path": "group.spatial.step", "within": [0.003, 0.2] },
    { "path": "group.range.min", "lte": 0.05 },
    { "path": "fixtures.*.range.max", "gt": 0.5 },
    { "path": "group.issues", "oneOf": [[], ["clamped"]] }
  ]
}
```

- `spatial.step` is the median phase step between neighbouring samples along the spread: ≈ 1/8 between tubes, smaller between pixels of one tube — the range above accepts both. A step near 0.5 or a `position` axis means the order is wrong.
- **Direction**: no feature reports the turning sense of a loop. Observe one lap with `detail: "raw"` and compare the frames at which the tubes of rank 0, 1 and 2 peak (`raw.fixtures.<id>[frame]`, one value per fixture): increasing with the rank = the outline order (clockwise from the start corner). Toggle the direction param and repeat: the order flips.
- **Length**: `modifiers.update` the length to the minimum and the maximum: `group.range.mean` grows with the length.
- Pixel continuity: a tube patched against the loop direction makes the segment jump inside that tube. Observe cannot see it (raw values are per fixture, heads merged), so the agent must state the assumed patch direction or ask; the tester checks it on the canvas.

Live (last): `{ "mode": "live", "targets": { "groupIds": ["g-tubes"] }, "window": { "duration": "4s" }, "expect": [{ "path": "group.temporal.kind", "ne": "constant" }] }`.

## Pass criteria

- [ ] Builds and validates.
- [ ] The segment travels the outline in loop order (no cross-room jumps), periodic per lap, beat-locked.
- [ ] Length, speed and direction controllable; direction works from the live page.
- [ ] Ranks set explicitly (`fixtureOrder`/`ranks`) and visible in `modifiers.list`.
- [ ] Modifier + page in one `apply`; **one Undo removes the whole change**.
- [ ] No `error` findings, no `mapping-ignored-by-widget` warning; the report states the start corner and the assumed patch direction.
