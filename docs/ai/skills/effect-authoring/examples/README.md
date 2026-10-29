# Reference effects

Two complete effects, built, validated and golden-tested as built-in plugins. The files here are symlinks to `plugins/<name>/`, so they never drift. Without repo access, fetch the same files with `plugins.get`:

```json
inspect { "selector": { "op": "plugins.get", "input": { "plugin": "@pixelmapper/corner-wave" } } }
```

## Corner Wave — `@pixelmapper/corner-wave`

[manifest.json](corner-wave/manifest.json) · [modifier.ts](corner-wave/modifier.ts)

Acceptance effect 0: wave fronts from up to four draggable points.

- Four `point` params A–D with `ui.canvas: "point"` (`tier: "advanced"`: the canvas is their primary control), shown according to `Points` (`when`).
- `Reach` is a `number` with `ui.canvas: "radius"` anchored to A.
- Distance to the nearest point in world space: `minDistToPoints(s.x, s.y, 1.0, pts, sources)`; the points are copied into a `StaticArray` in `prepare`.
- One soft band per front: `pulse(fract(d / spacing − timePhase), 0.5, width, softness)`; Inward flips the sign.
- Every front keeps its palette color: `u = fract(floor(pos) × 0.25)` into `sampleGradient`.
- `absolute` rgb (dark between fronts), `distribution.modes: ["none"]` (own geometry), recipes *Corners*, *Implode*, *Ripple*.
- On add, set A–D to the targets' room corners: `"params": { "a": { "x": minX, "y": minY }, … }`.

## Mirror Runner — `@pixelmapper/mirror-runner`

[manifest.json](mirror-runner/manifest.json) · [modifier.ts](mirror-runner/modifier.ts)

Acceptance effect 1: mirrored ping-pong runner on LED tubes.

- Position along the tube from the head index, flipped on the far half of the room by room coordinates (`s.u > 0.5` / `s.v > 0.5`) and by `Reverse`.
- The tail is a time delay since the runner passed the pixel, so it folds back at the bounce; closed-form, no state.
- `scale` output (keeps the tubes' programmed color), three params (*Tail*, *Mirror*, *Reverse*), recipes *Runner*, *Comet*, *Spark*; speed is the host's ("per round trip").

Goldens: `plugins/<name>/goldens.gen.ts` computes the expected output with a TypeScript reference of the same math; `plugins/goldens.test.ts` builds, validates and compares.
