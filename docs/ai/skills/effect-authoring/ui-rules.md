# UI rules for effects

Controls are **declared**, never coded: params in the manifest (the host renders the card), recipes, canvas handles, and a live page built with `live.*` operations. The host renders all of them consistently. These rules apply the [modifier design principles](../../../../architecture/guides/modifier-design-principles.md) (`guide:modifier-design`) to generated effects.

## The card in one sentence each

Every param must pass this test: *"<Label> changes <what the user sees>."* If you cannot write that line, drop the param or merge it with another. Aim for **3–6 primary params**. No redundant toggles: an "Enable mirror" bool next to a "Mirror" enum with an "Off" option is one control too many; a "Reverse" bool is fine when there is no distribution reverse (plugins with `"modes": ["none"]`).

## Param type per intent

| Intent | Type | Notes |
|---|---|---|
| amount, size, length, spacing | `number` with `min`, `max`, `step`, `default` (+ `unit` only when it helps) | ranges a user actually needs, not the math's domain; fractions of the stage or tube rather than raw units |
| count (points, segments, repeats) | `int` | small ranges (1–4, 1–8) |
| direction of rotation / angle | `angle` (radians, dial) | only for true angles; "which way it runs" is usually `enum` or `bool` |
| one color | `color` | for collision / accent colors |
| several colors | `gradient` (1–8 stops) | palettes; sample with `sampleGradient(p.lut(slot), u, transition, c)` |
| a shape over time or space | `curve` (`domain`, `shapes`) | reuse built-in shapes (`dot`, `wedge`, `ease`, …) instead of inventing params |
| a few distinct kinds | `enum` with `optionLabels` | ≤ 3 options render as a segmented control; options that lie on a spectrum should be a `number` instead |
| on/off | `bool` | only for a genuinely binary choice |
| a place in the room | `point` + `"ui": { "canvas": "point" }` | dragged on the canvas; see below |
| a size around a place | `number` + `"ui": { "canvas": "radius", "anchor": "<pointKey>" }` | a ring on the canvas; radius in world units (1 = stage width), `min` ≥ 0 |
| a momentary action (hit, hold, flash) | `trigger` (default `{ "pressed": false }`, optional `multiClickMs`) | card button + live button; read with `triggerPressed` etc. |
| tempo | **none** — the host's speed (beats or seconds per cycle) | declare `speedUnit` ("per front", "per round trip") so the speed reads correctly |
| strength, blend, spread, targets | **none** — host-owned | never re-implement them as params |

## Naming and units

- Labels: 1–2 words, sentence case ("Tail", "Collision color", "Points"), named by **what is seen**: *Spacing*, *Width*, *Softness*, *Tail*, *Reach*, *Mirror*, *Direction* — never *wavelength*, *sigma*, *duty*, *aspect*.
- `description` on every non-obvious param: one sentence, what changes on stage.
- Units: express sizes as fractions (of the stage width, of the tube, of the spacing) and say so in the description; add `unit` only for real units (`°`, `ms`, `Hz`, `%`).
- Keys: camelCase, stable (live widgets and recipes reference them).
- Enum options: camelCase values, human `optionLabels` ("Left/Right", "Front/Back", "Off").
- Manifest `name`: a look, not an algorithm ("Corner Wave", "Mirror Runner"). `purpose`: one sentence for the Add menu. `description`: behavior + every param, ≥ 10 characters (humans and AI read it).

## Defaults that look good immediately

- A fresh instance must show a clear, pleasing result on the targets — **contrast** (lit against dark), readable motion, about one event per bar.
- Size defaults relative to a typical rig: spacing 0.2–0.3 of the stage, width ~40 % of the spacing, softness 0.5–0.7, tails 0.3 of a tube.
- Colors: two saturated, contrasting hues for palettes (cyan/magenta, white/amber, blue/teal); collision accents white.
- Canvas points: defaults are static world coordinates, so **set them on add** to the targets' room box (from the digest, inset ~5 %) via `modifiers.add` `params`. Recipes keep dragged points unless they name them, so recipes should normally *not* set points.
- Speed: set it in every recipe (manifest form: `"speed": { "mode": "beat", "beatValue": 4 }` or `{ "mode": "time", "timeMs": 2000 }`) and again in `modifiers.add` if the user asked for a tempo (operation form: `"speed": { "mode": "beat", "value": 4 }`, time mode `value` in seconds).

## Tiers, `when`, groups

- `tier: "primary"` (default) for everything a recipe changes visibly or a documented look needs.
- `tier: "advanced"` ("More") for rare refinements **and for the card fields of canvas-handled points**: the canvas handle is the primary representation; the X/Y faders would only duplicate it. Handles still show for `advanced` params; only `hidden` hides them.
- `tier: "hidden"` for params set only by recipes or composite `editors`.
- `when` hides params (and their canvas handles) that do not apply: `{ "sources": [2, 3, 4] }`, `{ "mode": "palette" }`, `{ "distribution.mode": ["order"] }`.
- `group` (section title) only from ~8 params on; most effects need none.

