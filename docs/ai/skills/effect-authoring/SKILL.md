---
name: pixelmapper-effects
description: Create or modify lighting effects in Pixelmapper — spatial modifier plugins (waves, runners, chases, collisions, trigger flashes) including their controls (card params, draggable canvas handles, recipes, live control page). Use whenever the user asks for a new light effect, look or animation in Pixelmapper, wants an existing effect changed, or wants controls / a live page for an effect.
---

# Pixelmapper effect authoring

You build an effect as a **modifier plugin** (AssemblyScript `modifier.ts` + `manifest.json`), add it to the project, prove it does what was asked, and ship the **controls** with it. The result must look good immediately, be adjustable the way a lighting designer thinks, and be undoable in one step.

**Tools.** Over MCP you have `inspect`, `operations`, `describe`, `apply`, `observe` (plus `pixelmapper_status` for the connection). They come from the MCP server registered as `pixelmapper` (the `pixelmapper-mcp` CLI; in Claude Code they show up as `mcp__pixelmapper__inspect` etc.) and run inside the open app. Query operations (`project.digest`, `*.list`, `*.get`, `fixtures.find`) run through `inspect { "selector": { "op": …, "input": … } }`; mutations and `plugins.build` through `apply`; `describe { "id": "<op id>" }` gives any operation's input schema and a ready-to-copy call. Every op inside `apply` is an entry `{ "op": "<op id>", "input": { …that op's input… } }`: the op's keys go **inside** `input`, e.g. `apply { "label": "Move", "ops": [{ "op": "fixtures.move", "input": { "moves": [{ "fixtureId": "fx-1", "x": 0.25, "y": 0.5 }] } }] }`. To place many fixtures (rows, lines, circles) use one `fixtures.arrange` op instead of computing positions. In Claude Code the repo additionally gives you `architecture/guides/*`, `docs/ai/plugin-sdk.d.ts` and the built-in plugins under `plugins/`. Without a connected app you can still write and test a plugin in the repo (see *Repo-only mode*).

**Reference files** (read on demand; over MCP: `describe { "id": "<topic id>" }`; `describe { "id": "guide:" }` lists all topics):

| File | Topic id | Read when |
|---|---|---|
| [patterns.md](patterns.md) | `guide:effect-authoring/patterns` | writing `render` — recipes for distance fields, runners, mirror, contour loops, collisions, triggers, beat sync |
| [ui-rules.md](ui-rules.md) | `guide:effect-authoring/ui-rules` | writing `params`, `presets`, canvas handles, the live page |
| [verification.md](verification.md) | `guide:effect-authoring/verification` | writing `expect` lists and reacting to failed expectations |
| [examples/](examples/README.md) | `guide:effect-authoring/examples/README`; code via `plugins.get` `@pixelmapper/corner-wave`, `@pixelmapper/mirror-runner` | you want a complete, tested reference |
| plugin authoring guide | `guide:plugin-authoring` | manifest fields, param types, validation rules |
| modifier design principles | `guide:modifier-design` | any doubt about controls |
| SDK declarations | `guide:plugin-sdk` | exact helper signatures |

## Non-negotiables

1. **`render` is pure.** Same `(ctx, sample, params)` → same output. No state across frames, no per-sample allocation. Events (collisions, overtakes, trigger presses) are computed from time. Validation rejects violations.
2. **Coordinates.** `Sample.x/y`, `point` params and canvas handles share the **world** space (0–1, one unit on both axes): distances to a handle point are `dist2(s.x, s.y, px, py, 1.0)`. **Never** measure handle points with `u/v`. `Sample.u/v` are **room** coordinates (the rig's bounding box stretched to 0–1 per axis) for room-relative layouts ("corners of the room", mirror line at the room center); distances in room space use `dist2(s.u, s.v, cu, cv, ctx.worldAspect)`. Declare `"apiVersion": "^1.3.0"` when you read `u`, `v`, `z`, `worldAspect` or trigger params.
3. **Output ranges.** `scale` and `absolute`: [0, 1]; `bipolar`: [−2, 2]. No NaN (guard divisions). Write exactly `ctx.arity` values.
4. **Controls are declarative.** Manifest params, recipes, canvas hints, a live page. Never Vue code; a `ui.ts` panel only as last resort ([ui-rules.md](ui-rules.md)).
5. **English** for every user-facing string, whatever language the request was in.
6. **One undo.** The effect and its controls go into the project in one `apply` batch.

## Workflow

### 1. Inspect the project

```json
inspect { "selector": "project" }                       // = project.digest: bpm, fixtures (id, name, kind, x/y/z, rotation, orientation, heads, signatures, groupIds), groups, modifiers, live pages
inspect { "selector": { "op": "fixtures.find", "input": { "signature": "rgb" } } }
inspect { "selector": { "op": "plugins.list", "input": {} } }
```

Derive and write down:
- **Targets**: which fixtures/groups (by kind, name, group). Color effects need `rgb`; dimmer-like effects `scalar`.
- **Room box**: the engine's room box (what `Sample.u/v` span) is the bounding box of **every head of every fixture in the layout**, not only the targets. The digest's `x`/`y` are fixture positions (a tube's center), so for tubes take the head world positions from `fixtures.get` (`detail.heads[i].x/y`, same space as `Sample.x/y`, rotation already applied): room box = min/max over every head of every fixture. Corners, center and the mirror line come from it. Inset corner points ~5 % so the handles are grabbable.
- **Pixel layout**: `heads` > 1 means tubes/bars with pixels (`Sample.headIndex` 0..headCount−1 along the fixture); `fixtures.get` lists `detail.heads` (head index = patch order, with world x/y). `detail.beams` are local offsets in fixture footprints before rotation; you rarely need them. Single-head fixtures make a point cloud.
- **Orientation**: every multi-head fixture in the digest / `fixtures.find` / `fixtures.get` carries `orientation { runs, axis { dx, dy }, firstHead, lastHead }`, measured from the real head positions — `runs: "top→bottom"` means head 0 is at the top. `rotation` is clockwise degrees on the canvas (y down): a bar with heads along its own x axis runs left→right at 0°, top→bottom at 90°, right→left at 180°, bottom→top at 270°. Don't guess from `rotation`; read `orientation.runs`. To line bars up with an edge use `fixtures.rotate` with `alignTo: "x"` (horizontal edge) or `"y"` (vertical edge), `direction: "reverse"` to flip head 0.
- **Look at it**: if the `screenshot` tool is available, call it (default `view: "layout"`) to see the stage — footprints, head dots with head 0 ringed and an arrow toward the last head, current colors. Use it after layout/rotation changes and when the user asks how something looks; never draw ASCII maps. It does not replace `observe` for animation.
- **Order / contour**: for loops around the room, the order of fixtures along the outline (see patterns.md *Path along ranks*).
- **Existing stack**: an `override` layer on top hides what is below; place the effect accordingly (`index`).
- **BPM**, for beat-synced speeds.

If something essential is ambiguous (which fixtures? beat-synced or free?), choose the most plausible reading, say so in the report, and keep it adjustable.

### 2. State intent and expectations

Before coding, write 2–5 lines: the look in stage terms ("cyan fronts roll from the four corners to the center, one front per bar"), the controls the user will get, and the `observe` expectations that prove it (pick from [verification.md](verification.md)). This keeps the code honest.

### 3. Write manifest + modifier.ts

- Start from the closest reference: `inspect { "selector": { "op": "plugins.get", "input": { "plugin": "@pixelmapper/corner-wave" } } }` (spatial points, palette) or `@pixelmapper/mirror-runner` (pixels along tubes, mirror) or a built-in (`waveform`, `noise`, `sequencer`, `colorAdjust`). Their manifests are complete, validated and golden-tested.
- Use the SDK pattern helpers instead of re-deriving math ([patterns.md](patterns.md)).
- Params, labels, ranges, defaults, recipes, canvas handles: follow [ui-rules.md](ui-rules.md).
- Alias `@ai/<kebab-name>` unless the user names a scope; bump `version` when you rebuild a changed plugin (the highest version wins when you reference it by alias).
- AssemblyScript pitfalls: annotate float locals (`const f: f32 = …`; a literal like `1.0 - x` can infer `f64` and fail with *AS200*), use `Mathf`, no closures / `any` / union types, cast ints (`<f32>s.headIndex`). Param slots: `color` 3, `point` 2, `gradient` 33, `curve` 128, `steps` 18, `trigger` 4, others 1 — `i` in `p.get(i)` is the slot index, not the param index.

### 4. Build until it validates

```json
apply { "label": "Build Corner Wave", "ops": [{ "op": "plugins.build", "input": { "manifest": { … }, "source": "…modifier.ts…" } }] }
```

Read the build result (`results[0].value` of the apply result; `expect` paths address op values directly as `results.0.…`): `ok`, `hash`, `diagnostics` (stage `manifest` | `compile` | `validate` with messages), `validation.metrics` (`medianFrameMs`, `outputMin`, `outputMax`). Fix and rebuild until `ok: true` with no error diagnostics. Build **alone** in its own `apply` (an error finding rolls back the whole batch; `plugins.build` is an action outside history, so it never costs an undo step; it is also skipped in a `dryRun`). Note the `hash`.

Common validation failures: output out of range (clamp; check `scale` vs `absolute`), NaN (division by a param that can be 0), "state across frames" (you stored something in `render`), budget (loops per sample; precompute in `prepare`).

Optionally preview before adding: `observe { "mode": "preview", "plugin": { "ref": "<hash>", "params": { … } }, "targets": { "groupIds": [ … ] }, "window": { "duration": "4s" }, "expect": [ … ] }`. Such a bare preview uses the manifest defaults (no recipe, speed 1 beat per cycle, blend `add`); the real check is step 6 on the added instance.

### 5. Add the effect and its controls — one batch

Choose ids yourself (`id` on `modifiers.add` and `live.addPage`) so the widgets in the same batch can reference them:

```json
apply {
  "label": "Corner wave with controls",
  "ops": [
    { "op": "modifiers.add", "input": {
        "plugin": "sha256:…", "id": "ai-corner-wave", "recipe": "corners",
        "targets": { "groupIds": ["g-tubes"] },
        "params": { "a": { "x": 0.12, "y": 0.18 }, "b": { "x": 0.88, "y": 0.18 }, "c": { "x": 0.88, "y": 0.82 }, "d": { "x": 0.12, "y": 0.82 } },
        "speed": { "mode": "beat", "value": 4 } } },
    { "op": "live.addPage", "input": { "name": "Corner Wave", "id": "ai-corner-wave-page" } },
    { "op": "live.addWidget", "input": { "pageId": "ai-corner-wave-page", "type": "slider", "label": "Spacing",
        "mapping": { "type": "effect-param", "modifierId": "ai-corner-wave", "paramKey": "spacing" } } },
    { "op": "live.addWidget", "input": { "pageId": "ai-corner-wave-page", "type": "slider", "label": "Level",
        "mapping": { "type": "effect-param", "modifierId": "ai-corner-wave", "paramKey": "strength" } } }
  ],
  "expect": [
    { "path": "state.modifiers.*.id", "quantifier": "any", "eq": "ai-corner-wave" },
    { "path": "results.3.widgetId", "exists": true }
  ]
}
```

- `spread`: `same` | `spatial` (linear/radial/conical handle) | `order` (fixture by fixture, `ranks` or `fixtureOrder`) | `within` (over the pixels of each fixture). Offer only what the plugin's `distribution.modes` declares; plugins with their own geometry (points, room coordinates) declare `"modes": ["none"]`.
- Direction: `spatial` and `order` run **left→right along x** by default (fixtures sharing an x move together; top→bottom when all targets share one x). Pick another with `direction: "right-to-left" | "top-to-bottom" | "bottom-to-top"`, exact `origin`/`end`, or `fixtureOrder`; `reverse` flips.
- Color of scalar effects: Waveform / Noise / Sequencer dim the DIMMER, so the color you see is the fixtures' base color. A colored chase or pulse is one op: `{ "plugin": "waveform", "recipe": "chase", "color": "#0000ff" }` (sets the base color, raises a zero dimmer to full, same undo step). A layer that would stay dark gets a `dark-base` warning with the fix.
- `speed`: `{ "mode": "beat", "value": beats per cycle }` or `{ "mode": "time", "value": seconds per cycle }`. Choose musically: 1 = every beat, 4 = one bar.
- `blend`: `absolute` plugins default to `override`; modulators (`scale`/`bipolar`) to `add`. A `scale` runner over other layers usually wants `multiply` (Mask); trigger blinders want `absolute` output with `s.base0..2` pass-through (ui-rules *Output and blend*).
- Use `dryRun: true` first when the batch is large; it returns the same diff and findings and changes nothing.
- Live page rules (which widgets, layout): [ui-rules.md](ui-rules.md) *Live page*. Skip the page when the user only wants the card.

### 6. Observe against your expectations

```json
observe { "mode": "preview", "modifierId": "ai-corner-wave", "targets": { "groupIds": ["g-tubes"] }, "window": { "duration": "8 beats" },
          "expect": [ { "path": "group.temporal.kind", "eq": "periodic" }, { "path": "group.radial.r", "gte": 0.7 },
                      { "path": "fixtures.*.range.max", "gt": 0.2 }, { "path": "group.issues", "oneOf": [[], ["clamped"]] } ] }
```

`preview` renders the instance headlessly through the real engine core on the real fixture positions (deterministic, fast, only this layer); `live` captures what the app really outputs (use it last, it includes the rest of the stack and overrides; per fixture, first head only). Trigger effects: see *Triggers* in verification.md — a preview can freeze a time-free pressed/released state; to press a button live, use `modifiers.trigger` (press / release / click, no undo step, returns the engine-clock time) and then a live `observe`. Never write trigger timestamps with `modifiers.update`. Read the text report, not only pass/fail. On a failure, follow the reaction table in [verification.md](verification.md) — fix params with `modifiers.update`, or fix the code, rebuild, and swap the plugin (`modifiers.remove` + `modifiers.add` with the new hash, same `id`, in one batch). Never stop at a failing expectation without saying so.

### 7. Report

Tell the user, briefly:
- what the effect does (stage terms) and on which fixtures;
- the controls: card params (what each does), canvas handles (what to drag), recipes, the live page and its widgets;
- what `observe` confirmed (and anything it could not);
- assumptions you made;
- **"One Undo reverts the whole change."** (The plugin build stays registered on this device; it is harmless and content-addressed.)

## Changing an existing effect

1. `inspect { "selector": { "op": "modifiers.list", "input": {} } }` → find the instance, its plugin hash, params, spread, speed.
2. `plugins.get { "plugin": "<hash>" }` (via `inspect`) → manifest + source.
3. Param-only change: `modifiers.update` (params merge by key) or `modifiers.applyRecipe`.
4. Behavior change: edit source, bump `version`, `plugins.build`, then in one batch `modifiers.remove` the old instance and `modifiers.add` the new hash with the same `id`, params, spread, speed, targets, then re-add the live widgets if you removed the page (widgets map by modifier id; `live.listPages` shows them — keeping the same `id` keeps them working).
5. Observe again; report.

## Repo-only mode (Claude Code, no app connected)

Put the plugin in `plugins/<name>/` (`manifest.json`, `modifier.ts`, `package.json`, optional `goldens.gen.ts` + `goldens.json`), add it to `PLUGINS` in `plugins/goldens.test.ts`, and run `bunx vitest run plugins/goldens.test.ts` (builds and runs the validation harness) and `bun run build:plugins`. Plugins there become built-ins. Do this only when the user wants a built-in; otherwise deliver manifest + source for `plugins.build`.
