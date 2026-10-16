# Controller design sources

Design files (Affinity `.af`, exported SVG) of hardware controller twins.
They are **sources**, not code: the runtime controllers live in extensions
(ADR 0001 §5.7), e.g. `extensions/controller-akai-apc-mini-mk2`:

```
extensions/controller-<vendor>-<model>/
  extension.ts        — defineExtension({ contributes: { controllers: [defineController({...})] } })
  driver.ts           — class extending ControllerDriverBase (Web MIDI / HID / …)
  layout-controls.ts  — controls: id, type, hit rect (viewBox units), svgId
  layout.svg          — imported with `?raw` as `layoutSvg`
```

## SVG conventions

- Use a `viewBox` and no fixed `width`/`height` so the twin scales with its grid box.
- **No `<style>` blocks** in the layout SVG — they leak globally. Style with attributes.
- Give every control element a stable id and reference it as `svgId`. Sliders are a
  `<g>` containing a `<rect id^="range">` (track) and a `<g id^="knob">` (the moving part).

## Contents

- `akai-apc-mini-mk2.af` — source of `extensions/controller-akai-apc-mini-mk2/layout.svg`.
- `akai-apc-mini/` — AKAI APC Mini (mk1) layout and Stream Deck variants; no driver yet.
