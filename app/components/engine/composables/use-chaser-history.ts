import type { Fixture } from '~/utils/engine/core/fixture';
import type { EffectEngine } from '~/utils/engine/engine';
import type { Effect } from '~/utils/engine/types';
import { useHistory } from '~/components/engine/composables/use-history';
import { SetChannelValuesCommand, createSnapshot, type SnapshotMap } from '../commands/set-channel-values-command';
import { SetModifiersCommand, cloneEffectsList } from '../commands/set-modifiers-command';

export function useChaserHistory(props: { fixtures: Fixture[] }, effectEngine: EffectEngine | undefined) {
  const history = useHistory();

  function captureChannels(): SnapshotMap {
    const map: SnapshotMap = new Map();
    for (const f of props.fixtures) {
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

  function commitChannels(map: SnapshotMap, description: string) {
    let changed = false;
    for (const [ref, state] of map.entries()) {
      const ch = ref.fixture.channels[ref.channelIndex];
      if (!ch) continue;
      state.after = createSnapshot(ch);
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

  function captureModifiers(): Effect[] | null {
    if (!effectEngine) return null;
    return cloneEffectsList(effectEngine.effects);
  }

  function commitModifiers(before: Effect[], description: string) {
    if (!effectEngine) return;
    const after = cloneEffectsList(effectEngine.effects);
    // Basic diff: if JSON strings are different, we commit
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      history.execute(new SetModifiersCommand(effectEngine, before, after, description));
    }
  }

  return {
    captureChannels,
    commitChannels,
    captureModifiers,
    commitModifiers
  };
}
