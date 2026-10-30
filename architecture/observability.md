# Observability (observe-lite)

Implements ADR 0002 §6 (observation) as plan step M2. Entry point:
`observe(request: ObserveRequest): Promise<ObserveReport>` in
`app/utils/observability/index.ts`. The contract types (`ObserveRequest`,
`ObserveReport`, `Expectation`) live in `packages/agent-kit`; the `observe`
tool (WP-F) calls `observe` through `AgentHost.observe`.

```
request ─► resolveTargets ─► capture (preview | live) ─► Trace
        ─► analyzeTrace (features/*) ─► json ─► evaluateExpectations ─► renderReport ─► text
```

## Modules

| File | Role |
|---|---|
| `index.ts` | `observe()`: validation, defaults, mode choice, target resolution, findings, wiring |
| `targets.ts` | `resolveTargets` (selector → fixtures + named groups), `pickSignature`, `headSamples` (heads and world positions exactly as `buildLayoutBin`) |
| `preview.ts` / `preview-core.ts` | `preview` mode: one modifier instance in a private headless `rs-engine-core` |
| `capture.ts` | `live` mode: signature tuples via `liveHub`, DMX fallback, engine-timeline resampling |
| `live-signature.ts` | `live` mode: which signatures to capture (the stack on the targets), the reported one, signature findings |
| `types.ts` | `Trace` (the capture result), `parseTimeRef` |
| `features/*` | `range`, `color`, `temporal`, `spatial`, `radial`, `mirror`; `analyzeTrace` |
| `report.ts` | compact text report (ADR §6.4) |

## Request handling

- **Mode:** `preview` when `modifierId` or `plugin` is given, otherwise `live`.
  `sim` is not implemented yet; it falls back to `preview`/`live` with an
  info finding `observe-sim-unavailable`.
- **Window:** `window.duration` default `2s`; `window.from` default 0.
  TimeRefs: `'2s'`, `'500ms'`, `'8 beats'` (project BPM), or seconds. A
  window is capped at 3600 frames.
- **fps:** default 30.
- **Targets:** `'all'`, `'selection'`, ids (fixture **or** group ids) or a
  filter `{ ids | fixtureIds, groupIds, kind, signature, channelTypes, name }`
  — the `fixtures.find` keys plus the `modifiers.add` targets vocabulary, so
  a modifier's `targets` can be passed as they are (`fixtureIds: null` = all;
  `channelTypes` keeps fixtures with any of those channel types). Id sets
  union, the other keys narrow. Unknown keys are an `invalid-input` error
  naming the key (they used to be ignored, silently observing everything).
  Named groups additionally get their own features under
  `json.groups[<id>]`. Unknown ids produce `observe-unknown-target` warnings.
- **mirror:** optional `{ x?, y? }`: world x of the vertical / world y of the
  horizontal mirror line for `group.mirror`. Default: the center of the
  engine's room box (bounding box of every head in the layout — the same line
  plugins see as `Sample.u/v = 0.5`).
- **points:** optional `[{ x, y }]` (normalized world coordinates) for the
  radial feature. Previews add the instance's `point` params with a canvas
  hint (`ui.canvas === 'point'`) automatically, keyed by param key.
- Problems never throw: invalid input, unknown modifier/plugin and capture
  failures return a report with an `error` finding and `json: {}`.

## Preview mode

Preview renders **one** modifier instance through the **real WASM core**,
not a TypeScript twin of the render loop:

- `preview-core.ts` loads `rs-engine-core` once on the calling thread
  (browser: bundled wasm URL; tests/headless hosts: `setPreviewCoreLoader`).
- Each observation creates a fresh `WasmEngine` and a fresh
  `WorkerPluginBridge`; the bridge is installed as `globalThis.__pmPluginBridge`
  only for the synchronous render loop (`withPluginBridge`), so it never
  collides with other engines on the thread.
- The engine gets the project's full layout (`buildLayoutBin`: room box,
  head positions, z), its channel chasers (`buildChannelsBin`: base values)
  and a modifiers packet with only the observed instance. Frame/Sample
  filling (ABI 1.3 incl. room `u`/`v`, `worldAspect`, distribution, seeds),
  output mapping, blend and color systems are therefore exactly the engine's.
