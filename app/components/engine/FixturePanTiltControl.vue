<script setup lang="ts">
/**
 * Pan/tilt control of the property sidebar (core, `panTilt` signature).
 *
 * Maps the selected fixtures' PAN/TILT channels to one normalized point
 * (x = pan, y = tilt, 0–1) and renders it with the replaceable `pm.xyInput`
 * (core default: two faders; the pan-tilt extension: a pad). Writes go to all
 * selected fixtures at the active step; a drag is one undo step.
 */
import { computed } from 'vue';
import type { Vec2 } from '@pixelmapper/extension-api';
import type { ChannelSection } from './composables/use-channel-sections';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Channel } from '~/utils/engine/core/channel';
import { useChannelValueHistory } from './composables/use-channel-value-history';
import { useEngineStore } from '~/stores/engine-store';
import type { SnapshotMap } from './commands/set-channel-values-command';
import Replaceable from '~/components/extension-host/Replaceable.vue';

const props = defineProps<{
  channelSections: ChannelSection[];
  activeStep: number;
}>();

const emit = defineEmits<{
  (e: 'before-change', fixtures: Fixture[]): void;
}>();

const { captureSnapshots, commitSnapshots } = useChannelValueHistory();
const engineStore = useEngineStore();

interface PanTiltFixture {
  fixture: Fixture;
  panCh?: Channel;
  tiltCh?: Channel;
}

/** Fixtures with both PAN and TILT among the shown sections. */
const targets = computed(() => {
  const map = new Map<string, PanTiltFixture>();
  for (const section of props.channelSections) {
    for (const entry of section.entries) {
      if (entry.channelType !== 'PAN' && entry.channelType !== 'TILT') continue;
      for (const fixture of entry.fixtures) {
        const key = String(fixture.id);
        if (!map.has(key)) map.set(key, { fixture });
        const t = map.get(key)!;
        const ch = fixture.channels.find(c =>
          c.type === entry.channelType
          && (c.oflChannelName ?? c.type) === (entry.oflChannelName ?? entry.channelType));
        if (ch && entry.channelType === 'PAN') t.panCh = ch;
        if (ch && entry.channelType === 'TILT') t.tiltCh = ch;
      }
    }
  }
  return [...map.values()].filter(t => t.panCh && t.tiltCh);
});

/** Average normalized pan/tilt at the active step. */
const value = computed<Vec2>(() => {
  const list = targets.value;
  if (list.length === 0) return { x: 0, y: 0 };
  let p = 0;
  let t = 0;
  for (const fd of list) {
    p += fd.panCh!.chaserConfig.stepValues[props.activeStep] ?? 0;
    t += fd.tiltCh!.chaserConfig.stepValues[props.activeStep] ?? 0;
  }
  return { x: p / list.length / 255, y: t / list.length / 255 };
});

/** Writes `val` at the active step, padding the step list if needed. */
function writeStep(ch: Channel, val: number) {
  const steps = ch.chaserConfig.stepValues;
  while (steps.length <= props.activeStep) steps.push(steps[steps.length - 1] ?? 0);
  steps[props.activeStep] = Math.max(0, Math.min(255, Math.round(val)));
  if (props.activeStep > 0 && ch.chaserConfig.stepsCount <= props.activeStep) {
    ch.chaserConfig.stepsCount = props.activeStep + 1;
  }
}

let scrubSnapshots: SnapshotMap | null = null;

function onScrubStart() {
  scrubSnapshots = captureSnapshots(targets.value.map(t => t.fixture));
}

function onScrubEnd() {
  if (!scrubSnapshots) return;
  commitSnapshots(scrubSnapshots, 'Pan/Tilt Change');
  scrubSnapshots = null;
}

/** Applies a normalized pan/tilt point to all targets. */
function apply(p: Vec2) {
  const single = !scrubSnapshots;
  if (single) onScrubStart();
  emit('before-change', targets.value.map(t => t.fixture));
  for (const t of targets.value) {
    writeStep(t.panCh!, p.x * 255);
    writeStep(t.tiltCh!, p.y * 255);
  }
  engineStore.markChannelsDirty();
  if (single) onScrubEnd();
}
</script>

<template>
  <div v-if="targets.length > 0" class="mt-4 mb-10">
    <!-- Spacing as in the pre-extension controls (my-4 inside mb-6) -->
    <Replaceable
      name="pm.xyInput"
      :model-value="value"
      :axis-labels="['Pan', 'Tilt']"
      @update:model-value="apply"
      @scrub-start="onScrubStart"
      @scrub-end="onScrubEnd"
    />
  </div>
</template>
