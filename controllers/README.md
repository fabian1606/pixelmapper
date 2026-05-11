# Controller Twins

This folder holds digital twin definitions for physical hardware controllers
(MIDI grids, fader banks, Stream Decks, etc.). Each subfolder is one controller
that can be placed on the live-mode canvas and optionally bound to a real
device for input + LED feedback.

Anyone can add a new controller by opening a PR with a new subfolder here.

## Folder layout

```
controllers/
  <vendor>-<model>/
    index.ts        — exports default ControllerDefinition
    layout.svg      — the visual rendered on the canvas
    driver.ts       — class extending BaseControllerDriver
    README.md       — optional notes
```

Naming: lowercase, hyphenated, vendor-prefixed (`akai-apc-mini-mk2`,
`novation-launchpad-mini-mk3`). The folder name becomes the controller `key`.

## SVG conventions

- Use a `viewBox` and no fixed `width`/`height` so the SVG scales with the
  twin's grid box.
- **Do not put `<style>` blocks inside `layout.svg`** — they leak globally.
  Style with attributes on individual elements instead.
- Element IDs are not strictly required since the manifest declares hit-area
  rects in viewBox coordinates, but stable IDs make debugging easier.

## Manifest

`index.ts` exports a `ControllerDefinition`. The `svg` field is a placeholder —
the catalog patches it with the raw contents of `layout.svg` at build time.

```ts
import type { ControllerDefinition } from '~/utils/controllers/types';
import { driverFactory } from './driver';

const definition: ControllerDefinition = {
  key: 'akai-apc-mini-mk2',
  label: 'AKAI APC Mini mk2',
  vendor: 'AKAI',
  model: 'APC Mini mk2',
  svg: '',                          // patched by the catalog
  viewBox: { w: 1000, h: 800 },
  defaultGridSize: { w: 16, h: 13 },
  controls: [
    { id: 'pad-0-0', type: 'button', rect: { x: 60, y: 540, w: 80, h: 80 } },
    // …
  ],
  driverFactory,
};

export default definition;
```

## Driver

`driver.ts` exports a `driverFactory: () => BaseControllerDriver`. The driver
handles connecting to the hardware (Web MIDI / WebHID / WebSerial), emits
`ControlInputEvent`s for incoming presses/values, and accepts `ControlFeedback`
calls to update LEDs.

Hardware handles (MIDI ports, etc.) must be plain class fields — never refs.
Wrapping them in Vue proxies breaks native event handler binding.

## Web MIDI gotchas

- HTTPS only (localhost is fine).
- `navigator.requestMIDIAccess` must be called from a user gesture, not on
  app boot.
- Use `{ sysex: true }` if the device needs sysex (e.g. APC Mini mk2 RGB).
- Subscribe to `MIDIAccess.onstatechange` to handle hot plug/unplug.

## Hot reload caveat

In dev, editing `driver.ts` reloads the module but the existing driver
instance in the controller-store still holds the old class. Disconnect and
reconnect the device in the UI after editing.
