import type { Fixture } from '~/utils/engine/core/fixture';
import { openValuesFor } from '~/utils/engine/core/photometry';
import { createSnapshot, SetChannelValuesCommand, type SnapshotMap } from './set-channel-values-command';

/**
 * Builds a command that sets every fixture to full white: dimmer at 255,
 * shutter open, color wheel at its white/open slot, RGB/white faders at 255.
 * Returns null when none of the selected fixtures have anything to change.
 */
export function createHighlightCommand(fixtures: Fixture[]): SetChannelValuesCommand | null {
  const snapshots: SnapshotMap = new Map();

  for (const fixture of fixtures) {
    for (const { channel, value } of openValuesFor(fixture)) {
      const channelIndex = fixture.channels.indexOf(channel);
      if (channelIndex < 0) continue;
      if (channel.chaserConfig.stepValues.length === 1 && channel.chaserConfig.stepValues[0] === value) continue;

      const before = createSnapshot(channel);
      const after = {
        ...before,
        stepValues: [value],
        chaserConfig: { ...before.chaserConfig!, stepValues: [value], stepsCount: 1 },
      };
      snapshots.set({ fixture, channelIndex }, { before, after });
    }
  }

  return snapshots.size > 0 ? new SetChannelValuesCommand(snapshots, 'Highlight (Set to White)') : null;
}
