# Effect patterns

Short AssemblyScript recipes built on `@pixelmapper/plugin-sdk` helpers. Each one is a pure function of `ctx` (time), `s` (the sample) and params. Copy the idea, not the slot numbers: compute your slots from your own manifest (`color` 3, `point` 2, `gradient` 33, `curve` 128, `steps` 18, `trigger` 4, everything else 1).

Helpers used below (all in the SDK): `dist2`, `dist3`, `minDistToPoints`, `nearestPointIndex`, `pulse`, `pingPong`, `mirror`, `ease` + `EASE_*`, `crossingTimeLine`, `crossingTimeLoop`, `crossingCount`, `envelope`, `triggerPressed`, `triggerMsSincePress`, `triggerMsSinceRelease`, `triggerClicks`, `fract`, `clamp`, `lerp`, `smoothstep` (no clamping: clamp first), `sampleGradient`, `hash01`.

## Ground rules

- **Pure render.** Nothing written in `render` survives to the next frame. "Events" (a collision, an overtake, a button release) are computed as *time since the event* from `ctx.timePhase`, `ctx.beatTime` or `ctx.timeMs`.
- **Time.** `ctx.timePhase` = cycles of the instance speed (unwrapped; the user's speed control and beat sync act on it). Use it for motion. `ctx.beatTime` = beats since the epoch (ignores the instance speed). `ctx.timeMs` = shared clock, for trigger timing.
- **Coordinates.** World `s.x/s.y` (isotropic, same space as `point` params and canvas handles) → `dist2(…, 1.0)`. Room `s.u/s.v` (0–1 across the rig's bounding box per axis) → `dist2(…, ctx.worldAspect)`, result in room-depth units. Height: `s.z` (world units; `s.z / ctx.worldDepth` in room space).
- **Pixels.** `s.headIndex` / `s.headCount` locate a pixel inside its fixture; `(<f32>s.headIndex + 0.5) / <f32>s.headCount` is a symmetric position 0–1 along a tube. `s.rank` / `s.spatial` come from the user's spread (`order`, `within`, `spatial`).
- **Output.** `scale` / `absolute` in [0, 1], `bipolar` in [−2, 2], never NaN. `scale` keeps the fixtures' programmed color (good for runners/chases on any rig); `absolute` rgb owns the color (good for palettes, collisions).
- **Performance.** Budget ≈ 50 000 per call + 2 000 per sample. No allocation per sample (allocate `StaticArray` fields once, fill them in `prepare`). Loops per sample: small and bounded (≤ 8 points). Precompute everything param-derived in `prepare`.
- **AssemblyScript.** Annotate float locals (`const f: f32 = 1.0 - x;`), `Mathf` not `Math`, casts `<f32>i`, no closures.

## 1. Distance fields and radial waves from N points

Points are `point` params with `ui.canvas: "point"` (world space). Copy them into a field once:

```ts
class Waves extends Modifier {
  pts: StaticArray<f32> = new StaticArray<f32>(8);   // up to 4 points, interleaved x, y
  count: i32 = 4;
  spacing: f32 = 0.25;
  prepare(p: Params): void {
    this.spacing = Mathf.max(p.get(0), 0.01);
    this.count = p.int(1);
    for (let i = 0; i < 8; i++) this.pts[i] = p.get(2 + i);   // a, b, c, d (2 slots each)
  }
  render(ctx: Frame, s: Sample, out: Out): void {
    const d = minDistToPoints(s.x, s.y, 1.0, this.pts, this.count);  // world: aspect 1
    const pos: f32 = d / this.spacing - ctx.timePhase;               // + timePhase = inward
    out.setScalar(pulse(fract(pos), 0.5, 0.4, 0.7));                 // one soft band per front
  }
}
```

- **Interference** instead of nearest: sum `pulse(...)` per point and `clamp` (or `Mathf.max`) — brighter where fronts cross.
- **Voronoi cells**: `nearestPointIndex(s.x, s.y, 1.0, this.pts, n)` → color per cell or a phase offset per cell (`+ <f32>idx * 0.25`).
- **Reach / size**: a `number` param with `ui.canvas: "radius"` anchored to a point; fade with `1 - smoothstep(clamp((d - 0.7 * r) / (0.3 * r), 0, 1))`. The radius is in world units, directly comparable to `d`.
- **Room-relative centers** without handles: `dist2(s.u, s.v, 0.5, 0.5, ctx.worldAspect)` (room center), or the four room corners `[0,0, 1,0, 1,1, 0,1]` with `minDistToPoints(s.u, s.v, ctx.worldAspect, corners, 4)`.

Full reference: `plugins/corner-wave` (examples/corner-wave).

## 2. Mirrored ping-pong runner along tubes

Position along the tube from the head index; flip the far half of the room; tail as a *time* delay so it folds back at the bounce.

```ts
render(ctx: Frame, s: Sample, out: Out): void {
  const n = s.headCount > 0 ? s.headCount : 1;
  let p: f32 = (<f32>s.headIndex + 0.5) / <f32>n;          // 0..1 along the tube
  if (s.u > 0.5) p = 1.0 - p;                               // mirror at the room's center line (use s.v for front/back)
  // pingPong(t) passes p rising at t = k + p/2 and falling at t = k + 1 − p/2
  const f: f32 = fract(ctx.timePhase);
  const rise: f32 = p * 0.5;
  const fall: f32 = 1.0 - rise;
  const since: f32 = f >= fall ? f - fall : (f >= rise ? f - rise : f + rise);
  const tailTime: f32 = this.tail * 0.5;                     // tail in tube lengths; one trip = half a cycle
  const v: f32 = since < tailTime ? 1.0 - since / tailTime : 0.0;
  out.setScalar(v * v);                                       // comet falloff
}
```

- Head without tail: `pulse(p, pingPong(ctx.timePhase), width, softness)`.
- Mirror at a dragged line: a `point` param with a canvas handle and `s.x > px` (world) instead of `s.u > 0.5`.
- A whole-room runner (not per tube): use `mirror(s.u, 0.5) * 2` (0 at the center line, 1 at the walls) as the position.
- Tube direction: the per-pixel flip gives a true left/right mirror image for tubes running **along x** (across the line). Tubes running along y on opposite side walls only mirror when they are patched in **opposite** directions (as a loop around the room); patched the same way, they run against each other (`group.mirror.x.r` stays low). Say in the description which patching it assumes, keep `Reverse`, and ask the user when the digest cannot tell.

Full reference: `plugins/mirror-runner` (examples/mirror-runner).

## 3. Converge / explode between corners and center (black hole)

Distance to the room center in room space, normalized so the corners are at 1; a front moves along it with an easing curve.

```ts
// params: [0] enum "start" (implode/explode), [1] enum "curve" (EASE_* index), [2] number width, [3..5] color "collision"
render(ctx: Frame, s: Sample, out: Out): void {
  const maxD: f32 = dist2(0.0, 0.0, 0.5, 0.5, ctx.worldAspect);              // center → corner
  const d: f32 = dist2(s.u, s.v, 0.5, 0.5, ctx.worldAspect) / maxD;          // 0 center … 1 corners
  const t: f32 = ease(this.curve, fract(ctx.timePhase));                     // accelerating front
  const front: f32 = this.implode ? 1.0 - t : t;
  const v = pulse(d, front, this.width, 0.6);
  // collision: the implosion reaches the center at t → 1; flash the whole room for the first 10 % of the next cycle
  const sinceHit: f32 = fract(ctx.timePhase);
  const flash: f32 = this.implode && sinceHit < 0.1 ? 1.0 - sinceHit / 0.1 : 0.0;
  out.setRgb(lerp(v, this.cr, flash), lerp(v, this.cg, flash), lerp(v, this.cb, flash));
}
```

Expose the curve as an `enum` whose options map to `EASE_*` indices (`["linear","in","out","inOut","expoIn","expoOut","sine","smooth"]` → 0…7), labelled by feel ("Accelerate", "Slow down", …).

## 4. Path along ranks (room contour loops)

The shared **order** spread gives every fixture a rank and `s.spatial` = rank / rankCount (0 at the first, 1 after the last) — a 1D loop coordinate. You choose the ranks in `modifiers.add`:

- Sort the target fixtures by **angle around the room center**: `atan2(y − cy, x − cx)` with `cx, cy` from the digest's bounding box; pass `spread: { "type": "order", "fixtureOrder": [ids in that order] }`. That walks the outline clockwise (y grows downwards on the canvas). For a rectangle of tubes, start at a corner.
- Equal ranks move together (`ranks: { "id": 0, … }`): e.g. give mirrored fixtures the same rank for symmetric loops.
- For pixels inside a tube along the loop: combine `s.spatial` with the head position, `pos = s.spatial + p / <f32>ctx.rankCount`.

Segment running around the loop:

```ts
const head: f32 = fract(ctx.timePhase);                     // reverse: 1 − head (or spread.reverse)
const d: f32 = fract(s.spatial - head);                     // 0 at the head, growing behind it (wraps)
out.setScalar(d < this.length ? 1.0 - d / this.length : 0.0);
```

Distance on a loop of length 1 (symmetric): `Mathf.abs(fract(a - b + 0.5) - 0.5)`.

## 5. Crossing diagonals and the collision flash

Two runners on the room diagonals, both at the center halfway through the cycle:

```ts
const t: f32 = fract(ctx.timePhase);
const da: f32 = dist2(s.u, s.v, t, t, ctx.worldAspect);            // A: top-left → bottom-right
const db: f32 = dist2(s.u, s.v, 1.0 - t, t, ctx.worldAspect);      // B: top-right → bottom-left
const a = pulse(da, 0.0, this.size, 0.5);
const b = pulse(db, 0.0, this.size, 0.5);
const since: f32 = fract(ctx.timePhase - 0.5);                      // cycles since they met at the center
const strobe: f32 = since < this.flashLen && fract(since * 40.0) < 0.5 ? 1.0 : 0.0;
// absolute rgb: runner colors (color params A/B) plus a white strobe, clamped
out.setRgb(
  clamp(Mathf.max(a * this.ar + b * this.br, strobe), 0.0, 1.0),
  clamp(Mathf.max(a * this.ag + b * this.bg, strobe), 0.0, 1.0),
  clamp(Mathf.max(a * this.ab + b * this.bb, strobe), 0.0, 1.0),
);
```

Runners with **different speeds** on one line: `crossingTimeLine(a0, va, b0, vb)` returns when they meet (−1 = never). On a **loop**: `crossingTimeLoop(a0, va, b0, vb, ctx.timePhase)` = time since the last meeting (always defined for different speeds) → feed it to a flash envelope.

## 6. Trigger envelopes (hold = blackout, release = wave, multi-click = blinder)

A `trigger` param (4 slots) is driven by the card button or a live `button` widget. Read it with the SDK; `render` stays pure because the host encodes press/release times.

Two output choices (see ui-rules *Output and blend*):

- **`absolute` with pass-through** (shown below) when the trigger must go **above** the programmed look (a real blinder, a white flash): idle writes the programmed values `s.base0..2`, the blinder writes 1.0, blackout 0.
- **`scale`** when the trigger only dims the programmed look (blackout, a dark wave): `1` = programmed level, so a "blinder" would equal the idle look.

```ts
// manifest: "output": "absolute", signatures ["scalar"]
// params: [0] trigger "hit" (4 slots), [4] number "waveSpeed" (room depths per second), [5] number "width"
corners: StaticArray<f32> = new StaticArray<f32>(8);
prepare(p: Params): void {
  // room corners in u/v: (0,0) (1,0) (1,1) (0,1)
  this.corners[2] = 1.0; this.corners[4] = 1.0; this.corners[5] = 1.0; this.corners[7] = 1.0;
  this.waveSpeed = p.get(4); this.width = p.get(5);
}
render(ctx: Frame, s: Sample, out: Out): void {
  if (triggerPressed(this.params, 0)) {
    out.setScalar(triggerClicks(this.params, 0) >= 2 ? 1.0 : 0.0);   // double click held: full blinder; else blackout
    return;
  }
  const ms = triggerMsSinceRelease(this.params, 0, ctx);           // TRIGGER_NEVER before the first release
  const d = minDistToPoints(s.u, s.v, ctx.worldAspect, this.corners, 4);
  const r: f32 = ms * 0.001 * this.waveSpeed;                       // shock-wave radius
  const wave = pulse(d, r, this.width, 0.7) * envelope(ms, 0.0, 1500.0);
  // Idle: pass the programmed value through; the wave lifts it towards full.
  out.setScalar(s.base0 + (1.0 - s.base0) * wave);
}
```

- `envelope(msSince, attackMs, decayMs)` → linear 0→1→0; shape with `ease(EASE_OUT_QUAD, …)`.
- `triggerClicks` counts presses in the current burst (`multiClickMs`, default 350). Blinder after release: `triggerClicks(...) >= 2 && msSinceRelease < 300`.
- Output when idle: decide explicitly (programmed level via `s.base0..2` pass-through vs. dark) and say it in the description. With `scale` output the same code would write `out.setScalar(wave)` (0 dark, 1 programmed level) — idle dark, no blinder above the programmed level.
- Test it with `modifiers.trigger` + live `observe`, or frozen states in a preview (verification.md *Triggers*).

## 7. Chase duo with overtake events

Two points on the contour loop (pattern 4) with different speeds; flash and swap colors whenever one overtakes the other:

```ts
const t = ctx.timePhase;
const a: f32 = fract(this.speedA * t);
const b: f32 = fract(0.5 + this.speedB * t);
const dA: f32 = Mathf.abs(fract(s.spatial - a + 0.5) - 0.5);
const dB: f32 = Mathf.abs(fract(s.spatial - b + 0.5) - 0.5);
const since = crossingTimeLoop(0.0, this.speedA, 0.5, this.speedB, t);   // time since the last overtake
const swap = (crossingCount(0.0, this.speedA, 0.5, this.speedB, t) & 1) == 1;
const flash: f32 = since >= 0.0 && since < 0.15 ? 1.0 - since / 0.15 : 0.0;
```

Then light `pulse(dA, 0, w, 0.5)` in color A (or B when `swap`), the same for B, and add `flash` as white. `speedA`/`speedB` are relative to the instance speed (cycles per cycle), so the user's speed and beat sync still work.

## 8. Color at the collision

- Fixed collision color: a `color` param, `lerp` from the runners' colors by the flash envelope (pattern 3).
- Palette per event: `sampleGradient(g, fract(<f32>count * 0.25), 1.0, c)` with `count = crossingCount(...)` — each collision gets the next palette color.
- Hue from the place: `nearestPointIndex` (pattern 1) → one palette entry per source.

## 9. Tails and softness

- **Edge softness**: `pulse(d, center, width, softness)` — 0 hard, 1 fully smooth. One `Softness` param is enough.
- **Spatial tail behind a moving head** (one direction): `fract(pos - head)` gives the distance behind; fade `1 - d / length` (linear) or squared (comet).
- **Time tail** (folds at bounces, works with any path): compute *time since the head passed this sample* analytically (pattern 2) and fade over a tail time.
- **Afterglow of an event**: `envelope(ms, 0, decayMs)` or `Mathf.exp(-since * k)` (pure, since `since` comes from time).

## 10. Beat sync

- Prefer `ctx.timePhase` and let the host speed do the sync: `speed: { "mode": "beat", "value": 4 }` → one cycle per bar, follows BPM changes, the user's speed slider still works.
- Need sub-beat structure on top (strobe 1/8 notes during a flash): `fract(ctx.beatTime * 2.0)` (eighths), independent of the instance speed. Use it only for rhythm accents, never for the main motion.
- `ctx.phaseSpeed` is cycles per second (0 = frozen); use it to convert ms-based things (trigger waves) into the instance tempo: `cycles = ms * 0.001 * ctx.phaseSpeed`.
- Random per beat/step (stable during the step): `hash01(s.seed, <u32>Mathf.floor(ctx.timePhase))`.
