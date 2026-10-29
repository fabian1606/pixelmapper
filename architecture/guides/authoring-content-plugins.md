# Authoring Content Plugins (Modifiers)

This guide is self-contained: it can be handed to a developer or an AI as the only context needed to write a Pixelmapper modifier plugin. Background: [ADR 0001 §6 and amendment A20](../adr/0001-extension-and-content-plugin-system.md), [engine.md](../engine.md). UI, hardware and fixture-type additions are **extensions** instead: [authoring-extensions.md](authoring-extensions.md).

**Design rules:** every modifier must follow the [modifier design principles](modifier-design-principles.md). In short:
- edit on a visual representation, not faders;
- spatial things live on the canvas;
- name controls by what is seen;
- ship recipes (complete looks);
- declare shared options (distribution, curve shapes), never re-implement them.

## What a modifier is

A modifier changes light values over time and space. The engine calls it once per frame with **all samples** it targets and expects one value tuple per sample. The plugin never sees fixtures, DMX addresses or other modifiers — only normalized numbers.

| Signature | A sample is | Output per sample |
|-----------|-------------|-------------------|
| `scalar` | one channel (dimmer, strobe, …) | 1 value |
| `rgb` | one head with a color system (RGB/RGBW/RGBA/CMY) | 3 values r, g, b |
| `panTilt` | one head with pan + tilt | 2 values pan, tilt |

The host owns everything generic: which channels/fixtures are targeted, speed, the **distribution** (how the instance spreads over fixtures: all the same, a direction on the canvas, the order numbers, or within each fixture), strength and blend mode. The plugin owns only what it computes from the **time phase**, the per-sample **distribution values** (`spatial`, `rank`, `distGroup`) and its **params**. Plugins never derive their spatial layout from `x`/`y` (position-based noise textures are the exception).

## Package layout

```
plugins/my-modifier/
  manifest.json   # metadata + param schema
  modifier.ts     # AssemblyScript source
  ui.ts           # optional custom panel (see below)
  package.json    # { "name": "@pixelmapper/plugin-my-modifier", "private": true }
  goldens.json    # optional regression cases (built-ins only)
```

In the app, **Add Modifier → New from code…** opens an editor for `manifest.json`, `modifier.ts` (and `ui.ts`) that builds, validates, previews and publishes in the browser; **Browse & import…** imports by hash, alias (`@scope/name`), link or `.pmplugin.json` file. Programmatic seam (used by the future AI loop): `buildFromCode({ manifest, source })` in `app/utils/plugins/create-plugin.ts` returns the package or staged diagnostics (`manifest` / `compile` / `validate`).

Built-ins live in `plugins/` and are built by `bun run build:plugins` (`scripts/build-plugins.ts`): compile → instrument → validate → hash → `public/plugins/<hex>.wasm|json` + `app/utils/plugins/builtin-index.ts`. User plugins are built in the browser with the same toolchain (`buildPackage` + `validate` from `@pixelmapper/plugin-toolchain`).

Identity is the content hash `sha256:<hex>` over canonical(manifest) ‖ wasm ‖ ui. Changing anything yields a new plugin; projects reference plugins by hash.

## manifest.json

```json
{
  "schema": 1,
  "kind": "modifier",
  "alias": "@me/pulse-train",
  "name": "Pulse Train",
  "version": "1.0.0",
  "apiVersion": "^1.1.0",
  "description": "Short pulses that travel across fixtures. Width sets the pulse length within a pass.",
  "purpose": "Short pulses run across your fixtures.",
  "speedUnit": "per pass",
  "signatures": ["scalar"],
  "output": "scale",
  "distribution": { "modes": ["none", "linear", "order"], "scopes": ["across", "within"], "default": { "mode": "order" } },
  "params": [
    { "key": "width", "type": "number", "min": 0.01, "max": 1, "default": 0.2, "label": "Width", "tier": "primary" },
    { "key": "soft", "type": "bool", "default": true, "label": "Soft edges", "tier": "advanced" }
  ],
  "presets": [
    { "id": "short", "label": "Short", "description": "Quick blips along the row.", "default": true,
      "params": { "width": 0.1, "soft": false }, "speed": { "mode": "beat", "beatValue": 2 },
      "distribution": { "mode": "order" }, "strength": 1, "when": { "kind": ["row", "area"] } },
    { "id": "swell", "label": "Swell", "description": "Slow, soft swells.",
      "params": { "width": 0.5, "soft": true }, "speed": { "mode": "beat", "beatValue": 8 },
      "distribution": { "mode": "linear" }, "strength": 1 }
  ]
}
```

