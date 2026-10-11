# Modifier UX — Implementation Plan

| | |
|---|---|
| **Status** | Implemented (M0–M12, with owner revisions R1 and R2) |
| **Date** | 2026-10-10 |
| **Builds on** | [ADR 0001](adr/0001-extension-and-content-plugin-system.md) (content plugins, ABI v1, `pm.*` inputs) |
| **Design rules for new modifiers** | [Modifier design principles](guides/modifier-design-principles.md) |
| **Out of scope** | Speed Curve and Displacement modifiers (separate follow-up), 3D-viewport gradient overlay (follow-up, see M7.6) |

This plan turns the four built-in modifiers (Wave, Noise, Pattern, Color Shift) from generic fader forms into purpose-built editors. It also adds the shared infrastructure every modifier uses: a curve component with programmatic shapes and handles, a shared **Distribution** section with canvas tools, recipes, composite editors and an endless-strip preview.

Work phase by phase. Every task has an ID (`M<phase>.<n>`), the files it touches, steps and acceptance criteria. Tick the checkbox and commit per task (`feat(modifiers): M3.2 …`). Run the gate after each phase:
- `bun run typecheck`
- `bun run test`
- `bun run lint`
- `bun run check:extensions`
- `cargo test` in `rs-engine/`
- `bun run build`
- `bun run check:zero-extensions`

---

## Revision R1 (owner review, 2026-10-10) — binding, overrides the tasks below

After trying M4 in the app, the owner simplified the Distribution UI:

1. **One dropdown "Spread"** instead of Scope + Mode: `All the same` · `Spatial 2D` · `Fixture by fixture` · `Within each fixture`.
   - *Spatial 2D* starts with a direction: mode *Linear*, handle placed along the selection and visible on the canvas. Its mode row is `Linear · Radial · Conical`.
   - *Fixture by fixture* = mode `order`: number 1 is the start, the highest number the end.
   - The canvas handle shows **only** for Spatial 2D (also for plugins with an own `origin` point param).
2. **Order = one `Reassign` button** (no tool row).
   - Pressing it hides the numbers and shows a hint on the canvas: "Click fixtures in order · Shift-click = same step · or draw a line".
   - Clicks number the fixtures 1, 2, 3 …; a drawn line orders by projection and ends the session.
3. **Symmetry is detected automatically.**
   - Fixtures roughly symmetric about the drawn line share a number (robust spacing estimate, fixed tolerance).
   - A line that starts inside the rig orders outward on both sides (`order.mirror`, set automatically).
4. **Removed from the UI:**
   - Grouping, Snap (fixed tolerance 0.5 internally), Mirror, Reverse, Clear.
   - Gradient modes reverse by dragging the handle the other way.
   - `reverse`, `order.snap`, `order.mirror` and `grouping` stay in the data model (recipes, migration).
5. **Groups are always derived from the order numbers.**
   - The choice *Alternate (1-2-1-2)* / *Blocks (1-1-2-2)* lives only where it is visible: Pattern (grid rows) and the Color Shift palette (`Spread: Gradient / Alternate`).
   - Random grouping is dropped (Noise *Random Pick* covers it), and so is the Wave recipe *Every Other* (duplicate of Pattern *Odd/Even*).
6. **Any interaction inside a card makes that modifier active**, so its canvas handle and tools appear.
7. **Distribution is generic, never per modifier.**
   - A modifier only declares which spread options it offers (`distribution.modes/scopes`).
   - The host computes `spatial`, `rank` and the head index for every sample.
   - Built-in plugins MUST NOT derive their spatial layout from `s.x/s.y` or own origin/angle params; position-based noise textures are the only exception (Noise *Coherence*).
   - Fixture by fixture and Within each fixture never depend on the handle (core test `order_and_within_ignore_the_handle`).
   - The old Sequencer/Noise violate this until M8/M9 replace them.

## Revision R2 (owner review, 2026-10-11) — binding, overrides R1 and the tasks below

After trying the built-ins, the owner curated every modifier (one review per modifier) and changed the card frame:

1. **Card order (every modifier):** live strip (very top) · Preset row · editors and params, then **Strength** with them · More · Distribution · Channels · Speed (very bottom).
2. **Presets are a general component.** Every card has the Preset row; a plugin without presets gets one *Default* recipe (the schema defaults, `cardPresets`).
   - Presentation follows effect-preset menus (Resolume, Ableton, Figma): one row `Preset ▾ Name`, a *modified* dot after an edit with ↺ back to the recipe.
   - The list shows each recipe with a thin animated strip and a `2D` badge when it spreads on the stage.
   - Hover / arrow keys preview the recipe in the live strip and on the fixtures (engine-only override, not saved, not synced, no history); click / Enter applies it as one step, Esc restores.
3. **Presets never set a direction.** A recipe that uses Spatial 2D lays the handle along the selection; top→bottom or diagonal is a drag of the handle on the canvas. The radial radius is the handle length (no automatic change).
4. **Not every distribution option shows for every modifier.** Manifests declare `distribution.modes/scopes` and the new `withinOffset: false` (hides the Within *Offset* choice when the plugin ignores it).
5. **ABI v1.2:** Frame slot `[11] spread` (0 all the same, 1 spatial 2D, 2 fixture by fixture, 3 within each fixture), so plugins can decide *who shares a value* and *how rows form* without guessing from `rank`.
6. **Enum options can need a distribution:** `optionDistribution` (option → distribution patch) is applied when the option is picked (Color Shift *Alternate* → Fixture by fixture).
7. **Per modifier:**
   - **Wave:** presets Chase · Sweep (2D) · Ping-Pong (2D) · Center Out · Build (2D) · Ripple (2D radial) · Orbit (2D conical, replaces the broken Ring) · Flash Chain · Breathe · Bar Chase. Chain removed (Chase + Repeat). Invert hidden. All four spreads offered.
   - **Pattern:** the *Groups* param is removed — the spread decides the rows: Fixture by fixture alternates (1-2-1-2), Spatial 2D cuts bands along the handle (1-1-2-2), Within each fixture cuts bands of heads. Presets Odd/Even · Chase 3 · Sweep (2D) · Halves (2D) · Build-Up (2D) · Center-Out (2D radial) · Segments. Within *Offset* hidden.
   - **Noise (3.1):** *Pick* mode, *Fixtures on* and the extra events/peaks are removed. **Frequency** says how often it is bright: every random value u is bent to u^k with k = ln ½ / ln(1 − f), so exactly the share f lies above half (low = mostly dark with an occasional flash, high = mostly bright with dips, 0.5 = unchanged; owner feedback after testing 3.0's peaks). **Variation** (3.3) pushes the bent value away from the middle, c = ½ + (b − ½) / variation: 0 = on/off (above half → highest level, below → lowest; owner decision), 1 = soft levels (default, the former look). Both act on each random step, so Hardness still fades between them. The spread decides who shares a random value: All the same = the whole rig, Fixture by fixture = every fixture (all its pixels), Spatial 2D / Within = every pixel. Coherence forms Perlin patches, even in every direction (3.3.1: time is the texture's only third axis — tying it to `spatial` drew bands across the handle; patch size 1/8 … 1/2.5 of the stage); the graph shows four neighbours that follow each other as coherence rises (drag up/down on them). Presets Candle · Twinkle · Random Pick · Fire · Water · Faulty · Lightning (new) · Color Jitter.
   - **Color Shift:** Rainbow rebuilt as a palette (works on white fixtures); new Ripple (2D radial) and Color Wheel (2D conical); Palette Run is the default without color; Two Colors removed; White Accent only with color; Saturation under More, White dip primary; *Alternate* switches to Fixture by fixture.
8. **Earlier deviations kept** (owner approved, 2026-10-11): Flash Chain and White Accent use motion Run (Flash Chain 4 beats), the white dip blends toward white, Checker stays removed, Color Shift's option is named *Arrange*; Chain and Noise *Pick count* are gone with this revision.
9. **Migration:** Pattern 2 → 3 drops *Groups* (Blocks over the order become bands along the order line; mirrored → radial). Noise 2 → 3 maps Pick to hard levels on the beat with Frequency = count / fixtures (0 = a third), drops events, and moves Level instances that used *All the same* to *Fixture by fixture* (they were per fixture before). Redirects to a built-in drop params it no longer has (Noise 3.0 → 3.1). Sequencer 1.x *sections* become 8 alternating bands; *scatter* becomes Noise peaks with the density as the share.

## 0. Background

### 0.1 Why

