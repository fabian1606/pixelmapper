import type { Fixture } from '~/utils/engine/core/fixture';
import type { EffectEngine } from '~/utils/engine/engine';
import type { ModifierInstance } from '~/utils/engine/types';
import { useHistory } from '~/components/engine/composables/use-history';
import { SetChannelValuesCommand, createSnapshot, type SnapshotMap } from '../commands/set-channel-values-command';
import { SetModifiersCommand } from '~/components/engine/commands/set-modifiers-command';
import { cloneModifiers } from '~/utils/engine/modifiers';

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

  function captureModifiers(): ModifierInstance[] | null {
    if (!effectEngine) return null;
    return cloneModifiers(effectEngine.modifiers);
  }

  function commitModifiers(before: ModifierInstance[], description: string) {
    if (!effectEngine) return;
    const after = cloneModifiers(effectEngine.modifiers);
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