| Field | Rule |
|-------|------|
| `schema` | `1` |
| `kind` | `"modifier"` (`shader`, `visual` are reserved) |
| `alias` | `@scope/name`, kebab-case |
| `name` | non-empty display name |
| `version` | valid semver (metadata only) |
| `apiVersion` | semver range satisfied by plugin API `1.1.0`; use `^1.1.0` when reading the v1.1 fields (`timePhase`, `spatial`, `rank`, …) |
| `description` | ≥ 10 characters; describe behavior and params — humans and AI read it |
| `signatures` | non-empty subset of `scalar`, `rgb`, `panTilt`; the instance picks one (first by default) |
| `output` | `scale`, `bipolar` or `absolute` (see below) |
| `params` | ordered param list; **order defines the wire layout** |
| `purpose` *(optional)* | one sentence shown in the Add menu |
| `speedUnit` *(optional)* | what one tempo unit means, shown next to the speed (`per pass`, `per step`) |
| `distribution` *(optional)* | offered `modes` (`none`, `linear`, `radial`, `conical`, `order`), `scopes` (`across`, `within`), `withinOffset` (false hides the Within *Offset* choice when your plugin ignores it) and a partial `default`. Offer only the spreads that make sense for your modifier |
| `presets` *(optional)* | recipes: complete looks (see below) |
| `editors` *(optional)* | composite editors bound to several params (see below) |

### Output modes

- **`scale`** *(recommended for levels)* — a level `v` in [0, 1] as a fraction of the programmed value: the host maps `base × (1 − strength + strength × v)`. `v = 1` keeps the programmed value, a floor of 0.2 means 20 % of it at any base. Use for chases, waves, flicker, patterns.
- **`bipolar`** — relative to the current value. The host maps `v = base + strength × (out − 1) / 2`: `out = 1` keeps the base value, `out = −1` lowers it by `strength`. Typical range [−1, 1]; validation accepts [−2, 2]. Use for dimmer waves, chases, flicker — "peak = base" means a red fixture pulses red↔black, never toward white.
- **`absolute`** — the output *is* the target value, in [0, 1]. The host mixes `prev → blendOp(prev, out)` by `strength`. Use for color generators, position patterns, anything that sets values independent of the base. `sample.base0..2` still tells you the current value (e.g. color-adjust rotates the base hue).

### Params

| Type | Value | Wire slots (f32) | Read with | Default input |
|------|-------|------------------|-----------|---------------|
| `number` | number in [min, max] (+ `step`, `unit`) | 1 | `p.get(i)` | fader |
| `int` | integer in [min, max] | 1 | `p.int(i)` | number input |
| `bool` | boolean | 1 (0/1) | `p.bool(i)` | toggle |
| `enum` | one of `options` (+ `optionLabels`) | 1 (index) | `p.int(i)` | select |
| `color` | `{ r, g, b }` in 0–1 | 3 | `p.get(i)`, `p.get(i+1)`, `p.get(i+2)` | color input |
| `angle` | radians | 1 | `p.get(i)` | angle dial |
| `point` | `{ x, y }` in 0–1 | 2 | `p.get(i)`, `p.get(i+1)` | XY pad |
| `curve` | `{ shape, args }`, `{ points }` or a legacy point list (see Curves) | 128 (LUT) | `sampleLut(p.lut(i), x)` / `sampleSignedLut` | `pm.curve` |
| `gradient` | `{ stops: [{ pos, color }] }`, 1–8 stops | 33 (`count, (pos, r, g, b) × 8`) | `sampleGradient(p.lut(i), u, transition, channel)` | `pm.gradient` |
| `steps` | `{ groups, steps, cells[step][group] }` (1–8 × 1–16) | 18 (`groups, steps, mask[16]`) | `p.int(i)`, `p.int(i + 1)`, mask bits at `p.lut(i + 2)` | `pm.steps` |
| `trigger` *(v1.3)* | momentary button state; manifest default `{ "pressed": false }` (+ optional `multiClickMs`, default 350) | 4 (`pressed, pressedAt, releasedAt, clicks`; engine-clock ms, −1e9 = never) | `triggerPressed(p, i)`, `triggerMsSincePress(p, i, ctx)`, `triggerMsSinceRelease(p, i, ctx)`, `triggerClicks(p, i)` | press-and-hold `pm.button` |

