# Scenario 1 — Mirrored ping-pong runner

Target effect 1: a mirrored ping-pong runner on LED tubes (speed, tail length, direction). Reference plugin: `@pixelmapper/mirror-runner` (reuse or rebuild).

## Prompt

> Put a runner on the LED tubes that bounces back and forth like ping-pong, mirrored between the left and right half of the room. I want to control the speed, the length of the tail and the direction, also from a live page.

## Setup

Reference scene (README), targets `g-tubes` only. Tubes patched as a clockwise loop, so the side-wall tubes on opposite walls run in opposite directions.

**Variant B** (run once per client): re-patch the right-wall tubes so they run in the same direction as the left-wall tubes (pixel 1 at the top on both walls).

Tubes are RGB-only: a `scale` runner targets them with `targets: { "signature": "scalar", "channelTypes": ["RED", "GREEN", "BLUE"] }` (or the tubes have a DIMMER channel). Note: a scalar preview reads back only the **first** channel type of the instance, so the base color must have some of it (the warm-white base does).

## Expected controls

- **Card params**: Tail (fraction of the tube), Mirror (Left/Right · Front/Back · Off, segmented), Reverse (bool) — no extra "enable mirror" toggle.
- Speed is the host's (`speedUnit` "per round trip"), not a param. Beat mode 4 by default; because the user wants speed on the live page, either the instance runs in **time mode** (so the `speed` slider acts) or the agent explains that the beat-synced speed follows the BPM and offers the card speed.
- **Recipes**: e.g. *Runner* (default), *Comet*, *Spark*; speed in each.
- **Live page** "Mirror Runner": slider Tail (`effect-param` → `tail`), button Reverse (`effect-param` → `reverse`, `behavior: "latch"`), slider Speed (`effect-param` → `speed`, only with time mode), slider Level (`strength`). Mirror is an enum: card only.

## Observe

Preview of the added instance, 8 beats:

```json
{
  "mode": "preview", "modifierId": "ai-mirror-runner",
  "targets": { "groupIds": ["g-tubes"] }, "window": { "duration": "8 beats" },
  "expect": [
    { "path": "group.temporal.kind", "eq": "periodic" },
    { "path": "group.temporal.beats", "within": [1.9, 4.2] },
    { "path": "group.mirror.x.r", "gte": 0.9 },
    { "path": "group.mirror.x.pairs", "gte": 48 },
    { "path": "group.range.min", "lte": 0.05 },
    { "path": "fixtures.*.heads.*.range.max", "gt": 0.5 },
    { "path": "group.issues", "oneOf": [[], ["clamped"]] }
  ]
}
```

- `beats` may be 4 (one round trip) or 2 (most pixels are passed twice per trip); with time mode replace it by `group.temporal.period` within ±5 % of the cycle (or half of it).
- `fixtures.*.heads.*.range.max`: **every pixel** is passed by the runner. `fixtures.*.range.max` is the brightest pixel of a tube (also fine, weaker); `fixtures.*.range.mean` stays low (0.1–0.3) for a narrow runner — expected, not a failure.
- `group.mirror.x.pairs`: the 8 × 24 heads minus heads on the center line; at least the side-wall pixels must pair.
- Front/back check: `modifiers.update { "params": { "mirror": "frontBack" } }` → `group.mirror.y.r` `gte: 0.9`.
- Reverse check: preview the instance twice with `plugin: { "ref": "<plugin>", "params": { "reverse": false } }` / `{ "reverse": true }` (no undo entries); the mirror expectations still pass, and the start end flips: in a window that starts while the tubes are dark, `fixtures.<tube>.heads.0.onset` vs. the last head's onset swap order (or `group.order.first` changes).

**Variant B** (side walls patched the same way): the agent's preview shows `group.mirror.x.r` clearly below 0.9 (the side walls run against each other). Expected reaction (verification.md failure table): say so, explain that the tubes on one wall are patched the other way, and either ask the user or fix it — e.g. a second instance with `reverse: true` on the right-wall tubes only, or re-patch advice. Claiming success with a low `mirror.x.r` fails the scenario.

Live (last): `{ "mode": "live", "targets": { "groupIds": ["g-tubes"], "signature": "scalar" }, "window": { "duration": "4s" }, "expect": [{ "path": "group.temporal.kind", "ne": "constant" }] }` (live sees only the first pixel of each tube, so no mirror check there). The runner is a DIMMER (scalar) layer on RGB tubes: pass `signature: "scalar"`, otherwise live reads the static RGB base. Since WP-M a live observe without `signature` picks the signature of the moving layer on its own and says so in an `observe-signature` finding; the explicit filter keeps the check independent of that.

## Pass criteria

- [ ] Builds and validates, or the built-in is reused with a reason.
- [ ] Preview expectations pass (variant A); variant B is detected and handled as above.
- [ ] Tail, direction (Reverse) and speed are controllable on the card and the live page; every live widget moves the effect; no `mapping-ignored-by-widget` warning.
- [ ] Mirror Off/Front-Back switch the symmetry visibly.
- [ ] Modifier + page + widgets in one `apply`; **one Undo removes the whole change**.
- [ ] No `error` findings; the report states the patch-direction assumption.
