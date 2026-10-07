/**
 * `pan-tilt` — moving-head controls.
 *
 * - Replaces `pm.xyInput` with a 2D pad (property sidebar pan/tilt, live XY
 *   widgets, point params).
 * - Adds a movement-range editor to the position section when the selection
 *   contains a pan/tilt fixture (slot `properties/position:after`).
 */
import { defineExtension } from '@pixelmapper/extension-api';
import PanTiltPad from './components/PanTiltPad.vue';
import MovementRange from './components/MovementRange.vue';

export default defineExtension({
  id: 'pan-tilt',
  version: '1.0.0',
  apiVersion: '^1.0.0',
  displayName: 'Pan/Tilt',
  description: 'XY pad for every 2D input and a movement-range editor that limits where moving heads may point.',
  contributes: {
    replaces: [{ replaces: 'pm.xyInput', component: PanTiltPad }],
    slots: [
      {
        slot: 'properties/position:after',
        component: MovementRange,
        when: s => !!s.signature && s.signature.signature === 'panTilt',
      },
    ],
  },
});
