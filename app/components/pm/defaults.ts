/**
 * Core default implementations of the `pm.*` inputs (ADR §5.4).
 *
 * Only the replacement resolver imports this map; core UI renders inputs via
 * `Replaceable` / `useReplaceable`, never by importing a default directly.
 */
import { markRaw, type Component } from 'vue';
import type { PmInputName } from '@pixelmapper/extension-api';
import PmFader from './PmFader.vue';
import PmNumberInput from './PmNumberInput.vue';
import PmColorInput from './PmColorInput.vue';
import PmXyInput from './PmXyInput.vue';
import PmSelect from './PmSelect.vue';
import PmToggle from './PmToggle.vue';
import PmCurve from './PmCurve.vue';
import PmAngle from './PmAngle.vue';
import PmTapTempo from './PmTapTempo.vue';
import PmButton from './PmButton.vue';
import PmGradient from './PmGradient.vue';
import PmHueRange from './PmHueRange.vue';
import PmSteps from './PmSteps.vue';

/** Default component per input name. */
export const PM_DEFAULTS: Readonly<Record<PmInputName, Component>> = {
  'pm.fader': markRaw(PmFader),
  'pm.numberInput': markRaw(PmNumberInput),
  'pm.colorInput': markRaw(PmColorInput),
  'pm.xyInput': markRaw(PmXyInput),
  'pm.select': markRaw(PmSelect),
  'pm.toggle': markRaw(PmToggle),
  'pm.curve': markRaw(PmCurve),
  'pm.angle': markRaw(PmAngle),
  'pm.tapTempo': markRaw(PmTapTempo),
  'pm.button': markRaw(PmButton),
  'pm.gradient': markRaw(PmGradient),
  'pm.hueRange': markRaw(PmHueRange),
  'pm.steps': markRaw(PmSteps),
};
