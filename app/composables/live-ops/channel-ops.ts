import { registerLiveOp } from '~/stores/live-bus-store';
import { channelUpdateKey } from './coalesce-keys';

interface ChannelUpdateEntry {
  fixtureId: string | number;
  channelIndex: number;
  stepValues: number[];
  colorValue: string;
}

interface ChannelUpdatePayload {
  channels: ChannelUpdateEntry[];
}

registerLiveOp<ChannelUpdatePayload>('channel.update', {
  scope: 'shared',
  throttle: 'raf',
  merge: 'replace',
  persistent: true,
  // Per (fixture, channel) set — edits on different channels never collapse (ADR 0004 D8).
  coalesceKey: channelUpdateKey,
  apply: ({ channels }, _userId, ctx) => {
    const fixtures = ctx.engineStore.flatFixtures;
    for (const entry of channels) {
      const fixture = fixtures.find((f: any) => f.id === entry.fixtureId);
      if (!fixture) continue;
      const channel = fixture.channels[entry.channelIndex];
      if (!channel) continue;
      channel.chaserConfig.stepValues = [...entry.stepValues];
      channel.colorValue = entry.colorValue;
    }
    ctx.engineStore.triggerCanvasSync();
  },
});