**Trigger params (v1.3).** For momentary input such as "hold = blackout, release = shock wave, double-click = flash". The host records the press/release edges (card button, or a live `button` widget mapped to the param with `effect-param`) as engine-clock timestamps; nothing is saved to undo history. `render` stays pure: the SDK readers subtract the stamps from `ctx.timeMs`. `triggerClicks` counts presses in the current burst (a press within `multiClickMs` of the previous release continues it), so `clicks >= 2` while pressed or shortly after means double click. Combine with `envelope(ms, attackMs, decayMs)`:

```ts
// params: [0] trigger "hit" (4 slots), [4] number "decayMs"
const held = triggerPressed(this.params, 0);
if (held && triggerClicks(this.params, 0) >= 2) out.setScalar(1.0);            // double click: blinder
else if (held) out.setScalar(0.0);                                               // hold: blackout
else out.setScalar(envelope(triggerMsSinceRelease(this.params, 0, ctx) - dist2(s.u, s.v, 0, 0, ctx.worldAspect) * 400.0, 0.0, this.params.get(4))); // release: wave from a corner
```

Common fields:
- `key` (camelCase, unique), `label`, `default`;
- optional `description` (tooltip), `group` (section title), `ui` (override the input, e.g. `"pm.numberInput"`, or the object form `{ "input"?, "canvas", … }` with a canvas handle, see Canvas handles);
- `tier`: `primary` (card body, default), `advanced` (under "More"), `hidden` (never rendered; recipes and editors set it);
- `optionDistribution` (enum only): option → distribution patch applied when the user picks that option, e.g. `{ "alternate": { "mode": "order" } }` when the option only works fixture by fixture;
- `when`: show only when the condition holds, e.g. `{ "mode": "palette" }` or `{ "distribution.mode": ["order", "linear"] }`.

`i` is the **slot index**: the sum of the slot counts of all preceding params, not the param index.

An `enum` with at most three options and no `ui` renders as a segmented control. The first `enum` param names instances when the plugin has no recipes ("Pulse Train · Soft"); with recipes the card title is "<name> · <recipe | Custom>".

### Curves

A `curve` param declares how it is edited and sampled:

| Field | Meaning |
|-------|---------|
| `domain` | `cycle` (x ∈ [0, 1], LUT index `i/127`) or `signed` (x ∈ [−1, 1], `−1 + 2i/127`, periodic profiles) |
| `shapes` | offered programmatic shapes, in UI order; omitted = free points only |
| `allowFree` | allow "Free" point editing (default true) |
| `axis` | ticks/snapping in the editor: `fixtures` (one per numbered fixture), `beats` (8 per beat), `none` |
| `range` | `unipolar` or `bipolar` display (the value stays 0–1) |

Values:
- `{ "shape": "dot", "args": { "width": 0.15 } }` — a registered generator; every arg is a handle in the editor (missing args use their defaults);
- `{ "points": [{ "x", "y", "kind"?, "in"?, "out"? }] }` — free points normalized over the domain; `kind` ∈ `smooth`, `corner`, `linear`, `step` (segment to the right);
- a legacy list `[{ x, y }]` — a Catmull-Rom spline.

Built-in shapes (all have `peak` and `floor`):

| Domain | Shapes |
|--------|--------|
| profile (`signed`) | `dot` (width, softness, repeat), `bar` (width, softness, repeat), `wave` (repeat), `wedge` (length, repeat; comet behind the head), `edge` (softness; fill), `flash` (attack, decay, repeat) |
| motion (`cycle`) | `run`, `pingpong`, `step` (count, 0 = one per fixture), `hold` (pause), `ease` (in, out) |

