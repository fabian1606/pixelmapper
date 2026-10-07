/**
 * `neopixel-strip` — parametric addressable LED strips as a fixture kind.
 *
 * Contributes the `neopixel-strip` kind: config → channels, pixel beams with
 * LED emitters, a polyline body and editable curve handles (ADR §5.6). All
 * edits go through the core `SetFixtureKindConfig` command, so the
 * extension needs no commands of its own. ESP connector code reads strips
 * by kind id (ADR D16).
 */
import { defineExtension } from '@pixelmapper/extension-api';
import { neopixelStripKind } from './kind';

export default defineExtension({
  id: 'neopixel-strip',
  version: '1.0.0',
  apiVersion: '^1.0.0',
  displayName: 'NeoPixel Strip',
  description: 'Addressable LED strips (WS2812B, SK6812, …) drawn as curves, lines or circles, with per-LED rendering and curve editing.',
  contributes: {
    fixtureKinds: [neopixelStripKind],
  },
});