- After every frame, `read_head_signatures` (added to `rs-engine-core` for
  this; `(group, head, signature, channel type)` quads → 3 f32 each) reads
  the normalized working values per head, before range remap.
- The instance is either `modifierId` (stored instance, deep copy), `plugin`
  (a fresh `createModifier` with `plugin.params`, `plugin.signature` or the
  first manifest signature every target offers, restricted to the targets
  unless `targets: 'all'`), or both (the stored instance with the plugin
  swapped and params merged — e.g. right after `plugins.build`).
- Only observed fixtures the instance targets become samples; heads lacking
  the signature's channels are dropped (trace notes → `observe-note`).
- Frames are rendered at `from + i / fps` on a fresh engine, so `from` can
  look ahead. Stateful plugins start from fresh state at `from`.
- Each sample carries the instance's distribution coordinate (`spatial`,
  `rank`, from the TS distribution code) so spatial features can follow the
  spread (ADR B6).
- **Base values:** the programmed values of the channels (their chasers,
  as stored in the project — `fixtures.get` shows them), not what is on
  stage right now: no other layers, live overrides, presets or blackout.
  The report header says `preview (this layer on the programmed base)`;
  live says `live (full stack)`.
- Other modifiers of the stack are **not** rendered (isolation); `live`
  shows the full stack. A fresh instance blends `add` like a newly added
  modifier, so on a full base it may saturate — the report then says
  `stuck-1`, which is the real outcome.
- Cost: 64 fixtures × 2 s × 30 fps ≈ 15 ms after the first core load.

`app/utils/engine/room.ts` is a TS twin of `room.rs` (pinned to the Rust
test values) for host code that needs room coordinates; the preview itself
uses the Rust implementation.

## Live mode

`captureLive` subscribes one `signature` live target per fixture (the engine
worker reads the first head's tuple after each render) and records every
engine frame via `addFrameCallback`. Fixtures without a tuple fall back to
the coarse DMX bytes of their signature channels (wire value / 255, after
range remap; noted in the findings). Frames reach the main thread in
bursts, so they are placed on the engine's own timeline (`LiveFrame.timeMs`;
wall clock only when the engine time is missing, not increasing or reset)
and linearly resampled onto the fps grid. Live samples are per fixture (head
0), carry no `spatial` coordinate, and `from > 0` waits before capturing
(live cannot look ahead). No frames during the window → `observe-note`
("engine stopped?").

**Signature choice** (`live-signature.ts`). A requested `targets.signature`
wins. Otherwise the capture takes the signatures of the modifiers acting on
the observed fixtures (strength > 0, targets intersect), captures all of
them in one window (`captureLiveSignatures`), reports the first one whose
group output moves and adds findings: `observe-signature` (which signature
the report shows, and why) and one `observe-other-signature` per other
captured signature with its verdict and the filter to observe it in detail
(`signature: 'scalar'`, …). So a moving DIMMER layer on RGB fixtures no
longer reads as constant RGB. Without layers the default pick applies
(every target offers rgb → rgb, panTilt → panTilt, else scalar).

**Speed clock.** Each trace carries the speed clock of its layers (preview:
the instance's `speed.mode`; live: shared by every layer of the signature,
unknown when mixed). A `time` clock never yields `beatLock: true`; the
report says `matches 4 beats (time speed, not locked)` instead.

**Jitter.** Live traces compare each fixture's own period to the joint lag
with 5 % tolerance (preview 3 %), and up to 20 % of the own periods may
misfit when those signals still repeat at the joint lag (an own period
near half the window is estimated from few frames). Unrelated periods on
half the fixtures (1 Hz / 1.37 Hz) stay non-periodic.

## Feature JSON (expectation subject)

`report.json` is the subject of `request.expect` (agent-kit dot paths: `*`
fans out, numeric segments index arrays, `length` on arrays). Numbers are
rounded to ~4 significant digits; times in seconds relative to the window
start.

```
window      { from, duration, fps, frames, mode, bpm }
signature   'scalar' | 'rgb' | 'panTilt'
sources[]   { plugin, hash, modifierId?, output, blend, strength, spread }   (preview)
group       GroupFeatures over all samples
groups.<id> GroupFeatures per requested group (+ name)
fixtures.<id> { name, x, y, heads[], range, color?, temporal, issues[] }
raw         { times[], fixtures.<id>[frame][component],          (detail: 'raw' only)
              heads.<id>[head][frame][component] }
```