Extensions add shapes through `contributes.curveShapes` (ids `<extension>/<name>`); manifests may list them (validation warns that they are not built in).

### Recipes (`presets`)

Each recipe is a **complete look**:
- `params` (missing params use their defaults), `speed`, `distribution` (partial), `strength`;
- at most one `default: true`;
- optional `when: { kind?: ["single" | "row" | "ring" | "area"], multiHead?, hasColor? }` picks the recipe for a new instance on the current selection.

Every card shows a Preset row (`Preset ▾ Name`); a plugin without presets gets one *Default* recipe (the schema defaults). Hovering a recipe in the list previews it on the fixtures without saving; clicking applies everything as one undo step. When the recipe changes the distribution mode, the distribution is placed on the selection (handle along its axis, radial from its centroid, order along the axis). Recipes never set a direction: the user turns the handle on the canvas, so do not ship variants that only differ in direction.

### Canvas handles (`ui.canvas`)

Spatial params can declare a draggable handle on the 2D canvas, so an effect gets spatial controls without UI code ("a wave from four draggable corner points", "adjust how big the areas are"). The hint sits in the param's `ui` in object form; `ui.input` still overrides the card input, and the card input (e.g. the X/Y faders of a `point`) stays available:

```json
{ "key": "center", "type": "point", "label": "Center", "default": { "x": 0.5, "y": 0.5 },
  "ui": { "canvas": "point", "label": "C", "color": "#ff8800" } },
{ "key": "size", "type": "number", "label": "Size", "min": 0.02, "max": 1, "default": 0.2,
  "ui": { "canvas": "radius", "anchor": "center" } }
```

| `canvas` | Param type | Handle | Value |
|----------|-----------|--------|-------|
| `point` | `point` | one dot at the value | `{ x, y }` in normalized world space (x over the world width, y over the height), clamped to 0–1 |
| `radius` | `number` | a ring around the `anchor` point (+ a knob) | radius in **normalized world-x units** (1 = world width), clamped to the param's `[min, max]` |

- Optional `label` (≤ 24 characters, default: the param label) and `color` (CSS color, default: the theme primary).
- `anchor` must name a `point` param; give that param `canvas: "point"` too, or the ring's center cannot be dragged (validation warns).
- A radius needs `min ≥ 0`.
- The ring is drawn as a true circle. To match it, measure distance as `hypot(dx, dy / worldAspect)` with `worldAspect = worldWidth / worldHeight` (x and y are normalized separately). Until the frame carries `worldAspect` (ABI 1.3), a plugin cannot know the aspect and the ring is exact only in square worlds.
- Handles show for the selected modifier whenever it has hinted params that the card would show (`tier` not `hidden`, `when` holds), in every distribution mode, next to the distribution handle.
- Dragging updates the param live (and for collaborators); releasing commits one undo step. Points snap to the world edges, the center and the other points (hold Alt to drag freely).
- There is no `line` hint; draw relations between points in the effect itself.

### Composite editors (`editors`)

`{ "id": "hue", "input": "pm.hueRange", "bind": { "shift": "hueShift", "range": "hueRange" }, "when": { "mode": "shift" } }` renders one input for several params (usually `tier: "hidden"`; a bound param with an explicit `tier: "primary"`/`"advanced"` also gets its own field). The input receives `modelValue` = `{ prop: value }` built from `bind` and emits the same shape; only bound keys are written. Core inputs: `pm.hueRange`, `pm.noiseHistory`, plus every single-param input.

## modifier.ts

```ts
import { Modifier, Frame, Sample, Out, Params, register, fract, clamp } from "@pixelmapper/plugin-sdk";

class PulseTrain extends Modifier {
  width: f32 = 0.2;
  soft: bool = true;

  /** Called when params change (not per frame). Read slots in manifest order. */
  prepare(p: Params): void {
    this.width = p.get(0);
    this.soft = p.bool(1);
  }

  /** Called per sample per frame. Must be pure: same inputs → same output. */
  render(ctx: Frame, s: Sample, out: Out): void {
    // Position along the distribution relative to the moving pulse.
    const t = fract(s.spatial - fract(ctx.timePhase));
    let v: f32 = t < this.width ? 1.0 : 0.0;
    if (this.soft && t < this.width) v = Mathf.sin((t / this.width) * Mathf.PI);
    out.setScalar(clamp(v, 0.0, 1.0));
  }
}

register(new PulseTrain());
```

