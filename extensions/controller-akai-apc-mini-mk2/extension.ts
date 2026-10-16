/**
 * `controller-akai-apc-mini-mk2` — the AKAI APC Mini mk2 as a hardware
 * controller (Web MIDI driver with RGB pad feedback) and its digital twin
 * layout for live mode (ADR §5.7). Catalog extension; included as a layer
 * until the runtime loader (P6.5/P6.6) installs it on demand.
 */
import { defineController, defineExtension } from '@pixelmapper/extension-api';
import layoutSvg from './layout.svg?raw';
import { controls, VIEW_BOX } from './layout-controls';
import { driverFactory } from './driver';

export default defineExtension({
  id: 'controller-akai-apc-mini-mk2',
  version: '1.1.0',
  apiVersion: '^1.1.0',
  displayName: 'AKAI APC Mini mk2',
  description: 'MIDI grid controller: 64 RGB pads, track/scene buttons and 9 faders, with LED feedback and a live-mode twin.',
  contributes: {
    controllers: [defineController({
      id: 'akai-apc-mini-mk2',
      label: 'AKAI APC Mini mk2',
      description: '8×8 RGB pad grid, 17 buttons and 9 faders over Web MIDI (sysex for pad colors).',
      vendor: 'AKAI',
      model: 'APC Mini mk2',
      matches: port => /APC mini mk2/i.test(port.name),
      createDriver: driverFactory,
      layoutSvg,
      viewBox: VIEW_BOX,
      defaultGridSize: { w: 20, h: 17 },
      controls,
    })],
  },
});
