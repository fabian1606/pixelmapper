import { registerLiveOp } from '~/stores/live-bus-store';
import { setActivePreset, pressFlashPreset, releaseFlashPreset } from '~/components/engine/composables/preset-activation';

interface PresetSetPayload { presetId: string | null; }

/**
 * Single op for "the active preset changed" — carries the new `selectedPresetId`
 * (or null for deactivation). Applied without re-broadcasting / re-persisting:
 * the originating client already did both.
 */
registerLiveOp<PresetSetPayload>('preset.set', {
  scope: 'shared',
  throttle: 'immediate',
  apply: ({ presetId }) => {
    setActivePreset(presetId, { broadcast: false, persist: false });
  },
});

interface FlashPressPayload { key: string; presetId: string; }
interface FlashReleasePayload { key: string; }

registerLiveOp<FlashPressPayload>('flash.press', {
  scope: 'shared',
  throttle: 'immediate',
  apply: ({ key, presetId }) => { pressFlashPreset(key, presetId); },
});

registerLiveOp<FlashReleasePayload>('flash.release', {
  scope: 'shared',
  throttle: 'immediate',
  apply: ({ key }) => { releaseFlashPreset(key); },
});