Rules:

- **AssemblyScript, not TypeScript.** Use `f32`/`i32`/`u32`/`bool`; float literals need a decimal point in f32 context (`1.0`); use `Mathf` (f32) rather than `Math` (f64). Avoid closures, `any`, union types, `Map`/`Set` in the hot path.
- Exactly one top-level `register(new X())`.
- `render` must not keep state across frames: validation renders frame 120 after frames 0–119 and fresh, and rejects any difference. Derive everything from `ctx`, `s` and params. Use seeds for randomness.
- Allocate in `prepare` or as module globals (e.g. `const TMP = new Vec3()`), never per sample.
- Write exactly `arity` values: `out.setScalar(v)`, `out.setRgb(r, g, b)`, or `out.set(i, v)`.

### Inputs

`Frame` (per call):
- `timeMs` (shared clock, identical on all clients), `beatTime` (beats since epoch, continuous across tempo changes), `bpm`;
- `phaseSpeed` (cycles/s; 0 when frozen), `arity`, `seed` (instance), `strength` (informational — the host applies it);
- v1.1: `timePhase` (speed phase in cycles, unwrapped: one pass/step per unit), `rankCount` (numbered fixtures of the instance, the largest head count for scope within, 0 without ranks), `distGroupCount` (groups set by a recipe, 0 = none).
- v1.3: `worldAspect` (room width / room depth), `worldDepth` (room depth in world units), `metersPerUnit` (meters per world unit, 0 = unknown). See *Coordinates* below.
- v1.2: `spread` — the user's Spread choice: `SPREAD_SAME` (every fixture the same, `spatial` 0), `SPREAD_SPATIAL` (Spatial 2D handle), `SPREAD_ORDER` (Fixture by fixture: `rank` = number − 1, all heads of a fixture share it), `SPREAD_WITHIN` (Within each fixture: `rank` = head). Use it to decide who shares a random value (Noise) or how groups form (Pattern: alternate along numbers, bands along the handle). Also v1.2: `handleOriginX/Y`, `handleEndX/Y` — the Spatial 2D handle in the same normalized coordinates as `Sample.x/y` (e.g. scale or move a texture with it, as Noise does). Declare `"apiVersion": "^1.2.0"` when you read them.

`Sample` (per target):

| Field | Meaning |
|-------|---------|
| `x`, `y` | normalized world position 0–1 (fraction of the stage; one unit on both axes) |
| `z` *(v1.3)* | height above the floor, same unit as `x`/`y` (0 on the floor / when unset) |
| `u`, `v` *(v1.3)* | room coordinates: 0–1 across the bounding box of all fixtures (each axis separately; 0.5 on a degenerate axis) |
| `spatial` *(v1.1)* | position along the distribution: 0 at the handle origin / first number, 1 at the end / after the last number; `head/headCount` within each fixture |
| `rank` *(v1.1)* | the sample's order number (0-based; head index for scope within), −1 without ranks |
| `distGroup` *(v1.1)* | group set by a recipe's grouping, −1 without |
| `phase` | legacy (v1.0): `timePhase − spatial` in cycles |
| `groupIndex`, `groupCount` | rank of the fixture among targeted fixtures, their count |
| `headIndex`, `headCount` | head within the fixture (pixel bars, strips) |
| `seed` | stable 24-bit seed of (fixture, head, instance) |
| `base0..2` | current values before this modifier, 0–1 (scalar: base0; rgb: r, g, b; panTilt: pan, tilt) |
| `channelSeed` | 32-bit seed of the channel type (scalar), so e.g. RED and BLUE flicker differently |

### Coordinates (v1.3)