## Canvas handles

- `point` params with `"ui": { "canvas": "point", "label": "A", "color": "#ff8800" }` — one draggable dot each; labels ≤ 24 chars (short letters work best), `color` optional.
- `number` with `"ui": { "canvas": "radius", "anchor": "a" }` — a ring around point `a`; the anchor must itself have `canvas: "point"`.
- Values are world coordinates, like `Sample.x/y`: measure with `dist2(s.x, s.y, px, py, 1.0)`. Never compare them with `u/v`.
- Use handles for every "where" and "how big around where". Use the host's distribution handle (spread `spatial`) instead when one origin/direction is enough — don't duplicate it with own points.
- No `line` hint exists: express lines through two points or the room center.

## Recipes (`presets`)

- **2–4 recipes**, each a complete, distinct look: params + `speed` + `distribution` + `strength`. Exactly one `"default": true`.
- Differ in character (soft rolling vs. sharp fast vs. dense ripple), never only in direction (the user drags that) and never only in color.
- Labels are look names ("Corners", "Implode", "Ripple", "Comet", "Spark"); `description` one sentence.
- Use `when` (`{ "kind": ["row"] }`, `{ "multiHead": true }`, `{ "hasColor": true }`) when a recipe only fits some rigs, so the host picks a fitting one on add.
- In `modifiers.add` name the recipe that matches the request (`"recipe": "implode"`), then override only what the user asked for.

## Composite `editors[]`

Use an `editors` entry when several params are one concept in the user's mind (hue center + range → `pm.hueRange`). Bind the params (`"bind": { "shift": "hueShift", "range": "hueRange" }`), mark them `tier: "hidden"`. Do not invent editor ids: only core inputs (`pm.hueRange`, `pm.noiseHistory`, single-param inputs) or ones an installed extension contributes.

## Live page

Build a page when the user will **perform** the effect (a show, "controls", "buttons", "live") or asks for one; skip it for a pure look. One page per effect, named after the effect.

| Control | Widget | Mapping |
|---|---|---|
| momentary action (`trigger` param) | `button` | `effect-param` → the trigger key (press / release / multi-click reach the effect) |
| amount (`number`/`int`) | `slider` | `effect-param` → the param key (`"spacing"` or `"params.spacing"`; 0–1 maps onto min–max) |
| on/off (`bool`) | `button` | `effect-param` → the key, `behavior: "latch"` (toggle, default) or `"hold"` (on while held) |
| a position (`point` param) | `xy` pad | `effect-param` → the point key (pad x/y 0–1 → the point's x/y); keep the canvas handle too |
| overall level | `slider` | `effect-param` → `strength` |
| tempo | `slider` for time-mode effects; for beat-synced effects the project BPM (a `beat` widget shows / taps it) | slider: `effect-param` → `speed` (sets the time-mode cycle ≈ 0.1–5 s; no effect on a beat-mode instance). `beat`: no mapping |
| global blackout / strobe / blinder | `button` | `{ "type": "global-function", "function": "blackout" }` (`strobe`, `blind`; optional `config`) |
| context | `label`, `fixture-preview` | none (`color`, `label`, `beat`, `fixture-preview` ignore mappings) |

- **What no live control drives:** `effect-param` cannot drive `color`, `gradient`, `enum` or `curve` params. Colors/palettes and enums live on the card and in recipes. Points are dragged on the canvas; add an `xy` pad only when a performer needs to move a point live. If a performer must switch looks live, use recipes on the card or two instances with sliders on `strength`.
- Layout: let `live.addWidget` auto-place (omit `gridX`/`gridY`); add widgets in reading order — triggers first (big buttons: `gridW`/`gridH` 6×6), then sliders, then labels. Give every widget a `label` (English, 1–2 words) and buttons a `color` hinting the effect.
- Add the page in the **same `apply` batch** as the modifier, with your own ids (`modifiers.add` `id`, `live.addPage` `id`), so one undo removes everything. A widget: `live.addWidget { "pageId", "type", "label", "color": "#rrggbb", "gridW", "gridH", "mapping": { "type": "effect-param", "modifierId", "paramKey", "behavior"? } }`.
- `live.addWidget` warns (`mapping-ignored-by-widget`) when the widget cannot drive the mapping — treat that warning as an error and fix the widget type.

## Custom panel (`ui.ts`) — last resort

Only when no declarative control can show the concept (e.g. a waveform you draw, a step grid beyond `steps`). It is a sandboxed iframe without imports or network; use `api.setParam`, `beginScrub`/`endScrub`, `onParams`. Never use it for things the canvas, a param input or a recipe can do.

## Language

All labels, recipe names, descriptions, widget labels and page names in **English**, even when the user writes in another language.
