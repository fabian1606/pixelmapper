import { useLiveBusStore } from '~/stores/live-bus-store';
import type { Fixture } from '~/utils/engine/core/fixture';

/**
 * Broadcast the current channel state of the given fixtures as a live op.
 * Call this immediately after mutating stepValues or colorValue locally.
 * Safe to call from user-event handlers — no echo-loop risk since remote
 * applies go through the live bus and never call this.
 */
export function dispatchChannelUpdate(fixtures: Fixture[]) {
  const liveBus = useLiveBusStore();
  if (!liveBus.isConnected) return;

  const channels: Array<{
    fixtureId: string | number;
    channelIndex: number;
    stepValues: number[];
    colorValue: string;
  }> = [];

  for (const fixture of fixtures) {
    fixture.channels.forEach((ch: any, idx: number) => {
      channels.push({
        fixtureId: fixture.id,
        channelIndex: idx,
        stepValues: [...ch.chaserConfig.stepValues],
        colorValue: ch.colorValue ?? '',
      });
    });
  }

  if (channels.length > 0) {
    liveBus.dispatch('channel.update', { channels });
  }
}
