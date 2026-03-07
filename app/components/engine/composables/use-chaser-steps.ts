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
        if (tabChannelFilter(c.type, c.role)) {
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
      stepValues: [],
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
          c.chaserConfig.stepsCount = target.stepsCount;
          c.chaserConfig.activeEditStep = index;
          while (c.chaserConfig.stepValues.length < target.stepsCount) {
            c.chaserConfig.stepValues.push(c.chaserConfig.stepValues[c.chaserConfig.stepValues.length - 1] ?? 0);
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
          channel.chaserConfig.stepsCount = newIndex + 1;
          channel.chaserConfig.activeEditStep = newIndex;
          while (channel.chaserConfig.stepValues.length < newIndex) {
            channel.chaserConfig.stepValues.push(channel.chaserConfig.stepValues[channel.chaserConfig.stepValues.length - 1] ?? 0);
          }
          channel.chaserConfig.stepValues[newIndex] = channel.chaserConfig.stepValues[target.activeEditStep] ?? channel.chaserConfig.stepValues[channel.chaserConfig.stepValues.length - 1] ?? 0;
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
          while (channel.chaserConfig.stepValues.length < target.stepsCount) {
            channel.chaserConfig.stepValues.push(channel.chaserConfig.stepValues[channel.chaserConfig.stepValues.length - 1] ?? 0);
          }
          channel.chaserConfig.stepValues.splice(toDelete, 1);

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
          // Collapse to single static step (the currently selected value)
          const keepValue = channel.chaserConfig.stepValues[target.activeEditStep] ?? channel.chaserConfig.stepValues[0] ?? 0;
          channel.chaserConfig.stepValues = [keepValue];
          channel.chaserConfig.stepsCount = 1;
          channel.chaserConfig.activeEditStep = 0;
          channel.chaserConfig.isPlaying = false;
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
