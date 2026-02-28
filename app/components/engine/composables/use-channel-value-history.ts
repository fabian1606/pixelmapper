import { useHistory } from '~/components/engine/composables/use-history';
import { SetChannelValuesCommand, createSnapshot, type SnapshotMap } from '../commands/set-channel-values-command';
import type { Fixture } from '~/utils/engine/core/fixture';

export function useChannelValueHistory() {
  const history = useHistory();

  function captureSnapshots(fixtures: Fixture[]): SnapshotMap {
    const map: SnapshotMap = new Map();
    for (const f of fixtures) {
      for (let i = 0; i < f.channels.length; i++) {
        const ch = f.channels[i];
        if (!ch) continue;
        map.set({ fixture: f, channelIndex: i }, {
          before: createSnapshot(ch),
          after: null as any
        });
      }
    }
    return map;
  }

  function commitSnapshots(map: SnapshotMap, description: string) {
    let changed = false;
    for (const [ref, state] of map.entries()) {
      const ch = ref.fixture.channels[ref.channelIndex];
      if (!ch) continue;
      state.after = createSnapshot(ch);

      // Quick diff to see if anything actually changed
      if (
        state.before.colorValue !== state.after.colorValue ||
        JSON.stringify(state.before.stepValues) !== JSON.stringify(state.after.stepValues) ||
        JSON.stringify(state.before.chaserConfig) !== JSON.stringify(state.after.chaserConfig)
      ) {
        changed = true;
      }
    }

    if (changed) {
      history.execute(new SetChannelValuesCommand(map, description));
    }
  }

  return { captureSnapshots, commitSnapshots };
}
