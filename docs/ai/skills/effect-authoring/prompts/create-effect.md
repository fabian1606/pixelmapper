---
name: create-effect
description: Build a new lighting effect in the connected Pixelmapper project, with its controls (card params, canvas handles, recipes, live page), verified with observe.
arguments:
  - name: description
    description: The effect in your own words, e.g. "a wave radiating from the four corners, the points draggable".
    required: true
  - name: targets
    description: Optional fixtures or groups to use (names or ids); default = the fixtures that fit the effect.
    required: false
---
Create this lighting effect in the connected Pixelmapper project:

> {{description}}

Targets (optional): {{targets}}

Follow the Pixelmapper effect-authoring skill. Load it first with the `describe` tool:

1. `describe { "id": "guide:effect-authoring/SKILL.md" }` — the workflow (required).
2. While writing `render`: `guide:effect-authoring/patterns.md`. While writing params, recipes, canvas handles and the live page: `guide:effect-authoring/ui-rules.md`. For `expect` lists: `guide:effect-authoring/verification.md`. Exact SDK signatures: `guide:plugin-sdk`; manifest rules: `guide:plugin-authoring`.
3. Complete references: `plugins.get` for `@pixelmapper/corner-wave` and `@pixelmapper/mirror-runner`.

Then work through the workflow end to end:
- inspect the project (digest, targets, room box, pixel layout, stack, BPM);
- state the intended look, the controls and the expectations in a few lines;
- write manifest + `modifier.ts`, `plugins.build` in its own `apply` until it validates;
- add the effect **and** its controls in one `apply` batch (own ids for the modifier and the page);
- `observe` (preview, then live) with your expectations and fix what fails;
- report what changed, the controls, what was verified, your assumptions, and that one Undo reverts it.

Remember: `render` must be pure; distances to canvas points use world `s.x/s.y` with aspect 1, room layouts use `s.u/s.v` with `ctx.worldAspect`; all user-facing text in English.
