import { registerLiveOp } from '~/stores/live-bus-store';
import type { GlobalFunctionType, GlobalFunctionConfig } from '~/utils/live/types';

registerLiveOp<{ bpm: number }>('engine.bpm', {
  scope: 'shared',
  throttle: 'immediate',
  merge: 'replace',
  persistent: true,
  apply: ({ bpm }, _userId, ctx) => {
    if (!ctx.engineStore.engine) return;
    ctx.engineStore.engine.globalBpm.value = bpm;
    ctx.engineStore.engine.postBpm(bpm);
  },
});

registerLiveOp<{ key: string; type: GlobalFunctionType; config: GlobalFunctionConfig }>('overwrite.press', {
  scope: 'shared',
  throttle: 'immediate',
  persistent: false,
  apply: ({ key, type, config }, _userId, ctx) => {
    ctx.engineStore.pressOverwrite(key, type, config);
  },
});

registerLiveOp<{ key: string }>('overwrite.release', {
  scope: 'shared',
  throttle: 'immediate',
  persistent: false,
  apply: ({ key }, _userId, ctx) => {
    ctx.engineStore.releaseOverwrite(key);
  },
});

registerLiveOp<{ epochMs: number }>('engine.clock', {
  scope: 'shared',
  throttle: 'immediate',
  merge: 'replace',
  persistent: true,
  apply: ({ epochMs }, _userId, ctx) => {
    // Always converge to the earliest epoch — Date.now() is wall-clock, so the
    // earliest epoch belongs to whoever started their engine first.
    if (epochMs < ctx.engineStore.clockEpoch) {
      ctx.engineStore.setClockEpoch(epochMs);
    }
  },
});