When the plugin system replaced the hand-built editors from `master`, the editing quality dropped. The deleted editors were:
- `WaveformEditor.vue` (shape with 5 handles + beat snapping)
- `SpeedCurveEditor.vue`
- `NoiseEditor.vue` / `SequencerEditor.vue` (pattern tiles)
- `ColorEditor.vue` (hue strip)

Today every card renders as one generic form, top to bottom:
- plugin dropdown
- 36 px preview line
- channel chips
- a list of faders (`ParamForm`)
- strength / speed / fanning

Users build effects from abstract numbers instead of manipulating what they see. Some defaults produce nothing visible (Color Adjust: `hueRange 0`) or something arbitrary (fanning fixed at 0.1).

### 0.2 Design rules (binding for everything below)

1. **The canvas is the stage preview.**
   - Spatial distribution is set on the canvas, like the gradient tool in Photoshop/Figma: drag origin → end.
   - Everything spatial lives on the canvas: palette stops on the gradient line, group colors, order numbers.
   - Cards contain no mini stage.
2. **Recipes = presets.**
   - Every modifier ships 5–10 recipes, each one a concrete stage look.
   - A recipe sets *all* parameters, including distribution and tempo.
3. **What belongs together becomes one visual editor with handles.**
   - Quantities you can grab on a shape are handles, not faders: width, softness, peak, floor, range, rate.
   - Faders only for abstract quantities.
4. **Endless-strip preview inside the editor.** A continuous animated strip ("infinitely many pixels") shows the *behaviour*, independent of the fixture count. The canvas shows the stepped result on real fixtures.
5. **One shared Distribution section**, identical in every modifier. A modifier declares which options it supports.
6. **The UI is English.** All labels, recipe names, tooltips and hints.

### 0.3 Glossary (new terms)

| Term | Meaning |
|---|---|
| **Distribution** | How an instance spreads over fixtures. It produces `spatial`, `rank` and `distGroup` per sample. |
| **Scope** | `across` (over fixtures) or `within` (over heads/pixels inside each fixture). |
| **Mode** | `none` · `linear` · `radial` · `conical` · `order`. |
| **Gradient handle** | Origin + end point on the canvas. Defines direction and length for linear/radial/conical. |
| **Rank** | Position of a fixture in an *order* (0-based). Several fixtures may share a rank. |
| **Grouping** | Optional mapping of ranks to groups: `everyN`, `sections`, `random`. |
| **`spatial`** | Per-sample position along the distribution: 0 at the origin or first rank, 1 at the end or after the last rank. |
| **`timePhase`** | Temporal phase of the instance in cycles (the former speed phase). |
| **Profile** | Wave/Color curve: what is lit over the distance. |
| **Motion** | Curve: where the profile is during one pass (position over time). |
| **Recipe** | Manifest preset: named, complete parameter set with an animated thumbnail. |
| **Composite editor** | One `pm.*` input bound to several params (e.g. the hue strip binds `hueShift` + `hueRange`). |
| **Shape** | Programmatic curve generator with args; every arg is a handle. |

### 0.4 Current state (reference)

**Plugins**
- `plugins/{waveform,noise,sequencer,color-adjust}/manifest.json` + `modifier.ts`.
- Params are read by f32 slot index.

**Param types** (`packages/extension-api/src/params.ts`)
- number, int, bool, enum, color, angle, point, curve.
- `curve` = `CurvePoint[]`, wired as a 128-f32 LUT (`packages/plugin-toolchain/src/params.ts`).

**ABI v1** (`packages/plugin-sdk/assembly/core.ts`, `rs-engine/core/src/runtime.rs`)
- Frame: 16 f32; slots 0–7 used, **8–15 reserved**.
- Sample: 16 f32; slots 0–12 used, **13–15 reserved**.

**Phase** (`rs-engine/core/src/phase.rs`)
- `phase = speed_phase − directional_distance / fanning`.
- Directions: None, Linear, Radial, Symmetrical, Angular.

**Instance** (`app/utils/engine/types.ts` `ModifierInstance`)
- `direction`, `originX`, `originY`, `angle`, `fanning`, `reverse`, `params`, …

**Wire** (`app/utils/connectors/binary-encoder.ts` `buildModifiersBin`, `rs-engine/core/src/bin_protocol.rs`)
- `TYPE_MODIFIERS_BIN 0x16`, version byte `1`.
- Fixtures are addressed by layout index (mask bits).

**UI**
- Cards: `app/components/engine/ChaserModifiersList.vue`.
- Params: `app/components/plugin-host/ParamForm.vue`.
- Generic fields: `ModifierGenericFields.vue` (Strength, `SpeedControl.vue`, `ChaserFanningControl.vue`).
- Canvas handles: `app/components/engine/FixtureEditorSpatialControls.vue`.
- Previews: `app/utils/plugins/preview-pool.ts` (`renderCycle`, `renderField`; it mirrors the phase in TS).

**Old editors** (reuse visuals and logic): `git show master:app/components/engine/<Name>.vue`
- `WaveformEditor`
- `SpeedCurveEditor`
- `ColorEditor`
- `NoiseEditor`
- `SequencerEditor`
- `ChaserFanningControl`
- `SpeedControl`

---

## 1. Data model (target)

### 1.1 Distribution (instance level)

`app/utils/engine/types.ts`. It replaces `direction/originX/originY/angle/fanning/reverse`.

```ts
/** How an instance spreads over fixtures (shared by all modifiers). */
export interface Distribution {
  /** Over fixtures, or over the heads/pixels inside each fixture. */
  scope: 'across' | 'within';
  mode: 'none' | 'linear' | 'radial' | 'conical' | 'order';
  /** Gradient handle, normalized world coords (linear/radial/conical). */
  origin: Vec2;
  end: Vec2;
  /** Mirrors spatial: s → 1 − s. */
  reverse: boolean;
  /** Fixture order (mode 'order', and 'within' + offset 'order'). */
  order: {
    /** Explicit ranks by fixture id (click tool / resolved line). */
    ranks: Record<string, number>;
    /** Last drawn line; used to place fixtures without an explicit rank. */
    line?: { a: Vec2; b: Vec2 };
    /** Cluster tolerance as a fraction of the median spacing (0–1). */
    snap: number;
  };
  grouping: { kind: 'none' | 'everyN' | 'sections' | 'random'; n: number; seed: number };
  /** Scope 'within': offset fixtures by their order rank. */
  withinOffset: 'none' | 'order';
}
```

**Defaults** (`createDistribution()`):
```
{ scope:'across', mode:'none', origin:{0.4,0.5}, end:{0.6,0.5}, reverse:false,
  order:{ ranks:{}, snap:0.5 }, grouping:{ kind:'none', n:2, seed:1 }, withinOffset:'none' }
```
Modifiers override this through manifest defaults and recipes (§1.4).

### 1.2 Per-sample values (host → plugin)

The host computes the following once per instance and frame (`rs-engine/core/src/distribution.rs`, new). The preview pool mirrors it exactly (§M3.6).

| Value | Definition |
|---|---|
| `p` | Sample position (normalized world x, y) |
| `L` | `|end − origin|` (≥ 1e-4); `u = (end − origin) / L` |
| **linear** | `spatial = dot(p − origin, u) / L` |
| **radial** | `spatial = |p − origin| / L` |
| **conical** | `spatial = wrap01((atan2(p − origin) − atan2(u)) / 2π)` |
| **order** | `spatial = rank / rankCount`, with `rankCount = max(rank) + 1` over targeted fixtures |
| **none** | `spatial = 0` |
| **scope within** | `rank = headIndex`, `rankCount = headCount`, `spatial = headIndex / headCount` |
| **within + withinOffset 'order'** | `spatial = (fixtureRank + headIndex / headCount) / fixtureRankCount` |
| **grouping** (on `rank`, any mode with ranks; for linear/radial/conical first quantize: `rank = floor(clamp01(spatial) · 16)`, `rankCount = 16`) | `everyN`: `distGroup = rank mod n`, `distGroupCount = n` |
| | `sections`: `distGroup = floor(rank · n / rankCount)`, `distGroupCount = n` |
| | `random`: `distGroup = perm_seed(rank) mod n` (seeded Fisher-Yates over `0..rankCount`) |
| | With grouping, `spatial = distGroup / distGroupCount` (all members of a group are equal) |
| | Without grouping: `distGroup = −1`, `distGroupCount = 0` |
| **reverse** | `spatial = 1 − spatial` (applied last) |
| **legacy** | `phase = timePhase − spatial`. Keeps ABI-v1 plugins working: with linear, `L` equals the old `fanning` |

Ranks are **resolved in TypeScript** (§M3.2) and sent as a complete table. Rust only looks them up.

