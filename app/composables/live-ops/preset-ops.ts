import { registerLiveOp } from '~/stores/live-bus-store';
import { applyPreset as _applyPreset, stopPreset as _stopPreset } from '~/components/engine/composables/preset-apply';
import { resolvePreset } from '~/components/engine/composables/preset-resolve';

interface PresetActivatePayload { presetId: string; }
interface PresetDeactivatePayload { presetId: string; }

registerLiveOp<PresetActivatePayload>('preset.activate', {
  scope: 'shared',
  throttle: 'immediate',
  apply: ({ presetId }, _userId, ctx) => {
    const presets = ctx.engineStore.savedPresets;
    const preset = presets.find((p: any) => p.id === presetId);
    if (!preset) return;
    const resolved = resolvePreset(preset, presets);
    _applyPreset(resolved, ctx.engineStore.flatFixtures, ctx.engineStore.activeEffects);
    ctx.engineStore.selectedPresetId = preset.id;
    ctx.engineStore.triggerCanvasSync();
  },
});

registerLiveOp<PresetDeactivatePayload>('preset.deactivate', {
  scope: 'shared',
  throttle: 'immediate',
  apply: ({ presetId }, _userId, ctx) => {
    const presets = ctx.engineStore.savedPresets;
    const preset = presets.find((p: any) => p.id === presetId);
    if (!preset) return;
    const resolved = resolvePreset(preset, presets);
    _stopPreset(resolved, ctx.engineStore.flatFixtures, ctx.engineStore.activeEffects);
    if (ctx.engineStore.selectedPresetId === presetId) {
      ctx.engineStore.selectedPresetId = null;
    }
    ctx.engineStore.triggerCanvasSync();
  },
});
