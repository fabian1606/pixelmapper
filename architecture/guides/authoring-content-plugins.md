# Authoring Content Plugins (Modifiers)

This guide is self-contained: it can be handed to a developer or an AI as the only context needed to write a Pixelmapper modifier plugin. Background: [ADR 0001 §6](../adr/0001-extension-and-content-plugin-system.md), [engine.md](../engine.md). UI, hardware and fixture-type additions are **extensions** instead: [authoring-extensions.md](authoring-extensions.md).

## What a modifier is

A modifier changes light values over time and space. The engine calls it once per frame with **all samples** it targets and expects one value tuple per sample. The plugin never sees fixtures, DMX addresses or other modifiers — only normalized numbers.

| Signature | A sample is | Output per sample |
|-----------|-------------|-------------------|
| `scalar` | one channel (dimmer, strobe, …) | 1 value |
| `rgb` | one head with a color system (RGB/RGBW/RGBA/CMY) | 3 values r, g, b |
| `panTilt` | one head with pan + tilt | 2 values pan, tilt |

The host owns everything generic: which channels/fixtures are targeted, speed, spatial distribution (direction, origin, angle, fanning, reverse), strength and blend mode. The plugin owns only what it computes from the **phase** and its **params**.

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
  "apiVersion": "^1.0.0",
  "description": "Short pulses that travel across fixtures. Width sets the pulse length within a cycle.",
  "signatures": ["scalar"],
  "output": "bipolar",
  "params": [
    { "key": "width", "type": "number", "min": 0.01, "max": 1, "default": 0.2, "label": "Width" },
    { "key": "soft", "type": "bool", "default": true, "label": "Soft edges" }
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
| `apiVersion` | semver range satisfied by plugin API `1.x` |
| `description` | ≥ 10 characters; describe behavior and params — humans and AI read it |
| `signatures` | non-empty subset of `scalar`, `rgb`, `panTilt`; the instance picks one (first by default) |
| `output` | `bipolar` or `absolute` (see below) |
| `params` | ordered param list; **order defines the wire layout** |

### Output modes

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
| `curve` | ≥ 2 points `{ x, y }` in 0–1, x increasing | 128 (LUT) | `sampleLut(p.lut(i), x)` | curve editor |

Common fields: `key` (camelCase, unique), `label`, `default`, optional `description` (tooltip), `group` (section title), `ui` (override the input, e.g. `"pm.numberInput"`). `i` is the **slot index**: the sum of the slot counts of all preceding params, not the param index.

The first `enum` param also names instances in lists ("Pulse Train · Soft").

Tip: a `point` param with key `origin` (plus `angle`/`scale` params) makes the canvas spatial handles edit those params instead of the host's origin/fanning — the sequencer uses this.

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
    const t = fract(s.phase);
    let v: f32 = t < this.width ? 1.0 : -1.0;
    if (this.soft && t < this.width) {
      v = Mathf.sin((t / this.width) * Mathf.PI) * 2.0 - 1.0;
    }
    out.setScalar(clamp(v, -1.0, 1.0));
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

`Frame` (per call): `timeMs` (shared clock, identical on all clients), `beatTime` (beats since epoch, continuous across tempo changes), `bpm`, `phaseSpeed` (cycles/s; 0 when frozen), `arity`, `seed` (instance), `strength` (informational — the host applies it).

`Sample` (per target):

| Field | Meaning |
|-------|---------|
| `x`, `y` | normalized world position 0–1 |
| `phase` | cycles (1.0 = one cycle) = speed phase − spatial offset; use `fract(s.phase)` for the position in the cycle |
| `groupIndex`, `groupCount` | rank of the fixture among targeted fixtures, their count |
| `headIndex`, `headCount` | head within the fixture (pixel bars, strips) |
| `seed` | stable 24-bit seed of (fixture, head, instance) |
| `base0..2` | current values before this modifier, 0–1 (scalar: base0; rgb: r, g, b; panTilt: pan, tilt) |
| `channelSeed` | 32-bit seed of the channel type (scalar), so e.g. RED and BLUE flicker differently |

### SDK helpers (`@pixelmapper/plugin-sdk`)

- math: `TAU`, `PI`, `fract`, `clamp`, `lerp`, `seededRandom(seed)`, `hash01(seed, i)`, `fnv1aPos(x, y)`, `crossfade(prev, curr, elapsedMs, durMs, fade)`, `perlin2`, `noise1/2/3`
- waves: `evaluateShape(shape, t, param)` with `WAVE_SINE`, `WAVE_SQUARE`, `WAVE_TRIANGLE`, `WAVE_SAWTOOTH`, `WAVE_BOUNCE`, `WAVE_RAMP`, `WAVE_SMOOTH` (returns −1…1)
- color: `Vec3`, `rgbToHsl`, `hslToRgb`, `rgbToHsv`, `hsvToRgb` (write into an `out` Vec3)
- curves: `sampleLut(ptr, x)`, `CURVE_LUT_SIZE` (128)

Randomness that changes once per cycle: `hash01(s.seed, <u32>Mathf.floor(s.phase))`.

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
| `render(samples, count)` | runs **this plugin's own** wasm synchronously with the current params: `samples` = `count × 16` f32 in the `Sample` layout, returns `count × arity` raw outputs (frame context is zero except `arity = 1`) |
| `theme` | resolved CSS variables as full color values (`--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--radius`, …); they are also set on `:root` inside the panel, so `var(--primary)` works in styles |

Sandbox: the panel runs in `<iframe sandbox="allow-scripts">` with an opaque origin and a CSP without network access (`default-src 'none'`; inline scripts, styles, `data:` images and wasm only). It cannot reach the app, cookies, storage or the network; everything goes through `PanelApi` messages. The iframe resizes to its content height (24–600 px). Uncaught errors are shown under the panel.

## Validation (what makes a build fail)

The harness renders 240 frames (4 s @ 60 fps) on a synthetic layout of 64 fixtures × 1–8 heads, for several param variants and every declared signature. Rejected:

1. Invalid manifest (rules above).
2. Compile errors; forbidden imports (only `env.memory`, `env.abort`, `pm.budget`, `pm.log` allowed).
3. Traps, `abort`, or **budget overrun** — every loop iteration and call costs budget (≈ 50 000 per call + 2 000 per sample). Infinite or very long loops trap instead of hanging.
4. NaN or ±∞ outputs.
5. Outputs out of range: `absolute` [0, 1], `bipolar` [−2, 2].
6. State across frames (see above).
7. Slower than 2 ms median per frame scaled to 512 samples.

Warnings: constant output for all frames/params/samples; params blocks > 4096 slots.

At runtime, a plugin that traps is disabled for that instance only (toast in the UI); if the whole engine stalls for 1 s the worker is restarted and non-built-in plugins are suspended until resumed.

## Examples

Built-ins to read: `plugins/waveform` (bipolar scalar, windowed shapes), `plugins/noise` (seeds, per-cycle randomness, crossfades), `plugins/sequencer` (spatial patterns from `x`/`y`, `origin`/`angle` params), `plugins/color-adjust` (absolute rgb, uses `base0..2`).

### Checklist

- [ ] `description` explains behavior and every non-obvious param.
- [ ] Param slot indices in `prepare` match manifest order and slot counts.
- [ ] Output range fits the output mode; no NaN (guard divisions).
- [ ] No per-frame state, no per-sample allocation.
- [ ] Works for every declared signature (`ctx.arity`).