### 1.3 ABI v1.1 (additive, uses reserved slots)

| Buffer | Slot | Name | Meaning |
|---|---|---|---|
| Frame | 8 | `timePhase` | Speed phase in cycles (unwrapped) |
| Frame | 9 | `rankCount` | Ranks of this instance (0 when mode has none) |
| Frame | 10 | `distGroupCount` | Groups (0 = no grouping) |
| Sample | 13 | `spatial` | §1.2 |
| Sample | 14 | `rank` | Rank of the sample (−1 if none) |
| Sample | 15 | `distGroup` | Group of the sample (−1 if none) |

- Older plugins read only slots they know → fully compatible.
- `API_VERSION` / SDK version → `1.1.0`.
- A plugin that *needs* the new fields declares `"apiVersion": "^1.1.0"`.

### 1.4 Manifest additions (all optional)

`packages/plugin-toolchain/src/types.ts` (`ContentPluginManifest`), validated in `manifest.ts`.

```jsonc
{
  "purpose": "Brightness runs, swings or breathes across your fixtures.",   // one sentence, shown in the Add menu
  "distribution": {
    "modes": ["none","linear","radial","conical","order"],   // offered modes, in UI order
    "scopes": ["across","within"],
    "grouping": true,
    "default": { "mode": "order" }                           // partial Distribution
  },
  "editors": [                                               // composite editors, rendered first, in order
    { "id": "hue", "input": "pm.hueRange", "bind": { "shift": "hueShift", "range": "hueRange" }, "when": { "mode": "shift" } }
  ],
  "presets": [                                               // recipes
    { "id": "chase", "label": "Chase", "description": "One dot runs along the row.",
      "params": { … }, "speed": { "mode":"beat", "beatValue":4 },
      "distribution": { "mode":"order" }, "strength": 1, "default": true }
  ],
  "params": [
    { "key": "profile", "type": "curve", "tier": "primary", … },
    { "key": "invert", "type": "bool", "tier": "advanced", … }
  ]
}
```

Field details:
- **`tier`**:
  - `primary` = in the card body.
  - `advanced` = under "More".
  - `hidden` = never rendered (recipes and editors still set it).
  - Default `primary`.
- **`when`** on params and editors: show only when the condition holds. Supports equality on other param keys and on `distribution.mode`.
- **`bind`**: maps the composite input's prop names to param keys. The input receives `modelValue: Record<prop, value>` and emits the same shape.

### 1.5 Param types (new and extended)

`packages/extension-api/src/params.ts`, `PARAM_WIRE_SLOTS`, `PARAM_DEFAULT_INPUT`, toolchain `writeParam`, validation.

**`curve` v2** (wire unchanged: 128 slots)
```ts
type CurveValue =
  | { shape: string; args: Record<string, number> }      // programmatic
  | { points: CurvePointV2[] }                             // free
  | CurvePoint[];                                          // legacy = free points (Catmull-Rom)
interface CurvePointV2 { x: number; y: number; kind?: 'smooth'|'corner'|'linear'|'step';
                         in?: { dx: number; dy: number }; out?: { dx: number; dy: number } }
interface CurveParam extends ParamBase<'curve', CurveValue> {
  shapes?: string[];            // offered shapes (registry ids), UI order; omitted = free only
  allowFree?: boolean;          // default true
  domain?: 'cycle' | 'signed';  // LUT x-range: 'cycle' = [0,1], 'signed' = [−1,1] (profiles, §M6)
  axis?: 'fixtures' | 'beats' | 'none';   // tick/snap context in the editor
  range?: 'unipolar' | 'bipolar';         // y display; wire stays 0–1
}
```

**`gradient`** (wire: 1 + 8 × 4 = **33** slots: `count, (pos, r, g, b) × 8`, unused stops zero)
```ts
interface GradientValue { stops: { pos: number; color: RgbColor }[] }   // 1–8 stops, pos 0–1 sorted
```
Default input `pm.gradient`.

**`steps`** (wire: 2 + 16 = **18** slots: `groups, steps, mask[16]`; `mask[s]` bit `g` = group `g` on in step `s`)
```ts
interface StepsValue { groups: number /*1–8*/; steps: number /*1–16*/; cells: boolean[][] /*[step][group]*/ }
```
Default input `pm.steps`.

**Encoding context:**
- `encodeParams(schema, values, ctx?: { ticks?: number })`.
- `ticks` = rank count of the instance, so shapes with `count: 0` ("auto") resolve to one step per fixture.
- `buildModifiersBin` passes it.

---

## 2. Phases

### Phase M0 — Decisions & docs skeleton

- [x] **M0.1 ADR amendment.** Add amendment *A20 (Modifier UX)* to ADR 0001:
  - Distribution replaces direction/fanning.
  - ABI v1.1 slots (§1.3).
  - Manifest fields (§1.4).
  - Param types (§1.5).
  - Project schema version 3.
  - Link this plan.

  *Accept:* amendment merged; this plan is linked from `architecture.md` → Documentation Map.
- [x] **M0.2 Output semantics decision.** *Decided: (b) `scale` (A20).* Level-type modifiers (Wave, Noise, Pattern) express levels relative to the programmed value. Decide:
  - **(a)** keep `bipolar` (`base + strength·(v−1)`), or
  - **(b)** a new output mode `scale` (`base · lerp(1, v, strength)`).

  **Recommendation (b):** "Floor 20 %" then means 20 % *of the programmed value* at any base.

  If (b), implement in `rs-engine/core/src/engine.rs` (blend), `preview-pool.ts` (mirror), manifest `output: 'scale'`, and validation.

  *Accept:* decision recorded in A20; tests for the chosen formula.

### Phase M1 — Shape registry & curve v2 (data + sampling)

- [x] **M1.1 Types.** Extend `CurveParam`/`CurvePoint` as in §1.5 and export `CurveValue`, `CurvePointV2`, `ShapeDef`, `ShapeArgDef` from `@pixelmapper/extension-api` (new file `src/curves.ts`):
  ```ts
  interface ShapeArgDef { key: string; label: string; min: number; max: number; default: number; step?: number;
    /** Handle on the curve: how the editor draws/drags this arg. */
    handle: { kind: 'edgeX' | 'pointOnEdge' | 'lineY' | 'none';
              /** Where the handle sits for the current args (normalized editor coords). */
              anchor: (args: Record<string, number>) => { x: number; y: number };
              /** Pointer (normalized) → new arg value. */
              drag: (args: Record<string, number>, p: { x: number; y: number }) => number;
              /** Snap to ticks (fixtures/beats) when the editor has an axis. */
              snap?: 'ticks' | 'none' } }
  interface ShapeDef { id: string; label: string; domain: 'cycle' | 'signed'; periodic: boolean;
    args: ShapeArgDef[];
    /** y(x) in 0–1; x in the domain; ctx.ticks = rank count. */
    evaluate: (x: number, args: Record<string, number>, ctx: { ticks: number }) => number;
    /** Optional exact conversion to free points (else sampled). */
    toPoints?: (args: Record<string, number>, ctx: { ticks: number }) => CurvePointV2[] }
  ```
  *Accept:* types compile; `docs/ai` regenerated later (M11).
- [x] **M1.2 Registry module.** `packages/plugin-toolchain/src/curve-shapes.ts` (isomorphic, no DOM), exported as `@pixelmapper/plugin-toolchain/curve-shapes`:
  - `registerShape(def)`, `getShape(id)`, `listShapes()`
  - built-in shapes (§3.1)
  - `evaluateCurve(value, x, ctx)`, `sampleCurveLut(value, size, ctx, domain)`

  *Accept:* unit tests per shape (values at key x, periodicity, args clamped).
- [x] **M1.3 Free-point sampling.** In `params.ts`, replace `sampleCurve` with `evaluatePoints(points, x)`:
  - per segment by the *left* point's `kind`: `smooth`/`corner` = cubic Bezier with `out` of left and `in` of right (default handles = ⅓ segment, Catmull-Rom tangents); `linear`; `step` = hold the left y.
  - Legacy `CurvePoint[]` (no `kind`) → existing Catmull-Rom (bit-identical).

  *Accept:* golden test — legacy LUT unchanged byte for byte; Bezier/linear/step tests.
- [x] **M1.4 LUT domain.** `writeParam` for curves:
  - `domain:'cycle'` samples `x = i/127`.
  - `domain:'signed'` samples `x = −1 + 2i/127`.
  - Clamp to 0–1.

  *Accept:* test for both domains.
