import { registerLiveOp } from '~/stores/live-bus-store';

registerLiveOp<{ epochMs: number }>('engine.clock', {
  scope: 'shared',
  throttle: 'immediate',
  merge: 'replace',
  apply: ({ epochMs }, _userId, ctx) => {
    // Always converge to the earliest epoch — Date.now() is wall-clock, so the
    // earliest epoch belongs to whoever started their engine first.
    if (epochMs < ctx.engineStore.clockEpoch) {
      ctx.engineStore.setClockEpoch(epochMs);
    }
  },
});
