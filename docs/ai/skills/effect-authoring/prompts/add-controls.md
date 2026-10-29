---
name: add-controls
description: Give an existing effect (modifier) in the connected Pixelmapper project performer controls — a live control page, and if needed better card params, recipes or canvas handles.
arguments:
  - name: modifierId
    description: Id of the modifier instance (see modifiers.list). Leave empty to pick the effect the user means from the stack.
    required: false
  - name: wishes
    description: Optional, what should be controllable, e.g. "a hit button for the flash and a speed fader".
    required: false
---
Add controls to an effect in the connected Pixelmapper project.

Modifier: {{modifierId}}
Wishes: {{wishes}}

Load the rules first: `describe { "id": "guide:effect-authoring/ui-rules.md" }` (which control for which intent, live page widgets and mappings), and `guide:effect-authoring/SKILL.md` for the workflow (sections *Changing an existing effect* and step 5).

Then:
1. `modifiers.list` → the instance (if no id was given, pick the one that matches the request and say which); `plugins.get` with its plugin hash → params (keys, types, ranges), recipes, `trigger` params, canvas hints. Check `live.listPages` for an existing page of this effect.
2. Decide the controls by intent (ui-rules.md): a `button` with an `effect-param` mapping for each `trigger` param; `slider`s with `effect-param` for the number/int/bool params a performer changes during a show; a `strength` slider for the level; `speed` only for time-mode effects. Points, colors, palettes and enums are not live-mappable — they stay on the card and canvas.
3. In **one** `apply` batch: `live.addPage` with your own `id` (or reuse the existing page), then `live.addWidget` per control with English labels, auto-placed in reading order (triggers first, big). Add `expect` entries that the widgets exist; treat any `mapping-ignored-by-widget` warning as an error and fix the widget type.
4. Only if the card itself lacks a control the user wants (e.g. no trigger param for a "hit"): change the plugin (edit source, bump version, `plugins.build`, replace the instance with the same id and settings in one batch), then add the widgets. Keep the card minimal — no redundant toggles.
5. Report the page, each widget and what it does, and that one Undo removes the change.