- **World** (`x`, `y`, `z`): one unit on every axis, so `dist3(s.x, s.y, s.z, px, py, pz, 1, 1)` is a true distance; × `metersPerUnit` gives meters. `point` params and the Spatial 2D handle use world x/y.
- **Room** (`u`, `v`): the rig's bounding box stretched to 0–1 on each axis. Use it for "corners", "center", "edges of the room" independent of where the rig sits on the stage. Because the axes are stretched separately, scale u differences by `ctx.worldAspect`: `dist2(s.u, s.v, cu, cv, ctx.worldAspect)` is isotropic, in units of the room depth. Heights join that space as `s.z / ctx.worldDepth`, e.g. `dist3(s.u, s.v, s.z / ctx.worldDepth, cu, cv, 0, ctx.worldAspect, 1)`.
- The room is computed by the host from the whole layout (not only the targeted fixtures), so all modifiers share it. Declare `"apiVersion": "^1.3.0"` when you read v1.3 fields.

### SDK helpers (`@pixelmapper/plugin-sdk`)

- math: `TAU`, `PI`, `fract`, `clamp`, `lerp`, `seededRandom(seed)`, `hash01(seed, i)`, `fnv1aPos(x, y)`, `crossfade(prev, curr, elapsedMs, durMs, fade)`, `perlin2`, `noise1/2/3`
- waves: `evaluateShape(shape, t, param)` with `WAVE_SINE`, `WAVE_SQUARE`, `WAVE_TRIANGLE`, `WAVE_SAWTOOTH`, `WAVE_BOUNCE`, `WAVE_RAMP`, `WAVE_SMOOTH` (returns −1…1)
- color: `Vec3`, `rgbToHsl`, `hslToRgb`, `rgbToHsv`, `hsvToRgb` (write into an `out` Vec3)
- curves: `sampleLut(ptr, x)` (cycle domain), `sampleSignedLut(ptr, x)` (signed domain, wraps), `wrapSigned(x)`, `CURVE_LUT_SIZE` (128)
- patterns (v1.3): `dist2(x, y, px, py, aspect)`, `dist3(x, y, z, px, py, pz, aspect, zScale)`, `minDistToPoints(x, y, aspect, pts, count)` / `nearestPointIndex(...)` (`pts`: a `StaticArray<f32>` of up to 8 interleaved x/y pairs — allocate it once in `prepare`, never per sample), `pingPong(t)`, `mirror(x, axis)`, `pulse(d, center, width, softness)`, `ease(kind, t)` with `EASE_LINEAR`, `EASE_IN_QUAD`, `EASE_OUT_QUAD`, `EASE_IN_OUT_QUAD`, `EASE_IN_EXPO`, `EASE_OUT_EXPO`, `EASE_IN_OUT_SINE`, `EASE_SMOOTH`, `crossingTimeLine(a0, va, b0, vb)`, `crossingTimeLoop(a0, va, b0, vb, t)` (time since the last meeting of two runners on a loop of length 1), `crossingCount(a0, va, b0, vb, t)` (meetings so far; `& 1` alternates colors per collision), `envelope(msSince, attackMs, decayMs)`
- triggers (v1.3): `triggerPressed`, `triggerMsSincePress`, `triggerMsSinceRelease`, `triggerClicks`, `TRIGGER_SLOTS` (4), `TRIGGER_NEVER` (1e9 ms)
- gradients: `gradientCount(g)`, `gradientPos(g, i)`, `gradientStopChannel(g, i, c)`, `sampleGradient(g, u, transition, c)` with `g = p.lut(slot)` (periodic palette; transition 0 = each stop holds until the next, 1 = blend)

Randomness that changes once per step: `hash01(s.seed, <u32>Mathf.floor(ctx.timePhase))`.

A typical v1.1 render: `m = sampleLut(motionLut, fract(ctx.timePhase)); v = sampleSignedLut(profileLut, s.spatial - m)` — the profile moves along the distribution following the motion curve (see `plugins/waveform`).

## Custom panel (`ui.ts`, optional)

Most plugins need no custom UI: the host renders params with the standard inputs. For richer editing (a pattern grid, a waveform you draw), declare a panel:

```json
"ui": { "panel": "ui.ts", "placement": "below-params" }
```

`placement`: `below-params` (default), `above-params`, or `replace-params` (the generated param form is hidden).

