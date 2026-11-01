import { registerLiveOp } from '~/stores/live-bus-store';
import type { GlobalFunctionType, GlobalFunctionConfig } from '~/utils/live/types';
import { stopAll } from './button-runtime';

registerLiveOp<{ bpm: number }>('engine.bpm', {
  scope: 'shared',
  throttle: 'immediate',
  merge: 'replace',
  persistent: true,
  apply: ({ bpm }, _userId, ctx) => {
    if (!ctx.engineStore.engine) return;
    ctx.engineStore.baseBpm = bpm;
  },
});

// Tap alignment from another client: nudge our beat grid onto the same tap.
registerLiveOp<{ tapMs: number }>('engine.beatAlign', {
  scope: 'shared',
  throttle: 'immediate',
  merge: 'append',
  apply: ({ tapMs }, _userId, ctx) => {
    ctx.engineStore.alignBeat(tapMs);
  },
});

registerLiveOp<{ multiplier: number }>('engine.speed', {
  scope: 'shared',
  throttle: 'immediate',
  merge: 'replace',
  persistent: true,
  apply: ({ multiplier }, _userId, ctx) => {
    ctx.engineStore.setSpeedMultiplier(multiplier);
  },
});

// Master dimmer fader: rig-wide intensity layer in the engine (see utils/engine/intensity.ts).
registerLiveOp<{ level: number }>('engine.master', {
  scope: 'shared',
  throttle: 'immediate',
  merge: 'replace',
  persistent: true,
  apply: ({ level }, _userId, ctx) => {
    ctx.engineStore.setMasterLevel(level);
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

// "Stop all" from a button in another tab: clear everything here too.
registerLiveOp<Record<string, never>>('engine.stopAll', {
  scope: 'shared',
  throttle: 'immediate',
  persistent: false,
  apply: () => {
    stopAll({ fromRemote: true });
  },
});
