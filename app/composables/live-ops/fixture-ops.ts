import { triggerRef } from 'vue';
import { registerLiveOp } from '~/stores/live-bus-store';
import { fixtureDragKey } from './coalesce-keys';

interface FixtureDragPayload {
  fixtures: Array<{ id: string | number; x: number; y: number; z?: number }>;  // normalized 0-1
}

registerLiveOp<FixtureDragPayload>('fixture.drag', {
  scope: 'shared',
  throttle: 'raf',
  merge: 'replace',
  persistent: true,
  // Per dragged fixture set — dragging A then B keeps both positions (ADR 0004 D8).
  coalesceKey: fixtureDragKey,
  apply: ({ fixtures }, _userId, ctx) => {
    const flat = ctx.engineStore.flatFixtures;
    let mutated = false;
    for (const f of fixtures) {
      const target = flat.find(x => x.id === f.id);
      if (target) {
        target.fixturePosition.x = f.x;
        target.fixturePosition.y = f.y;
        if (f.z !== undefined) target.positionZ = f.z;
        mutated = true;
      }
    }
    if (mutated) {
      ctx.engineStore.triggerCanvasSync();
      triggerRef(ctx.engineStore.sceneNodes);
    }
  },
});

interface SelectionSetPayload {
  ids: (string | number)[];
}

registerLiveOp<SelectionSetPayload>('selection.set', {
  scope: 'per-user',
  throttle: 'immediate',
  merge: 'replace',
  apply: ({ ids }, userId, ctx) => {
    ctx.remoteSelections.set(userId, new Set(ids));
    ctx.triggerSelectionUpdate();
  },
});
