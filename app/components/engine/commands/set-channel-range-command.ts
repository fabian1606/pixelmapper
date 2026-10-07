import type { Fixture } from '~/utils/engine/core/fixture';
import { type SerializableCommand, registerCommand } from './serializable-command';
import { useEngineStore } from '~/stores/engine-store';

export interface ChannelRangeState {
  rangeMin: number;
  rangeMax: number;
  /** When present, the channel's defaultValue (reset value) is also updated. */
  defaultValue?: number;
}

export interface ChannelRangeRef {
  fixture: Fixture;
  channelIndex: number;
}

export type RangeSnapshotMap = Map<ChannelRangeRef, { before: ChannelRangeState; after: ChannelRangeState }>;

/**
 * Undo/redo command for setting the per-channel DMX range (rangeMin/rangeMax).
 * Range is layout metadata, so applying it triggers a full flush (layout rebuild
 * + dispatch), not just a channels-packet rebuild.
 */
export class SetChannelRangeCommand implements SerializableCommand {
  readonly commandType = 'SetChannelRange';

  constructor(
    private snapshots: RangeSnapshotMap,
    public description: string = 'Change Range',
  ) {}

  toPayload() {
    const changes: Array<{
      fixtureId: string | number;
      channelIndex: number;
      before: ChannelRangeState;
      after: ChannelRangeState;
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

  private apply(which: 'before' | 'after') {
    for (const [ref, state] of this.snapshots.entries()) {
      const channel = ref.fixture.channels[ref.channelIndex];
      if (!channel) continue;
      channel.rangeMin = state[which].rangeMin;
      channel.rangeMax = state[which].rangeMax;
      if (state[which].defaultValue !== undefined) {
        channel.defaultValue = state[which].defaultValue!;
      }
    }
    useEngineStore().flushEngineOutput();
  }

  execute() { this.apply('after'); }
  undo() { this.apply('before'); }
}

registerCommand('SetChannelRange', (payload, ctx) => {
  const snapshots: RangeSnapshotMap = new Map();
  for (const change of payload.changes) {
    const fixture = ctx.flatFixtures.find(f => f.id === change.fixtureId);
    if (!fixture) continue;
    snapshots.set(
      { fixture, channelIndex: change.channelIndex },
      { before: change.before, after: change.after },
    );
  }
  return new SetChannelRangeCommand(snapshots);
});
