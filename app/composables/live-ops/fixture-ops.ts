import { triggerRef } from 'vue';
import { registerLiveOp } from '~/stores/live-bus-store';

interface FixtureDragPayload {
  fixtures: Array<{ id: string | number; x: number; y: number }>;  // normalized 0-1
}

registerLiveOp<FixtureDragPayload>('fixture.drag', {
  scope: 'shared',
  throttle: 'raf',
  merge: 'replace',
  apply: ({ fixtures }, _userId, ctx) => {
    const flat = ctx.engineStore.flatFixtures;
    let mutated = false;
    for (const f of fixtures) {
      const target = flat.find(x => x.id === f.id);
      if (target) {
        target.fixturePosition.x = f.x;
        target.fixturePosition.y = f.y;
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