**Fixtures and heads.** A fixture's `range` pools every head and frame:
`max` is the brightest head (the max over heads), `min` the darkest,
`mean` the average over heads and frames. So:

| Question | Path |
|---|---|
| every fixture reaches X (some pixel of it) | `fixtures.*.range.max` |
| every pixel reaches X | `fixtures.*.heads.*.range.max` |
| average brightness of a fixture | `fixtures.*.range.mean` |
| head count | `fixtures.<id>.heads.length` |

`heads[i]` (head order = patch order) is compact: `range { min, max, mean }`,
`peak` (time of the first frame at the head's max) and `onset` (first
rising crossing of the observation's mid level — halfway between the
pooled min and max of all samples — missing when the head never crosses
it, or only starts above it). Times are seconds from the window start.
`temporal` / `color` of a fixture analyze its heads jointly; `issues` use
the head mean (a fixture is `stuck-0` only when every head is).

`GroupFeatures`:

| Path | Content |
|---|---|
| `count`, `samples` | fixtures, heads |
| `components.<c>.range` / `.temporal` | per component: `value` (scalar), `r`/`g`/`b`, `pan`/`tilt` |
| `range.{min,max,mean,sd}` | intensity: scalar value, rgb HSV value, panTilt both pooled |
| `color.hue.{min,max,mean}`, `color.sat.mean`, `color.value`, `color.name` | rgb only; hue in degrees, `min > max` when the arc wraps; name bucket `red`…`magenta`, `white`, `black`, `gray`, `mixed` |
| `temporal.kind` | `constant` · `periodic` · `aperiodic` · `events` |
| `temporal.hz`, `.period`, `.beats`, `.beatLock`, `.strength`, `.clock` | periodic: autocorrelation peak (+ sine-fit refinement); beat lock = beats within 3 % of 1/8…16 and the speed clock is not `time`; `clock` = `beat` / `time` when the layers' speed mode is known |
| `temporal.band` | aperiodic: `[loHz, hiHz]` holding 80 % of the spectrum energy |
| `temporal.on`, `.off` | events: threshold crossing times |
| `spatial.kind` | `uniform` · `chase` · `independent` · `gradient` · `constant` |
| `spatial.direction`, `.step`, `.speed`, `.axis` | chase: unit vector in world x/y, phase step between neighbours (cycles; 8 in order → 0.125), world units/s, `spread` (follows the distribution) or `position` |
| `spatial.corr` | independent: mean pairwise zero-lag correlation |
| `spatial.span` | gradient: value difference across the rig |
| `radial.{from,r,speed,kind}` | Pearson r of per-sample lag vs. distance to the nearest point (positive = outward), world units/s, `outward`/`inward`/`none` |
| `mirror.x.{at,r,pairs}` | left ↔ right: each sample is paired with the sample nearest to its reflection across the vertical line `x = at` (tolerance ≈ 0.6 × head spacing, samples on the line skipped); `r` = Pearson r of the paired intensity series (1 = mirror images, −1 = complementary, ≈ 0 = unrelated, e.g. a chase across the line). Missing with < 2 pairs |
| `mirror.y.{at,r,pairs}` | front ↔ back: the same across the horizontal line `y = at` |
| `order.{axis,direction,r,cyclic,span,first,last,onsets,of}` | onset order: Pearson r of each sample's first onset vs. its position along `axis` (`spread` = rank / spatial when every sample has one, else `layout` = fixture order, then head). `direction` `forward` (r ≥ 0.8: later along the axis), `reverse` (r ≤ −0.8), `simultaneous` (all onsets within one frame), `none`. `cyclic`: fitted after rotating the order (a loop entered mid-way, e.g. a chase around the room); `first` / `last` = `<fixtureId>.<head>`. Missing with < 2 onsets. Use it for one-shot runs (edge run, sweep); periodic chases are better read from `spatial` |
| `active` | fraction of non-constant samples |
| `issues[]` | `constant`, `stuck-0`, `stuck-1`, `clamped`, `no-targets`, `nan` |

Typical expectations:

```json
[{ "path": "group.temporal.kind", "eq": "periodic" },
 { "path": "group.temporal.hz", "within": [0.95, 1.05] },
 { "path": "group.spatial.kind", "eq": "chase" },
 { "path": "group.radial.r", "gt": 0.9 },
 { "path": "group.mirror.x.r", "gte": 0.9 },
 { "path": "fixtures.*.range.max", "gt": 0.5 },
 { "path": "fixtures.*.range.max", "gt": 0.05, "label": "no fixture stays dark" },
 { "path": "fixtures.*.heads.*.range.max", "gt": 0.5, "label": "every pixel lit" },
 { "path": "group.order.direction", "eq": "forward" }]
```

## Findings

| Code | Level | When |
|---|---|---|
| `invalid-input` | error | schema violation, preview without instance |
| `modifier-not-found`, `plugin-not-found` | error | unknown `modifierId` / plugin ref |
| `observe-failed` | error | capture threw (core/wasm not loadable) |
| `observe-zero-targets` | warning | no samples |
| `observe-stuck` | warning (info when intended) | fixtures stuck at 0 or 1 (`entityIds: fixture:<id>`) |
| `observe-unknown-target` | warning | selector id matched nothing |
| `observe-constant-output` | info | every sample constant |
| `observe-unavailable-values` | info | NaN values |
| `observe-note` | info | capture notes (fallbacks, untargeted fixtures, plugin traps) |
| `observe-sim-unavailable` | info | `mode: 'sim'` requested |

**Intended holds.** A constant or stuck output is only suspicious when the
request was looking for motion. `observe-stuck` is downgraded to `info`
(message ends with `Expected here: <reason>.`) when the hold is intended:

1. a snapshot window shorter than 0.5 s (flash / blackout checks);
2. a preview that freezes a trigger state via `plugin.params` (a held
   blinder or blackout is constant by design);
3. the request has expectations and all of them pass (the caller asserted
   the state it wanted).

The `issues` in the JSON and on the report's issues line are unchanged;
`observe-constant-output` is always `info` and not printed in the text.

## Report text

```
observe all · 0.0–2.0s · 30 fps · preview (this layer on the programmed base) · bpm 120
GROUP 8 fixtures · scalar · sources: @pixelmapper/waveform@sha256:3a9…(scale, add, 1.0)
  range    0–1.00 mean .11 sd .30
  temporal periodic 1.00 Hz · 2 beats · beat lock
  spatial  chase +x · step .126 · 1 u/s · position
  issues   clamped
EXPECT   ✓ group.spatial.kind = "chase" · ✗ …
```

Window bounds use one decimal, or two to three when the window is short
or its bounds need them (`1.05–1.15s`). The first `GROUP` block is always
the aggregate `group` (what `group.*` expectations test; titled
`GROUP combined ·` when named groups follow); per-group blocks follow when
the request names several groups or one that covers only part of the
samples. The spatial line ends with `mirror x r 1.00 @ .50 · y r -0.13 @ .50`
(Pearson r, then the line position) for moving groups; an `order` line
shows a non-`none` onset order (`forward along spread r 0.98 · f1.0 → f4.11
· span 1.2s · 48/48 onsets`).

`FIXTURE` lines list outliers only (constant/stuck/dark/different from the
group); `detail: 'fixture'` lists every fixture. Up to four non-trivial
findings follow as `WARNING`/`INFO` lines.

## Tests

- `features/index.test.ts`, `report.test.ts`: synthetic traces (sine/square/
  saw periods, chase, noise, events, radial grid, mirror, issues, zero samples).
- `observe.test.ts`: end-to-end through the real core in Node with the
  built-in `waveform`/`noise` plugins and a toolchain-compiled radial plugin
  (4 canvas points, `minDistToPoints`), plus live capture over a fake hub.
  Needs `bun run build:wasm && bun run build:plugins`.
- `rs-engine/core` `read_head_signatures_after_render`; `engine/room.test.ts`.

## Limits / next steps

- No intent/wire taps or per-modifier contributions yet (ADR §6.2); `sources`
  lists only the previewed instance.
- Live is per fixture (first head) and needs a running engine.
- `sim` (full-stack deterministic simulation with the project's BPM clock and
  live overrides) is reserved for a later step.
