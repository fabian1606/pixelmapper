import { triggerRef } from 'vue';
import { registerLiveOp } from '~/stores/live-bus-store';
import { cloneModifiers } from '~/utils/engine/modifiers';
import { migrateLegacyChanges, migrateModifiersDeep } from '~/utils/persistence/migrations/v3-distribution';

/**
 * Live preview of modifier param changes (during slider scrub or spatial drag).
 * Receiver applies changes directly to the modifier; final state is committed
 * via SerializableCommand `SetModifiers` on drag-end.
 */
interface ModifierUpdatePayload {
  effectId: string;
  /** Partial modifier instance — generic fields (origin, angle, strength, …). */
  changes: Record<string, any>;
  /** Partial `params` (merged into the instance's params). */
  paramChanges?: Record<string, any>;
}

registerLiveOp<ModifierUpdatePayload>('modifier.update', {
  scope: 'shared',
  throttle: 'raf',
  merge: 'replace',
  persistent: true,
  apply: ({ effectId, changes, paramChanges }, _userId, ctx) => {
    const modifier = ctx.engineStore.modifiers.find((m: any) => m.id === effectId);
    if (!modifier) return;
    // Scrubs persisted before schema 3 carry v2 direction fields (plan M3.8).
    Object.assign(modifier, migrateLegacyChanges(modifier.distribution, changes ?? {}));
    if (paramChanges) modifier.params = { ...modifier.params, ...paramChanges };
    ctx.engineStore.triggerCanvasSync();
  },
});

/**
 * Full modifier-list sync — sent when a structural change (split) happens locally so that
 * remote clients replace their list instead of applying an incremental patch. Unknown
 * plugin hashes are resolved by the engine store before rendering (plan P4.5).
 */
registerLiveOp<{ modifiers: any[] }>('modifier.sync', {
  scope: 'shared',
  throttle: 'raf',
  merge: 'replace',
  persistent: true,
  apply: ({ modifiers }, _userId, ctx) => {
    const active = ctx.engineStore.modifiers;
    active.splice(0, active.length, ...cloneModifiers(migrateModifiersDeep(modifiers ?? [])));
    ctx.engineStore.engine.modifiers = active;
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