- [x] **M1.5 Validation.** In `manifest.ts`:
  - `shapes` ids must exist in the toolchain registry, or warn when unknown (extension shapes are only known in the app);
  - curve defaults must be valid `CurveValue`;
  - `domain`/`axis`/`range` enums.

  *Accept:* toolchain tests.
- [x] **M1.6 App registry + extension shapes.**
  - `app/utils/params/curve-shapes.ts` re-exports the toolchain registry.
  - Add `contributes.curveShapes: ShapeDef[]` to the extension API (`packages/extension-api/src/extension.ts`) and register on activation (`app/utils/extensions/activation.ts`).

  *Accept:* test extension contributes a shape that appears in `listShapes()` and samples on the wire.

### Phase M2 — `pm.curve` v2 component

File: `app/components/pm/PmCurve.vue` (rewrite; split helpers into `app/components/pm/curve/` to stay < 200 lines per file per AGENTS.md).

- [x] **M2.1 Contract.** In `packages/extension-api/src/replaceables.ts`, `CurveProps` becomes:
  ```ts
  { modelValue: CurveValue; shapes?: string[]; allowFree?: boolean; domain?: 'cycle'|'signed';
    axis?: 'fixtures'|'beats'|'none'; ticks?: number /* fixtures or beats per cycle */;
    range?: 'unipolar'|'bipolar'; playhead?: number | null /* 0–1 in domain units */;
    strip?: boolean /* show endless strip slot */; yMax?: number }
  ```
  Emits are unchanged.
- [x] **M2.2 Shape bar.**
  - Thumbnails (44×18 SVG) rendered from `evaluate` for each offered shape, plus "Free" when `allowFree`.
  - Active shape highlighted.
  - Clicking a shape sets `{ shape, args: defaults }`, keeping `peak`/`floor` and any arg with the same key.

  *Accept:* clicking each shape emits a valid value; keyboard focusable buttons with `aria-pressed`.
- [x] **M2.3 Canvas & polyline.**
  - SVG 240×72 (`preserveAspectRatio="none"`), height 56/80/120 by size.
  - Midline for bipolar.
  - Tick marks: `axis:'fixtures'` → one tick per fixture (`ticks`); `axis:'beats'` → 8 per beat (same as the old WaveformEditor).
  - Inactive zones for `hold`-like shapes.
  - 120-sample polyline from `evaluateCurve`.
  - Playhead line when `playhead != null`.
- [x] **M2.4 Arg handles (programmatic mode).**
  - For every arg with `handle.kind !== 'none'`, draw at `anchor(args)`:
    - `edgeX` = double-arrow on the flank, `ew-resize`
    - `pointOnEdge` = filled circle
    - `lineY` = full-width hit line + small grip, `ns-resize`
  - Drag calls `drag(args, p)`, clamps to min/max, and snaps to ticks when `snap:'ticks'` and Shift is *not* held (same as the old WaveformEditor: threshold 0.35 × tick spacing).
  - One `scrubStart` per drag, one `scrubEnd` on release (= one undo step).
  - Double-click a handle resets the arg to its default.

  *Accept:* component tests per handle kind (synthetic pointer events) assert the emitted args and the snapping.
- [x] **M2.5 Free mode.** "Free" (or "Edit points" in the shape menu) converts the current shape via `toPoints` (or 16-point sampling) → `{ points }`. Then:
  - drag points (end points: y only);
  - click on the polyline inserts a point (kind `smooth`);
  - Del/Backspace or double-click removes the selected inner point;
  - right-click opens the point menu (Smooth / Corner / Linear / Step);
  - the selected point shows tangent handles (`in`/`out`); Alt-drag decouples (`corner`);
  - Shift snaps to ticks and the 25 % y grid;
  - "Back to shape" restores the last programmatic value (kept in component state for the session).

  *Accept:* tests for insert/delete/kind change/tangent drag; LUT of the converted shape equals the shape LUT ± 1e-2.
- [x] **M2.6 Endless strip slot.** When `strip`, render a `<slot name="strip">` under the SVG. The card fills it with `EndlessStrip` (M5.4).
- [x] **M2.7 ParamForm wiring.** Pass `shapes`, `allowFree`, `domain`, `axis`, `range` from the param def; pass `ticks` from the instance's resolved rank count (prop from the card) and `playhead` from the live phase (M5.5).

### Phase M3 — Distribution core (engine, wire, preview, migration)

- [x] **M3.1 Types & factory.** In `app/utils/engine/types.ts` + `modifiers.ts`:
  - `Distribution` (§1.1), `createDistribution(partial?)`;
  - `ModifierInstance.distribution` replaces `direction/originX/originY/angle/fanning/reverse`.
  - Update every reader (grep `\.fanning\b|\.direction\b|originX|\.angle\b` in `app/`).

  *Accept:* typecheck clean.
- [x] **M3.2 Rank resolution** (`app/utils/engine/distribution/order.ts`, pure):
  - `projectionRanks(points: {id, x, y}[], a, b, snap): Record<id, number>`:
    1. project onto `b − a`;
    2. sort;
    3. compute the median of the gaps > 1e-6 (fallback 1);
    4. start a new rank when `p − clusterStart > snap · median` (cluster anchored at its first element, so chains of small gaps do not merge everything).
  - `resolveRanks(dist, fixtures)`:
    - explicit `order.ranks` first;
    - then fixtures without a rank by projection on `order.line` (merged into the existing clusters if within tolerance, else appended in projection order);
    - then the rest by `autoAxis` (M3.3);
    - finally compacts ranks to 0..n−1 preserving equality.
  - `clickRank(ranks, id, shift)`: click tool semantics (§M4.3).

  *Accept tests:*
  - 8 in a row → 0..7;
  - symmetric double row, line front→back → pairs share ranks;
  - fixtures jittered by 20 % of spacing with snap 0.5 → same ranks as un-jittered;
  - snap 0 → all distinct;
  - single fixture → rank 0.
- [x] **M3.3 Selection analysis** (`app/utils/engine/distribution/selection-shape.ts`, pure):
  - `analyzeSelection(fixtures)` returns `{ count, centroid, axis: {a, b} /* PCA main axis, spanning min..max projection, oriented +x then +y */, extentMain, extentCross, kind: 'single'|'row'|'ring'|'area', multiHead: boolean }`.
  - Rules:
    - `row` if `extentCross / extentMain < 0.15`;
    - `ring` if count ≥ 6 and coefficient of variation of the distance to the centroid < 0.15;
    - otherwise `area`.
    - `multiHead` = every fixture has ≥ 4 heads.

  *Accept:* tests for row, ring, area, single, bars.
- [x] **M3.4 Wire v2.** `buildModifiersBin` writes version byte **2**. The distribution block replaces the direction block:
  ```
  u8 scope(0 across,1 within); u8 mode(0 none,1 linear,2 radial,3 conical,4 order);
  f32 originX, originY, endX, endY; u8 reverse;
  u8 groupingKind(0 none,1 everyN,2 sections,3 random); u8 groupingN; u32 groupingSeed;
  u8 withinOffset(0 none,1 order);
  u16 rankEntries; per entry: u16 fixtureLayoutIndex, u16 rank      // only targeted fixtures; mode order or withinOffset order
  ```
  Ranks come from `resolveRanks`. `encodeParams(…, { ticks: rankCount })`.

  *Accept:* encoder test (round trip via a TS decoder helper); packet size test for 200 fixtures (< 64 KB budget documented).
- [x] **M3.5 Rust.**
  - `bin_protocol.rs` parses v1 (map the legacy direction block: Symmetrical → linear on |d| is not representable, so map it to `order` with ranks resolved from |projection| as a fallback; better: keep a legacy `Spatial` path for v1 packets) and v2.
  - New `distribution.rs` implements §1.2: `fn sample_distribution(&Distribution, ranks, x, y, head, head_count, fixture) -> (spatial, rank, group)`.
  - `engine.rs` `render_instance` fills Sample 13–15 and Frame 8–10, and `phase = sp − spatial`.
  - Keep `phase.rs` `speed_phase`/`phase_speed`; delete `Spatial` once v1 support is only the mapping.

  *Accept:* `cargo test` — a table test per mode/scope/grouping/reverse against hand-computed values (same table as M3.6).
- [x] **M3.6 Preview mirror.**
  - `app/utils/plugins/preview-pool.ts`: replace `spatialOffset` with a TS port of `distribution.rs` (`app/utils/engine/distribution/sample.ts`) and fill the new slots.
  - `renderField` gains a *virtual strip* mode: `renderStrip(m, cols, opts)` with samples `spatial = i/cols`, `rank = floor(i·rankCount/cols)`, `distGroup` from grouping. This is used by `EndlessStrip`.

  *Accept:* a shared fixture-table test runs the TS port and compares with the values hard-coded from the Rust test (parity).
