/**
 * `color-picker` — replaces the core `pm.colorInput` (RGB faders + hex) with
 * an HSV color wheel plus swatches. Because it replaces the input, it applies
 * everywhere colors are edited: property sidebar, live color widget and color
 * params of modifiers (ADR D13/D14).
 */
import { defineExtension } from '@pixelmapper/extension-api';
import ColorPicker from './components/ColorPicker.vue';

export default defineExtension({
  id: 'color-picker',
  version: '1.0.0',
  apiVersion: '^1.0.0',
  displayName: 'Color Picker',
  description: 'HSV color wheel with swatches for every color input (fixtures, live widgets, modifier params).',
  contributes: {
    replaces: [{ replaces: 'pm.colorInput', component: ColorPicker }],
  },
});
