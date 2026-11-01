<script setup lang="ts">
import { computed } from 'vue';
import type { LiveWidget } from '~/utils/live/types';
import { useEngineStore } from '~/stores/engine-store';
import { useBeatPulse } from '~/composables/engine/use-beat-pulse';
import { alignBeatToTap, applyTapBpm } from '~/composables/live-ops/tap-tempo';
import Replaceable from '~/components/extension-host/Replaceable.vue';

const props = defineProps<{
  widget: LiveWidget;
  pageId: string;
  editMode: boolean;
}>();

const engineStore = useEngineStore();

// Base tempo (the music); the speed multiplier is shown on the speed controls.
const bpm = computed(() => engineStore.baseBpm);
const displayColor = computed(() => props.widget.color ?? '#1e293b');

// Beat pulse: lights on every whole beat of the engine's beat clock.
const beatActive = useBeatPulse();

/** Every tap slides the beat grid onto it (smooth nudge, no jump). */
function onTap() {
  alignBeatToTap();
}

/** New tempo from the tap input (pm.tapTempo derives it; the clock epoch stays put). */
function onBpm(newBpm: number) {
  applyTapBpm(newBpm);
}
</script>

<template>
  <!-- pm.tapTempo; edit mode disables pointer interaction -->
  <Replaceable
    name="pm.tapTempo"
    :model-value="bpm"
    :phase="beatActive ? 0 : 0.5"
    :color="displayColor"
    :class="editMode && 'pointer-events-none'"
    @tap="onTap"
    @update:model-value="onBpm"
  />
</template>