- [x] **M3.7 SDK.** In `packages/plugin-sdk/assembly/core.ts`, add getters:
  - `Frame.timePhase`, `Frame.rankCount`, `Frame.distGroupCount`;
  - `Sample.spatial`, `Sample.rank`, `Sample.distGroup`.

  Then `bun run gen:sdk`, bump SDK/API versions to 1.1.0, and update `rs-engine/core/src/runtime.rs` constants.

  *Accept:* toolchain compiles a test plugin that reads the new fields; worker bridge passes them (`app/utils/plugins/worker-bridge.ts` copies whole buffers, verify).
- [x] **M3.8 Migration** (`app/utils/persistence/migrations/v3-distribution.ts`, project schema 2 → 3; wire into `serialize.ts` load path). Per instance:

  | Old | New |
  |---|---|
  | `NONE` or `fanning == 0` | `mode none` |
  | `LINEAR` | `mode linear`; `origin = (originX, originY)`; `end = origin + fanning·(cos angle, sin angle)` (fanning was world-width units per cycle → normalized) |
  | `RADIAL` | `radial`, same `end` |
  | `ANGULAR` | `conical`, `end` along angle with length 0.1 |
  | `SYMMETRICAL` | `order`, `order.line = { a: origin, b: origin + fanning·dir }` with `order.mirror: true`: ranks by `|projection|` from `line.a` (the center), as for the *Center Out* recipe (implemented: `order.mirror?: boolean`; `resolveRanks` handles it) |
  | `reverse` | `reverse` |

  Snapshot readers and command payloads (`SetModifiersCommand`) migrate on load/replay.

  *Accept:* migration tests per case; a v2 project fixture loads and renders identically for linear/radial (pixel-equal `renderField`).

### Phase M4 — Distribution UI & canvas tools

- [x] **M4.1 `DistributionSection.vue`** (`app/components/engine/distribution/`, replaces `ChaserFanningControl.vue`). Layout (English):
  ```
  DISTRIBUTION
  Scope   [Across fixtures] [Within each fixture]            (only if manifest scopes > 1)
  Mode    [All same] [Linear] [Radial] [Conical] [Order]     (icons + labels; only offered modes)
  — linear/radial/conical:  "Drag the handle on the canvas"   ⇄ Reverse
  — order:  Tool [☝ Click fixtures] [✎ Draw line]   Snap ──●──   ⇄ Reverse   ✕ Clear
            Grouping [None] [Every N ▾2] [Sections ▾4] [Random ⟳]   (if manifest grouping)
  — within: Offset per fixture [None] [By order]
  ```
  - Tool buttons toggle a canvas tool state in the engine store (`distributionTool: null | 'click' | 'line'`, bound to the active modifier).
  - The Snap slider only shows after a line was drawn.

  *Accept:* component test — offered modes follow the manifest; switching mode keeps the other fields.
- [x] **M4.2 Gradient handle.**
  - Adapt `FixtureEditorSpatialControls.vue` to `distribution.origin/end`: origin = diamond, end = circle, line between them.
  - Shown for linear/radial/conical.
  - For radial, also draw a circle with radius `L`; for conical, a ray.
  - While dragging, show the field overlay (`ModifierFieldOverlay.vue`, now driven by the new preview).
  - Commits one `SetModifiersCommand` per drag.

  *Accept:* drag test updates origin/end; undo restores.
- [x] **M4.3 Order tools** (`app/components/engine/distribution/OrderTool.vue` overlay inside the canvas, active only while a tool is on):
  - **Click:**
    - clicking a targeted fixture assigns the next rank;
    - Shift-click assigns the *same* rank as the previous click;
    - clicking a ranked fixture moves it to the next rank;
    - Esc or clicking the tool button ends the tool; clicking empty space does nothing;
    - each click is live, and the tool session commits once on end.
  - **Line:**
    - press-drag-release draws a line (shown dashed with an arrow);
    - on release, `projectionRanks` assigns ranks and stores `order.line`;
    - the Snap slider (section) re-resolves from the stored line live.
  - **Overlays** (while the modifier is active and mode is order): rank numbers on fixtures (badge, same number for clusters); grouping colors (8-color palette, also used by `pm.steps` row colors).

  *Accept tests:* click sequence ranks; shift-click shares; line on a symmetric rig gives pairs; snap slider merges or splits clusters.
- [x] **M4.4 Within-scope affordance.** When scope is `within`, show small arrows along each multi-head fixture in head order (direction of `spatial`); with offset 'order', also show the rank badges.
- [x] **M4.5 Hit-testing & conflicts.**
  - While a distribution tool is active, the canvas selection/drag handlers are suspended (guard in `use-selection.ts`), and the cursor is a crosshair.
  - Overlay buttons belong to `FLOATING_OVERLAY_SELECTORS` (`app/utils/floating-overlay.ts`), so the sidebar does not close.

  *Accept:* clicking fixtures with the tool active does not change the selection.

### Phase M5 — Card framework (recipes, composite editors, tiers, strip)

- [x] **M5.1 Manifest fields.** Types + validation for `purpose`, `distribution`, `editors`, `presets`, `tier`, `when` (§1.4) in `packages/plugin-toolchain/src/{types,manifest}.ts`.

  Validation:
  - preset params must exist and match types;
  - editor `bind` keys must exist;
  - `when` keys must exist;
  - exactly 0 or 1 preset has `default: true`.

  *Accept:* toolchain tests incl. error messages.
- [x] **M5.2 Recipe bar** (`app/components/plugin-host/RecipeBar.vue`):
  - Horizontal wrap of tiles: 64×28 animated thumbnail (`renderStrip` with the preset applied, 24 cols, ~15 fps, paused when off-screen via `IntersectionObserver`) + label.
  - Active tile = the preset whose params deep-equal the instance (else none, label "Custom").
  - Click applies params + speed + distribution + strength as **one** `SetModifiersCommand`; distribution fields not given by the preset are kept.

  *Accept:* applying each preset is one undo step; "Custom" shows after any edit.
- [x] **M5.3 ParamForm v2** (`app/components/plugin-host/ParamForm.vue`):
  - Render order:
    1. composite editors (`editors`, filtered by `when`);
    2. primary params not bound to an editor;
    3. "More" (collapsible, closed by default, remembered per plugin in localStorage) with advanced params.
  - Hidden params are never shown.
  - Composite editors get `modelValue` built from `bind` and write back only the bound keys.
  - Pass the curve props (M2.7).

  *Accept:* tests — bound params do not appear twice; `when` hides/shows; More toggles.
- [x] **M5.4 `EndlessStrip.vue`** (`app/components/plugin-host/`):
  - 100 % width, 14 px high canvas with `renderStrip(m, 256)` per animation frame (throttled to 30 fps).
  - Scalar → greyscale, rgb → colors, panTilt → hidden.
  - Uses the instance's real speed and the distribution grouping, but a virtual continuous `spatial`.

  *Accept:* renders for scalar/rgb; stops when the card is off-screen.
- [x] **M5.5 Live phase for playheads.** Expose the instance's current `timePhase` (computed from the shared clock in TS, `speedPhase`) via a small composable `useModifierPhase(m)` for curve playheads and the steps grid.
- [x] **M5.6 Card layout** (`app/components/engine/ChaserModifiersList.vue`, split into `ModifierCard.vue` + `ModifierCardHeader.vue` to stay < 200 lines). All cards expanded.
  1. **Header:**
     - title `"<Plugin name> · <active recipe label | Custom>"`;
     - right: plugin switch (menu, not a prominent select), pin, delete;
     - extension `badges`/`actions` slots unchanged;
     - the drag handle stays.
  2. Recipe bar.
  3. ParamForm v2 (editors + primary).
  4. **Tempo row:** `SpeedControl` (beat segmented 1/16…8; time mode via icon) + beat offset, and Strength (`pm.numberInput` %).
  5. `DistributionSection`.
  6. Channel chips (only if the tab has > 1 channel type).
  7. "More" (advanced params + blend mode per card).

  *Accept:* snapshot/DOM test of the order; existing extension slots (`modifiers/modifier:badges|actions`) still render (regenerate the slot catalog).