`ui.ts` is plain TypeScript, transpiled (not bundled): **no imports**, no `require`, no dynamic `import()`. It exports one function:

```ts
export function mount(el: HTMLElement, api: PanelApi): (() => void) | void {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0'; input.max = '1'; input.step = '0.01';
  input.value = String(api.params.width ?? 0.2);
  input.style.accentColor = 'var(--primary)';
  input.onpointerdown = () => api.beginScrub();
  input.onpointerup = () => api.endScrub();
  input.oninput = () => api.setParam('width', Number(input.value));
  api.onParams(p => { input.value = String(p.width); });
  el.append(input);
  return () => input.remove();
}
```

`PanelApi`:

| Member | Meaning |
|--------|---------|
| `params` | current param values (read-only snapshot) |
| `onParams(cb)` | called when params change elsewhere (other inputs, undo, collaborators) |
| `setParam(key, value)` | change one param; validated against the manifest schema (numbers are clamped, unknown keys and invalid values are dropped) |
| `beginScrub()` / `endScrub()` | wrap continuous edits so they become **one** undo step; a `setParam` outside a scrub commits immediately |
| `onFrame(cb)` | ~30 fps `{ timeMs, beatTime, bpm }` for animations (only sent while subscribed) |
| `render(samples, count)` | runs **this plugin's own** wasm synchronously with the current params: `samples` = `count × 20` f32 in the `Sample` layout (ABI 1.3), returns `count × arity` raw outputs (frame context is zero except `arity = 1`) |
| `theme` | resolved CSS variables as full color values (`--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--radius`, …); they are also set on `:root` inside the panel, so `var(--primary)` works in styles |

Sandbox: the panel runs in `<iframe sandbox="allow-scripts">` with an opaque origin and a CSP without network access (`default-src 'none'`; inline scripts, styles, `data:` images and wasm only). It cannot reach the app, cookies, storage or the network; everything goes through `PanelApi` messages. The iframe resizes to its content height (24–600 px). Uncaught errors are shown under the panel.

## Validation (what makes a build fail)

The harness renders 240 frames (4 s @ 60 fps) on a synthetic layout of 64 fixtures × 1–8 heads, for several param variants and every declared signature. Rejected:

1. Invalid manifest (rules above).
2. Compile errors; forbidden imports (only `env.memory`, `env.abort`, `pm.budget`, `pm.log` allowed).
3. Traps, `abort`, or **budget overrun** — every loop iteration and call costs budget (≈ 50 000 per call + 2 000 per sample). Infinite or very long loops trap instead of hanging.
4. NaN or ±∞ outputs.
5. Outputs out of range: `absolute` and `scale` [0, 1], `bipolar` [−2, 2].
6. State across frames (see above).
7. Slower than 2 ms median per frame scaled to 512 samples.

Warnings: constant output for all frames/params/samples; params blocks > 4096 slots.

At runtime, a plugin that traps is disabled for that instance only (toast in the UI); if the whole engine stalls for 1 s the worker is restarted and non-built-in plugins are suspended until resumed.

## Examples

Built-ins to read:
- `plugins/waveform` (**Wave**: profile + motion curves, scale output, recipes);
- `plugins/noise` (**Noise**: seeds, explicit events, composite editors, pick mode over ranks);
- `plugins/sequencer` (**Pattern**: steps param, groups from the order numbers);
- `plugins/color-adjust` (**Color Shift**: absolute rgb, gradient param, hue-strip editor, uses `base0..2`).

Each has a `goldens.gen.ts` reference and `goldens.json`.

### Checklist

- [ ] `description` explains behavior and every non-obvious param; labels name what the user sees.
- [ ] Recipes cover the common looks; one is `default`; each sets params, speed, distribution and strength.
- [ ] Spatial behavior comes from `spatial`/`rank` (the shared distribution), not from `x`/`y` or own origin params.
- [ ] Param slot indices in `prepare` match manifest order and slot counts.
- [ ] Output range fits the output mode; no NaN (guard divisions).
- [ ] No per-frame state, no per-sample allocation.
- [ ] Works for every declared signature (`ctx.arity`).
