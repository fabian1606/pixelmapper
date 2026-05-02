import { registerLiveOp } from '~/stores/live-bus-store';

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