- [x] **M5.7 Add menu.** Each modifier entry shows its label + `purpose` + a tiny thumbnail of its default preset. "Browse & import…" and "New from code…" stay at the bottom.
- [x] **M5.8 Defaults on add** (`app/components/engine/composables/use-chaser-modifiers.ts`):
  - When adding, run `analyzeSelection` and pick the preset by the manifest-declared rule `presets[].when?: { kind?: ('single'|'row'|'ring'|'area')[]; multiHead?: boolean; hasColor?: boolean }`; fall back to `default: true`.
  - Then fill the distribution: `origin/end` = `selection.axis`, and for order, `order.line = selection.axis` (ranks resolve automatically).

  *Accept:* tests per selection kind pick the documented recipe (§3–§6 Defaults).

### Phase M6 — Wave

Rewrite `plugins/waveform` (keep the alias `waveform`; display name **"Wave"**). Needs ABI 1.1 and M0.2.

- [x] **M6.1 Manifest**
  - `signatures: ["scalar"]`, output per M0.2.
  - Params:
    - `profile`: curve, `domain: signed`, `axis: fixtures`, `range: unipolar`, `shapes: ["dot","bar","wave","wedge","edge","flash"]`, `tier: primary`, default `{ shape:"dot", args:{ width:0.15, softness:0.5, repeat:1, peak:1, floor:0 } }`.
    - `motion`: curve, `domain: cycle`, `axis: beats`, `shapes: ["run","pingpong","step","hold","ease"]`, default `{ shape:"run", args:{} }`.
    - `invert`: bool, advanced.
  - Distribution: all modes, both scopes, grouping true, default `{ mode:"order" }`.
  - Presets: §3.2.
- [x] **M6.2 Plugin math**
  ```
  m  = motion(fract(ctx.timePhase))                 // position 0–1 of the pass
  x  = s.spatial − m                                // ∈ [−1, 1] for spatial ∈ [0, 1]
  x  = x < −1 || x > 1 ? wrapSigned(x) : x          // periodic shapes repeat; spatial outside 0–1 (linear beyond end) still defined
  v  = profileLUT(signed→index(x))                  // 0–1
  v  = invert ? 1 − v : v
  out per M0.2 (level semantics: 1 = programmed value)
  ```
  - Periodic profile shapes (dot, bar, wave, wedge, flash) have period `1/repeat` in x.
  - `edge` is non-periodic: `v = x ≤ 0 ? 1 : 0` with softness ramp → **Build**.
- [x] **M6.3 Goldens.**
  - New goldens for the presets on an 8-fixture row at 8 times.
  - Old goldens move to the legacy-mapping test (M6.4).
- [x] **M6.4 Legacy conversion.** Map old `{shape, param, start, end, offset, useFloor, floor}` to the new profile/motion (`app/utils/engine/migrations/wave-v2.ts`):
  - shape → profile shape with the time curve reproduced as a *motion = run, distribution unchanged* equivalent where possible;
  - otherwise a free-points profile sampled from the old `evaluateShape` (128 points);
  - document the residual differences (window/offset).

  *Accept:* old projects render within 2 % RMS.

  *Implemented* (`app/utils/plugins/legacy/waveform-v1.ts`): every old shape (window, offset, floor included) becomes a 128-point free profile with motion *Run*. Exact at base 100 % except:
  - hard edges blur over one LUT step (1/64 cycle; the RMS test excludes that band);
  - below base 100 % dips are relative, not absolute (A20);
  - the floor with strength < 1 − floor clamps at 0.
- [x] **M6.5 Old plugin hashes.**
  - `scripts/build-plugins.ts` keeps `app/utils/plugins/builtin-legacy.ts`: old hash → `{ alias, migrateParams }`.
  - `plugin-store.ts` resolves a legacy hash to the current built-in and runs `migrateParams` once (marking the instance dirty → persisted).

  *Accept:* a project saved before M6 opens without "missing plugin" and keeps its look.

  *Implemented:* `build-plugins.ts` appends replaced hashes (with version and param schema) to `app/utils/plugins/builtin-legacy.json`; `builtin-legacy.ts` redirects them inside the deep load migration (snapshots of any schema, change-log payloads, live sync) and runs `alias@major` param migrations.

### Phase M7 — Color Shift

Rewrite `plugins/color-adjust` (alias kept; display name **"Color Shift"**).

- [x] **M7.1 `gradient` param type** (§1.5) + toolchain encode/validate + `pm.gradient` contract.
- [x] **M7.2 `PmGradient.vue`:**
  - gradient bar with stops; drag stops; click the bar adds a stop (color interpolated);
  - Del removes (min 1 stop);
  - clicking a stop opens `pm.colorInput` in a popover (the extension color picker applies automatically through `Replaceable`).
- [x] **M7.3 `PmHueRange.vue`** (port `ColorEditor.vue` from master): composite `{ shift, range }`; 360° strip centered on the base hue; drag center = shift, drag within 5 % of an edge = range; EditableNumbers in the header.
- [x] **M7.4 Manifest:**
  - `signatures: ["rgb"]`, `output: "absolute"`.
  - Params:
    - `mode` enum `palette|shift` (primary, segmented)
    - `palette` gradient (`when mode=palette`, default Red→Blue)
    - `transition` number 0–1 (Hard→Soft, `when mode=palette`)
    - `hueShift`, `hueRange` (hidden, bound to the `hue` editor, `when mode=shift`)
    - `saturation` 0–2
    - `satDip` 0–1 (advanced)
    - `profile` curve (signed, shapes `wave,dot,bar,flash`, advanced, default `wave`)
    - `motion` curve (`run,pingpong,step,hold,ease`)
  - Editors: `{ id:'hue', input:'pm.hueRange', bind:{ shift:'hueShift', range:'hueRange' }, when:{ mode:'shift' } }`.
  - Distribution: all modes, both scopes, grouping.
- [x] **M7.5 Plugin math:**
  ```
  m = motion(fract(timePhase)); u = fract(spatial − m)
  palette: c = gradientSample(u, transition)   // transition 0 = nearest stop (hard), 1 = linear blend
  shift:   p = profile(u) ; hue = base.h + hueShift + hueRange·(2p − 1) ; sat = base.s·saturation·(1 − satDip·p)
  ```
  *Implemented:*
  - Shift: the dip ("White dip") blends toward white at the programmed brightness, `rgb += (level − rgb)·satDip·p`; lowering HSL saturation only produced grey.
  - Palette keeps the programmed brightness (max of the base RGB; unlit bases take the palette as is).
  - Hard palettes hold each stop until the next one, wrapping.
  - R1 adds `arrange: gradient | alternate` (alternate = stop `(rank + ⌊m·stops⌋) mod stops`).
- [x] **M7.6 Canvas palette stops.**
  - With mode palette and distribution linear/radial/conical, draw the stops on the gradient line in `FixtureEditorSpatialControls.vue`.
  - Dragging a stop along the line writes `palette.stops[i].pos`; clicking opens the same color popover.
  - **Follow-up (not in this plan):** the same overlay in the 3D viewport.
- [x] **M7.7 Goldens + legacy mapping** (old `hueShift/saturation/hueRange/satRange/shape/shapeParam` → mode shift + profile; M6.5 mechanism).

### Phase M8 — Pattern

Rewrite `plugins/sequencer` (alias kept; display name **"Pattern"**).

- [x] **M8.1 `steps` param type** (§1.5) + encode/validate + contract.
- [x] **M8.2 `PmSteps.vue`:**
  - grid with rows = groups (row color = canvas group color; label "Group A…"), columns = steps, header numbers;
  - "+" adds a step, a column's context menu deletes it;
  - click toggles a cell; drag paints;
  - playhead column highlight (M5.5);
  - `groups` follows the instance's `distGroupCount` (prop), and rows beyond it are shown disabled.
- [x] **M8.3 Manifest:**
  - `signatures: ["scalar"]`, output per M0.2.
  - Params: `steps` (primary, default 2 groups × 2 steps diagonal), `transition` 0–1 (Hard→Soft), `invert` (advanced).
  - Distribution: modes `order`, `linear`, `radial` (grouping on quantized spatial), scopes both, grouping **required**, default `{ mode:'order', grouping:{ kind:'everyN', n:2 } }`.
- [x] **M8.4 Plugin math:**
  ```
  k = floor(timePhase) mod steps; f = fract(timePhase)
  g = distGroup >= 0 ? distGroup mod groups : rank mod groups
  on = cell(k, g); next = cell((k+1) mod steps, g)
  v  = transition > 0 && f > 1 − transition ? lerp(on, next, smoothstep((f − (1 − transition)) / transition)) : on
  v  = invert ? 1 − v : v
  ```
  The speed is "per step" (UI label "per step").
