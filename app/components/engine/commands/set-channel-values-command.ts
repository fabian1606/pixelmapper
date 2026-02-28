import type { Command } from '../composables/use-history';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Channel } from '~/utils/engine/core/channel';

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
    stepValues: [...channel.stepValues],
    colorValue: channel.colorValue,
    chaserConfig: channel.chaserConfig ? JSON.parse(JSON.stringify(channel.chaserConfig)) : undefined
  };
}

/**
 * Generic undo/redo command for setting properties on any number of channels across any number of fixtures.
 * Because channel changes can be sweeping (multi-select, drag-to-set), this command takes deeply-cloned
 * snapshots of exactly what changed, and wholesale replaces the channel state on undo/redo.
 */
export class SetChannelValuesCommand implements Command {
  constructor(
    private snapshots: SnapshotMap,
    public description: string = 'Change Values'
  ) { }

  execute() {
    for (const [ref, state] of this.snapshots.entries()) {
      const channel = ref.fixture.channels[ref.channelIndex];
      if (!channel) continue;

      channel.stepValues = [...state.after.stepValues];
      channel.colorValue = state.after.colorValue;
      channel.chaserConfig = state.after.chaserConfig ? JSON.parse(JSON.stringify(state.after.chaserConfig)) : undefined;
    }
  }

  undo() {
    for (const [ref, state] of this.snapshots.entries()) {
      const channel = ref.fixture.channels[ref.channelIndex];
      if (!channel) continue;

      channel.stepValues = [...state.before.stepValues];
      channel.colorValue = state.before.colorValue;
      channel.chaserConfig = state.before.chaserConfig ? JSON.parse(JSON.stringify(state.before.chaserConfig)) : undefined;
    }
  }
}
