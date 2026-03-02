import { computed } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { EffectEngine } from '~/utils/engine/engine';
import type { ChannelChaserConfig, ChannelType, SpeedConfig } from '~/utils/engine/types';
import { extractTabChannelFilter, syncCategoryBeforeEdit } from '~/utils/engine/composables/use-category-sync';
import type { useChaserHistory } from './use-chaser-history';

export function useChaserSteps(
  props: { fixtures: Fixture[]; activeTab: string },
  effectEngine: EffectEngine | undefined,
  historyTools: ReturnType<typeof useChaserHistory>,
  emit: (event: 'change') => void
) {
  const { captureChannels, commitChannels } = historyTools;
  const tabChannelFilter = extractTabChannelFilter(props);

  const activeChaserConfig = computed<ChannelChaserConfig>(() => {
    let maxSteps = 1;
    let maxActiveStep = 0;
    let isPlaying = true;
    let stepDuration: SpeedConfig = { mode: 'time', timeMs: 1000, beatValue: 1, beatOffset: 0 };
    let fadeDuration: SpeedConfig = { mode: 'time', timeMs: 0, beatValue: 1, beatOffset: 0 };
    let found = false;

    for (const f of props.fixtures) {
      for (const c of f.channels) {
        if (tabChannelFilter(c.type, c.role) && c.chaserConfig) {
          if (!found) {
            isPlaying = c.chaserConfig.isPlaying;
            stepDuration = c.chaserConfig.stepDuration;
            fadeDuration = c.chaserConfig.fadeDuration;
            found = true;
          }
          if (c.chaserConfig.stepsCount > maxSteps) maxSteps = c.chaserConfig.stepsCount;
          if (c.chaserConfig.activeEditStep > maxActiveStep) maxActiveStep = c.chaserConfig.activeEditStep;
        }
      }
    }

    return {
      stepsCount: maxSteps,
      activeEditStep: Math.min(maxActiveStep, maxSteps - 1),
      isPlaying,
      stepDuration,
      fadeDuration
    };
  });

  function setActiveStep(index: number) {
    const snaps = captureChannels();
    syncCategoryBeforeEdit(props.fixtures, tabChannelFilter as any, effectEngine, 'steps');
    const target = activeChaserConfig.value;

    for (const f of props.fixtures) {
      for (const c of f.channels) {
        if (tabChannelFilter(c.type, c.role)) {
          if (!c.chaserConfig) c.chaserConfig = { ...target };
          c.chaserConfig.stepsCount = target.stepsCount;
          c.chaserConfig.activeEditStep = index;

          while (c.stepValues.length < target.stepsCount) {
            c.stepValues.push(c.stepValues[c.stepValues.length - 1] ?? 0);
          }
        }
      }
    }
    emit('change');
    commitChannels(snaps, `Set Step ${index + 1}`);
  }

  function addStep() {
    const snaps = captureChannels();
    syncCategoryBeforeEdit(props.fixtures, tabChannelFilter as any, effectEngine, 'steps');
    const target = activeChaserConfig.value;
    const newIndex = target.stepsCount;

    for (const fixture of props.fixtures) {
      for (const channel of fixture.channels) {
        if (tabChannelFilter(channel.type, channel.role)) {
          if (!channel.chaserConfig) channel.chaserConfig = { ...target };

          channel.chaserConfig.stepsCount = newIndex + 1;
          channel.chaserConfig.activeEditStep = newIndex;

          while (channel.stepValues.length < newIndex) {
            channel.stepValues.push(channel.stepValues[channel.stepValues.length - 1] ?? 0);
          }
          channel.stepValues[newIndex] = channel.stepValues[target.activeEditStep] ?? channel.stepValues[channel.stepValues.length - 1] ?? 0;
        }
      }
    }
    emit('change');
    commitChannels(snaps, 'Add Step');
  }

  function deleteActiveStep() {
    const snaps = captureChannels();
    syncCategoryBeforeEdit(props.fixtures, tabChannelFilter as any, effectEngine, 'steps');
    const target = activeChaserConfig.value;
    if (target.stepsCount <= 1) return;

    const toDelete = target.activeEditStep;
    for (const fixture of props.fixtures) {
      for (const channel of fixture.channels) {
        if (tabChannelFilter(channel.type, channel.role)) {
          if (!channel.chaserConfig) channel.chaserConfig = { ...target };

          while (channel.stepValues.length < target.stepsCount) {
            channel.stepValues.push(channel.stepValues[channel.stepValues.length - 1] ?? 0);
          }
          channel.stepValues.splice(toDelete, 1);

          channel.chaserConfig.stepsCount = target.stepsCount - 1;
          if (toDelete === target.stepsCount - 1 && target.activeEditStep === toDelete) {
            channel.chaserConfig.activeEditStep = toDelete - 1;
          } else if (target.activeEditStep > toDelete) {
            channel.chaserConfig.activeEditStep = target.activeEditStep - 1;
          } else {
            channel.chaserConfig.activeEditStep = target.activeEditStep;
          }
        }
      }
    }
    emit('change');
    commitChannels(snaps, 'Delete Step');
  }

  function updateTiming(key: 'stepDuration' | 'fadeDuration', value: SpeedConfig) {
    const snaps = captureChannels();
    syncCategoryBeforeEdit(props.fixtures, tabChannelFilter as any, effectEngine, 'steps');
    const target = activeChaserConfig.value;
    for (const fixture of props.fixtures) {
      for (const channel of fixture.channels) {
        if (tabChannelFilter(channel.type, channel.role)) {
          if (!channel.chaserConfig) channel.chaserConfig = { ...target };
          channel.chaserConfig[key] = value;
        }
      }
    }
    emit('change');
    commitChannels(snaps, 'Update Timing');
  }

  function removeChaser() {
    const snaps = captureChannels();
    syncCategoryBeforeEdit(props.fixtures, tabChannelFilter as any, effectEngine, 'steps');
    const target = activeChaserConfig.value;
    for (const fixture of props.fixtures) {
      for (const channel of fixture.channels) {
        if (tabChannelFilter(channel.type, channel.role)) {
          channel.chaserConfig = undefined;
          if (channel.stepValues.length > 1) {
            channel.stepValues = [channel.stepValues[target.activeEditStep] ?? channel.stepValues[0] ?? 0];
          }
        }
      }
    }
    emit('change');
    commitChannels(snaps, 'Remove Program');
  }

  return {
    activeChaserConfig,
    tabChannelFilter,
    setActiveStep,
    addStep,
    deleteActiveStep,
    updateTiming,
    removeChaser
  };
}