- [x] **M8.5 Goldens + legacy mapping** (split/checkerboard/sections → order + grouping + grid; scatter → Noise *Random Pick*: create the replacement instance; flow → keep as free noise preset, documented).

  *Implemented* (`app/utils/plugins/legacy/sequencer-v1.ts`):
  - split → Blocks over a linear distribution whose middle is the split line (speed halved: two steps per former cycle);
  - sections → Alternate over 16 quantized cells;
  - checkerboard → Alternate over the order (a 2D checkerboard has no order equivalent);
  - scatter → Noise *Random Pick* (count = density × targeted fixtures);
  - flow → coherent hard Noise.

  Random sequences differ from the former ones.

### Phase M9 — Noise

Rewrite `plugins/noise` (alias and name **"Noise"** kept).

- [x] **M9.1 Manifest params:**

  | Key | Type | Range | Tier | Notes |
  |---|---|---|---|---|
  | `mode` | enum `level`/`pick` | | primary, segmented | |
  | `rangeMin` | number | 0–1 | hidden | bound to `history` editor |
  | `rangeMax` | number | 0–1 | hidden | bound to `history` editor |
  | `eventRate` | number | 0–1 | hidden | per second at tempo 1, bound to `history` editor |
  | `eventLength` | number | 0.02–1 | hidden | cycles, bound to `history` editor |
  | `eventDir` | enum `up`/`down` | | hidden | bound to `history` editor |
  | `coherence` | number | 0–1 | primary | label "Coherence", ends "Independent" / "Patches" |
  | `sync` | number | 0–1 | primary | "Sync", "Free" / "On beat" |
  | `hardness` | number | 0–1 | primary | "Hardness", "Soft" / "Hard" |
  | `count` | int | 1–64 | | `when mode=pick`, bound to `pick` editor |
  | `colorVariation` | number | 0–1 | advanced | |

  - Editors: `history` (`pm.noiseHistory`, `when mode=level`), `pick` (`pm.pickCount`, `when mode=pick`).
  - Distribution: modes `none`, `linear` (flow direction), `order`; scopes both; grouping false; default `none`.
- [x] **M9.2 Plugin math (level):**
  ```
  r  = ctx.timePhase                                  // steps per cycle = 1
  j  = hash01(s.seed) · (1 − sync)                    // per-sample time jitter
  k  = floor(r + j); f = fract(r + j)
  a  = hash01(s.seed, k); b = hash01(s.seed, k + 1)    // independent values
  w  = 1 − hardness                                   // blend window
  ind = f < 1 − w ? a : lerp(a, b, smoothstep((f − (1 − w)) / max(w, 1e-3)))
  coh = noise3(x·S, y·S, s.spatial·S − r) · 0.5 + 0.5 // S = mix(8, 0.6, coherence); spatial gives the flow direction (linear mode)
  v  = lerp(ind, coh, coherence)
  events: per sample slot e = floor(r / eventLength); if hash01(seed, e, 7) < eventRate · eventLength → pulse within the slot (attack 10 %, decay rest), v = eventDir up ? max(v, pulse) : v · (1 − pulse)
  v  = rangeMin + (rangeMax − rangeMin) · v
  colorVariation: decorrelate by channelSeed (as today)
  ```
- [x] **M9.3 Pick mode:**
  ```
  k = floor(timePhase); perm = seededPermutation(rankCount, seed ^ k); on = perm.indexOf(rank) < count
  ```
  with a soft crossfade by `hardness` like Pattern. Requires mode `order` (forced by the preset; the UI shows a hint otherwise).
- [x] **M9.4 `PmNoiseHistory.vue`** (composite):
  - 3 sample traces over 4 cycles, rendered with the preview pool on 3 virtual samples;
  - horizontal handles for `rangeMax` (top) and `rangeMin` (bottom), shaded band between;
  - event markers (small triangles up/down): drag horizontal spacing → `eventRate`, drag the marker width → `eventLength`, click a marker toggles `eventDir`;
  - double-click empty → toggle events on/off (rate 0 ↔ last).
- [x] **M9.5 `PmPickCount.vue`:** "N of M on" — a row of M dots (M = rank count) with a draggable divider setting N.
- [x] **M9.6 Goldens + legacy mapping:**

  *Implemented:*
  - Pick `count` 0 = a third of the fixtures (Random Pick works on any rig).
  - The coherent texture is stretched ×1.4 (Perlin values cluster around the middle) so Fire/Water use their range.
  - Goldens: TS reference for independent recipes, compiled-plugin snapshots plus property tests for coherent ones.
  - white → coherence 0, sync 0, hardness 1;
  - step → sync 1, hardness 1;
  - perlin → coherence 1, hardness 0, scale → S;
  - threshold → rangeMin/Max approximation;
  - fade → 1 − hardness.

### Phase M10 — Strength & blend polish

- [x] **M10.1** Strength in the tempo row (M5.6), shown as %.
- [x] **M10.2** Blend mode per card under "More". *Decided (owner): the Stacking select is removed; the card select keeps the established names (Add, Override, Mask, Brighten, Darken) and explanations.* Remove the category-wide "Stacking" select from `CategoryEffectsManager.vue`, or keep it as "Apply to all" — decide and document.

### Phase M11 — Docs & AI

- [x] **M11.1** Update `architecture/guides/authoring-content-plugins.md`:
  - ABI 1.1 fields;
  - new param types;
  - manifest fields (presets, editors, tiers, distribution);
  - curve shapes;
  - a link to the design principles.
- [x] **M11.2** `architecture/engine.md` (distribution, phase), `architecture/binary-protocol.md` (modifiers packet v2), `architecture.md` (map + glossary).
- [x] **M11.3** `bun run docs:ai`: verify that `index.json` lists the new param types, inputs and manifest fields.
- [x] **M11.4** Extend `NewModifierDialog.vue` with a "Design principles" link that opens the principles doc, and a template manifest containing the new fields.

### Phase M12 — Verification

- [x] **M12.1 Unit/integration:** all tests listed per task; parity TS ↔ Rust distribution table; migration round trips.
- [x] **M12.2 Browser matrix** (local Supabase stand-in as used for the last fixes, Playwright script in the scratchpad or a committed `scripts/qa/modifiers.ts`).
  - Rigs: (a) 8 PARs in a row, (b) 12 in a ring, (c) symmetric double row 2×6, (d) 4 LED bars à 16 px.
  - For every recipe of §3–§6, apply it and capture a canvas screenshot plus frame samples at 4 phases. Assert the described look with simple checks: number of lit fixtures, order of lighting, pairs equal on (c).
- [x] **M12.3 Interaction:**
  - drag every curve handle;
  - draw an order line on (c) and verify pairs;
  - click order;
  - drag palette stops on the canvas;
  - paint the steps grid;
  - undo/redo each as one step.
- [x] **M12.4** Full gate + zero-extension build.

  *Results (2026-10-10):*
  - **M12.1:** 387 Vitest tests and 30 Rust tests, including the TS ↔ Rust parity table and legacy/migration round trips.
  - **M12.2:** browser matrix against a local Supabase stand-in (Bun server emulating auth, `load-project` and change recording) and the production build, driven by Playwright from the session scratchpad. 4 rigs × 4 modifiers × all recipes, DMX sampled at 4 phases, with stage screenshots.
    - Confirmed: Chase order, Center Out / Outside-In symmetry, pairs equal on the double row, Build fill, Odd/Even, Left/Right, Blocks and Build-Up stepping, Random Pick lights a third, flash chains.
    - Found and fixed: recipe titles of twin recipes, Chain dots too narrow, Checker identical to Odd/Even (removed).
  - **M12.3:** 25/25 interaction checks.
    - All four curve handle kinds drag; an order line on the double row pairs fixtures; a click order follows the clicks; palette stops drag on the canvas; the step grid toggles and paints.
    - Each is one undo step, and redo works.
  - **M12.4:** typecheck has no new errors (50 pre-existing), tests, lint, `check:extensions`, `cargo test`, `build` and `check:zero-extensions` are green. Builds next to a running dev server use `PM_BUILD_DIR=.nuxt-qa`.

---

## 3. Built-in specifications

### 3.1 Curve shapes (registry)

All shapes have `peak` (lineY, top, default 1) and `floor` (lineY, bottom, default 0); `y = floor + (peak − floor) · core(x)`.

**Profile shapes** (`domain: signed`, x ∈ [−1, 1], periodic with period `1/repeat` unless noted)

