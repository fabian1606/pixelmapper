import type { Command } from '../composables/use-history';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Channel } from '~/utils/engine/core/channel';
import { type SerializableCommand, registerCommand } from './serializable-command';
import { reactive } from 'vue';

export interface ChannelSnapshot {
  stepValues: number[];
  colorValue: string;
  chaserConfig?: import('~/utils/engine/types').ChannelChaserConfig;
  // Future: effects?: Effect[]
}

export interface ChannelRef {
  fixture: Fixture;
  channelIndex: number;
}

export type SnapshotMap = Map<ChannelRef, { before: ChannelSnapshot; after: ChannelSnapshot }>;

/**
 * Captures the exact state of specific fields to ensure deep copy
 */
export function createSnapshot(channel: Channel): ChannelSnapshot {
  return {
    stepValues: [...channel.chaserConfig.stepValues],
    colorValue: channel.colorValue,
    // Snapshot the full chaserConfig (includes stepValues, timing, etc.)
    chaserConfig: JSON.parse(JSON.stringify(channel.chaserConfig))
  };
}

/**
 * Generic undo/redo command for setting properties on any number of channels across any number of fixtures.
 * Because channel changes can be sweeping (multi-select, drag-to-set), this command takes deeply-cloned
 * snapshots of exactly what changed, and wholesale replaces the channel state on undo/redo.
 */
export class SetChannelValuesCommand implements SerializableCommand {
  readonly commandType = 'SetChannelValues';

  constructor(
    private snapshots: SnapshotMap,
    public description: string = 'Change Values'
  ) { }

  toPayload() {
    const changes: Array<{
      fixtureId: string | number;
      channelIndex: number;
      before: ChannelSnapshot;
      after: ChannelSnapshot;
    }> = [];
    for (const [ref, state] of this.snapshots.entries()) {
      changes.push({
        fixtureId: ref.fixture.id,
        channelIndex: ref.channelIndex,
        before: state.before,
        after: state.after,
      });
    }
    return { changes };
  }

  execute() {
    for (const [ref, state] of this.snapshots.entries()) {
      const channel = ref.fixture.channels[ref.channelIndex];
      if (!channel) continue;

      Object.assign(channel.chaserConfig, JSON.parse(JSON.stringify(state.after.chaserConfig)));
      channel.colorValue = state.after.colorValue;
    }
  }

  undo() {
    for (const [ref, state] of this.snapshots.entries()) {
      const channel = ref.fixture.channels[ref.channelIndex];
      if (!channel) continue;

      Object.assign(channel.chaserConfig, JSON.parse(JSON.stringify(state.before.chaserConfig)));
      channel.colorValue = state.before.colorValue;
    }
  }
}

registerCommand('SetChannelValues', (payload, ctx) => {
  const snapshots: SnapshotMap = new Map();
  for (const change of payload.changes) {
    const fixture = ctx.flatFixtures.find(f => f.id === change.fixtureId);
    if (!fixture) continue;
    snapshots.set(
      { fixture, channelIndex: change.channelIndex },
      { before: change.before, after: change.after },
    );
  }
  return new SetChannelValuesCommand(snapshots);
});
