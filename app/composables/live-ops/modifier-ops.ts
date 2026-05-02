import { triggerRef } from 'vue';
import { registerLiveOp } from '~/stores/live-bus-store';
import { cloneEffectsList } from '~/components/engine/commands/set-modifiers-command';

/**
 * Live preview of modifier param changes (during slider scrub or spatial drag).
 * Receiver applies changes directly to the effect; final state is committed
 * via SerializableCommand `SetModifiers` on drag-end.
 */
interface ModifierUpdatePayload {
  effectId: string;
  changes: Record<string, any>;       // partial Effect — flat keys (origin x/y, angle, etc)
  sequencerChanges?: Record<string, any>;  // partial sequencerParams
}

registerLiveOp<ModifierUpdatePayload>('modifier.update', {
  scope: 'shared',
  throttle: 'raf',
  merge: 'replace',
  apply: ({ effectId, changes, sequencerChanges }, _userId, ctx) => {
    const effects = ctx.engineStore.activeEffects;
    const effect = effects.find((e: any) => e.id === effectId);
    if (!effect) return;
    Object.assign(effect, changes);
    if (sequencerChanges && (effect as any).sequencerParams) {
      Object.assign((effect as any).sequencerParams, sequencerChanges);
    }
    ctx.engineStore.triggerCanvasSync();
  },
});

/**
 * Full effects-list sync — sent when a structural change (split) happens locally so that
 * remote clients replace their effects list instead of applying an incremental patch.
 */
registerLiveOp<{ effects: any[] }>('modifier.sync', {
  scope: 'shared',
  throttle: 'raf',
  merge: 'replace',
  apply: ({ effects }, _userId, ctx) => {
    const reconstructed = cloneEffectsList(effects);
    const active = ctx.engineStore.activeEffects;
    active.splice(0, active.length, ...reconstructed);
    ctx.engineStore.engine.effects = active;
    ctx.engineStore.triggerCanvasSync();
  },
});

/**
 * Awareness: who is currently editing/highlighting which modifier in their sidebar.
 */
interface ModifierEditingPayload {
  effectId: string | null;
}

registerLiveOp<ModifierEditingPayload>('modifier.editing', {
  scope: 'per-user',
  throttle: 'immediate',
  merge: 'replace',
  apply: ({ effectId }, userId, ctx) => {
    ctx.remoteEditingModifier.set(userId, effectId);
    ctx.triggerEditingModifierUpdate();
  },
});