| id | label | core(x) on one period, x' = fract(x·repeat) − 0.5 ∈ [−0.5, 0.5) | args (handle) |
|---|---|---|---|
| `dot` | Dot | `1 − smoothstep(w/2·(1−soft), w/2, |x'|)` where w = width | width (edgeX, snap ticks), softness (pointOnEdge), repeat (none; stepper) |
| `bar` | Bar | like dot but with softness default 0 | width, softness, repeat |
| `wave` | Wave | `0.5 + 0.5·cos(2π x')` | repeat |
| `wedge` | Wedge | `x' < 0 ? 0 : 1 − 2x'` ramp with tail (comet) | length (edgeX), repeat |
| `edge` | Edge (fill) | **non-periodic**: `1 − smoothstep(−soft/2, soft/2, x)` | softness (pointOnEdge) |
| `flash` | Flash | `x' ∈ [0, a] rise linear; then exp decay with time constant d` | attack (edgeX), decay (pointOnEdge), repeat |

**Motion shapes** (`domain: cycle`, x ∈ [0, 1] → position 0–1, not periodic)

| id | label | y(x) | args |
|---|---|---|---|
| `run` | Run | `x` | — |
| `pingpong` | Ping-pong | `1 − |2x − 1|` | — |
| `step` | Step | `floor(x·n)/n`, n = count or ticks if 0 | count (none; stepper, 0 = per fixture) |
| `hold` | Hold | `min(x / (1 − pause), 1)` | pause (edgeX) |
| `ease` | Ease | smoothstep with in/out weights | in (pointOnEdge), out (pointOnEdge) |

### 3.2 Wave recipes

Reference rigs: 8 PARs in a row, 12 in a ring, 4 LED bars. The tempo column is the beat value per pass.

| Recipe (UI) | profile | motion | tempo | distribution | when (auto-default) |
|---|---|---|---|---|---|
| **Chase** *(default)* | dot w 0.15 soft 0.5 floor 0 | run | 4 beats | order (auto line) | row, area |
| **Ping-Pong** | wedge length 0.3 | pingpong | 8 beats | order | — |
| **Center Out** | dot w 0.2 | run | 4 beats | order, line from center to one end, mirror | — |
| **Chain** | dot w 0.3 *(impl.: width is per period; 0.1 was narrower than the fixture spacing)* repeat 3 | run | 8 beats | order | — |
| ~~Every Other~~ | *removed in R1 (duplicate of Pattern Odd/Even)* | | | | |
| **Build** | edge soft 0.05 | hold pause 0.25 | 8 beats | order | — |
| **Breathe** | wave floor 0.2 | run | 4 beats | none | single |
| **Ring** | dot w 0.25 | run | 4 beats | radial (origin = centroid, end = radius) | ring |
| **Flash Chain** | flash attack 0.05 decay 0.3 | run *(impl.: step left the head dark for the whole step)* | 4 beats *(impl.)* | order | — |
| **Bar Chase** | dot w 0.25 | run | 2 beats | within, offset order | multiHead |

### 3.3 Noise recipes

| Recipe | mode | range | coherence | sync | hardness | events | tempo | distribution | when |
|---|---|---|---|---|---|---|---|---|---|
| **Candle** *(default)* | level | 0.6–1 | 0 | 0 | 0.2 | none | 1/8 | none | — |
| **Twinkle** | level | 0.1–0.15 | 0 | 0 | 0.8 | up, rate 0.15, len 0.08 | 1/4 | none | — |
| **Fire** | level | 0.3–1 | 0.8 | 0 | 0.1 | none | 1/4 | linear (↑) | — |
| **Faulty** | level | 1–1 | 0 | 0 | 1 | down, rate 0.05, len 0.2 | 1/8 | none | — |
| **Water** | level | 0.4–1 | 1 | 0 | 0 | none | 4 | linear | area |
| **Color Jitter** | level | 0.85–1 | 0 | 0 | 0.3 | none | 1/8 | none (colorVariation 1) | — |
| **Random Pick** | pick count = ⌈ranks/3⌉ | — | — | — | 1 | — | 1 | order | — |

### 3.4 Pattern recipes

| Recipe | grid (groups × steps) | grouping | transition | tempo/step | when |
|---|---|---|---|---|---|
| **Odd/Even** *(default)* | 2×2 diagonal | everyN 2 | 0 | 1 beat | row |
| **Left/Right** | 2×2 diagonal | sections 2 | 0 | 1 beat | — |
| **Blocks** | 4×4 diagonal | sections 4 | 0 | 1 beat | — |
| **Outside-In** | 3×3 diagonal | order mirror line (outside→center), sections 3 | 0 | 1 beat | — |
| **Build-Up** | 4×4 lower-triangular | sections 4 | 0 | 1 beat | — |
| ~~Checker~~ | *removed (browser matrix): identical to Odd/Even in every stored field; Odd/Even now also applies to areas* | | | | |
| **Segments** | 4×4 diagonal | within scope, sections 4 | 0 | 1/2 beat | multiHead |

### 3.5 Color Shift recipes

| Recipe | mode | palette / hue | profile, motion | tempo | distribution | when |
|---|---|---|---|---|---|---|
| **Drift** *(default)* | shift | shift 0, range 40° | wave, run | 8 beats | linear (selection axis) | hasColor |
| **Rainbow** | shift | shift 0, range 180° | wedge length 1 (saw), run | 8 beats | linear | — |
| **Two Colors** | palette | red, blue; transition 0 | —, step count 2 | 1 beat | none | !hasColor |
| **Spread Colors** | palette | magenta, cyan, yellow; transition 0 | —, motion flat (hold pause 1) | — | order, grouping everyN 3 | — |
| **Palette Run** | palette | 3 colors; transition 1 | —, run | 8 beats | linear | — |
| **White Accent** | shift | range 0; satDip 1 | flash, step count 0 | 1 beat | none | — |
| **Bar Gradient** | palette | 2 colors; transition 1 | —, run | 8 beats | within | multiHead |

---

## 4. UI reference (English labels)

```
┌ Wave · Chase ─────────────────────────────── ⋯ ☆ 🗑 ┐
│ [Chase][Ping-Pong][Center Out][Chain][Every Other][Build][Breathe][Ring][Flash Chain][Bar Chase] │
│ PROFILE   ▲ Peak ── ╱‾‾╲ ── ◀▶ Width  ● Softness  ▼ Floor                    │
│           ticks = fixtures · [Dot][Bar][Wave][Wedge][Edge][Flash][Free] · Repeat ◀1▶ │
│           ▓▓░░░░▓▓░░  (endless strip)                                         │
│ MOTION    ╱  [Run][Ping-pong][Step][Hold][Ease][Free]                          │
│ TEMPO     [♩ 1/4 1/2 1 2 4 8] per pass · Offset [0 ▾] · Strength 100 %         │
│ DISTRIBUTION  Scope [Across][Within] · Mode [All same][Linear][Radial][Conical][Order] │
│               Tool [☝ Click fixtures][✎ Draw line] · Snap ──●── · ⇄ Reverse · Grouping … │
│ CHANNELS  [Dimmer][…]                                                          │
│ ▸ More                                                                         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

The other modifiers follow the same frame; only the editors differ:
- **Noise:** History + Character
- **Pattern:** Steps grid + Transition
- **Color Shift:** Mode + Palette / Hue strip + Profile/Motion

---

## 5. Risks & open points

| Risk | Mitigation |
|---|---|
| **Packet size** with many curve params and large rank tables (u16 frame length, 64 KB) | Measure in M3.4. If needed, raise the frame length to u32 for `0x16` only, or send rank tables in a separate packet. |
| **LUT resolution** for signed profiles: 128 samples over [−1, 1] = 64 per unit | Hard edges blur by 1/64 of the distance. Acceptable for ≤ 32 ranks. Otherwise add an optional `curve` wire size of 256 for `domain:'signed'` (decide in M1.4). |
| **Behavioural change** of old projects | Legacy mappings (M6.4, M7.7, M8.5, M9.6) and the hash redirect (M6.5); document residual differences in A20. |
| **Selection-dependent defaults** change when the selection changes later | Only applied on add and on recipe click. Ranks for new fixtures resolve automatically (M3.2). |
| **Within scope** needs head positions inside bars | `headIndex/headCount` is enough for straight bars. Curved strips use head order. |

## 6. Task order & dependencies

```
M0 ─► M1 ─► M2 ─┐
      M3 ─► M4 ─┼─► M5 ─► M6 ─► M7 ─► M8 ─► M9 ─► M10 ─► M11 ─► M12
                └──────────────(M2, M4 are needed by M5)
```

M1 and M3 can run in parallel. M6–M9 are independent of each other once M5 is done, but M6 sets the pattern (do it first).
