# Scenario 5 — Momentary blackout + flash release

Target effect 5: one button — hold = blackout, release = shock wave from the room corners, double-click = blinder. Needs a `trigger` param (patterns.md §6).

## Prompt

> I need a hit button for the show: while I hold it, all lights go black; when I let go, a shock wave shoots out from the corners of the room; if I double-click it, flash everything at full like a blinder. Put the button on a live page.

## Setup

Reference scene (README), targets `g-tubes` + `g-pars`. Room corners in world coordinates from the room box (`minX, minY` …; ≈ `(0.1, 0.2)`, `(0.9, 0.2)`, `(0.9, 0.8)`, `(0.1, 0.8)` in the reference scene).

## Expected controls

- **Card params**: `trigger` "Hit" (default `{ "pressed": false }`, card button; optional `multiClickMs`), Wave speed, Wave width, Decay (how long the wave lives), optionally Blinder length.
- Behaviour decided explicitly and stated in the description and report: the **idle** output (programmed look passes through vs. dark), and whether the blinder fires while the second press is held or right after the double-click.
- `scale` output (blackout = 0, blinder = programmed level) or `absolute` rgb (blinder = white at 1); the report says which "full" means.
- `apiVersion: "^1.3.0"`; render pure (trigger timing via `triggerPressed`, `triggerMsSinceRelease`, `triggerClicks`).
- **Recipes**: 2–3 (e.g. *Shock wave*, *Slow swell*, *Snap*). Recipes do not set the trigger.
- **Live page** "Hit" (required): big `button` (`gridW`/`gridH` ≈ 6×6, a strong color) with `{ "type": "effect-param", "modifierId": "ai-hit", "paramKey": "hit" }` first, then sliders Wave speed, Decay, Level (`strength`).

## Observe (preview, frozen trigger states)

The tools cannot press the button; a preview renders a stored trigger state on the preview clock (ms from the window start). Each call: `modifierId` + `plugin: { "ref": "<plugin hash or alias>", "params": { "hit": … } }`.

Held → blackout:

```json
{
  "mode": "preview", "modifierId": "ai-hit", "targets": { "groupIds": ["g-tubes", "g-pars"] },
  "plugin": { "ref": "@ai/hit-wave", "params": { "hit": { "pressed": true, "pressedAt": 0, "clicks": 1 } } },
  "window": { "duration": "1s" },
  "expect": [
    { "path": "group.range.max", "lte": 0.02 },
    { "path": "fixtures.*.issues", "contains": "stuck-0" }
  ]
}
```

Released at t = 0 → wave from the corners (window 0–2 s), then the idle state:

```json
{
  "mode": "preview", "modifierId": "ai-hit", "targets": { "groupIds": ["g-tubes", "g-pars"] },
  "plugin": { "ref": "@ai/hit-wave", "params": { "hit": { "pressed": false, "pressedAt": 0, "releasedAt": 0, "clicks": 1 } } },
  "window": { "duration": "2s" }, "fps": 60,
  "points": [{ "x": 0.1, "y": 0.2 }, { "x": 0.9, "y": 0.2 }, { "x": 0.9, "y": 0.8 }, { "x": 0.1, "y": 0.8 }],
  "expect": [
    { "path": "group.temporal.kind", "ne": "constant" },
    { "path": "group.radial.r", "gt": 0.5 },
    { "path": "group.radial.kind", "eq": "outward" },
    { "path": "group.range.max", "gte": 0.8 },
    { "path": "fixtures.*.range.max", "gt": 0.5 }
  ]
}
```

(The radial feature of a non-periodic signal uses each sample's time of peak intensity: later peaks farther from the corners.) Same state with `"window": { "from": "5s", "duration": "1s" }` must show the idle behaviour the agent declared (dark: `group.range.max` `lte: 0.05`; pass-through: `group.temporal.kind` `eq: "constant"` and `group.range.min` `gte: 0.5`).

Double-click → blinder (use the variant matching the declared behaviour):

```json
{
  "mode": "preview", "modifierId": "ai-hit", "targets": { "groupIds": ["g-tubes", "g-pars"] },
  "plugin": { "ref": "@ai/hit-wave", "params": { "hit": { "pressed": true, "pressedAt": 0, "releasedAt": 0, "clicks": 2 } } },
  "window": { "duration": "0.2s" }, "fps": 60,
  "expect": [{ "path": "group.range.min", "gte": 0.9 }]
}
```

(after-release variant: `"pressed": false, "clicks": 2`, window inside the declared blinder length.)

## Manual live check (tester)

1. Start `observe { "mode": "live", "targets": { "groupIds": ["g-tubes", "g-pars"] }, "window": { "duration": "6s" }, "detail": "fixture" }` through the agent ("observe live for 6 s while I press the button") and in that time: hold the live **Hit** button ~2 s, release, wait 2 s, double-click.
2. Expect: dark while held, a visible wave from the corners after the release, a full flash on the double-click; the report's `group.temporal` is not constant.
3. Repeat with the card button.

## Pass criteria

- [ ] Builds and validates; render pure (no stored press state).
- [ ] All three preview states pass; idle behaviour as declared.
- [ ] Live: hold blacks out, release sends the wave, double-click flashes (tester).
- [ ] Live page with the big Hit button first (no `mapping-ignored-by-widget`), sliders for wave speed/decay/level.
- [ ] Modifier + page in one `apply`; **one Undo removes the whole change** (trigger presses are not undo steps).
- [ ] No `error` findings; the report says the live button press was not verified by the agent itself.
