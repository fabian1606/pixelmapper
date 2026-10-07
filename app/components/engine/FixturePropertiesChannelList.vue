<script setup lang="ts">
import { ref } from 'vue';
import type { ChannelSection } from './composables/use-channel-sections';
import type { Fixture } from '~/utils/engine/core/fixture';
import FixturePropertyControl from './FixturePropertyControl.vue';
import FixtureColorControl from './FixtureColorControl.vue';
import FixturePanTiltControl from './FixturePanTiltControl.vue';
import ChannelLimitsDialog from './ChannelLimitsDialog.vue';

defineProps<{
  channelSections: ChannelSection[];
  activeStep: number;
}>();

const emit = defineEmits<{
  (e: 'before-change', fixtures: Fixture[]): void;
}>();

function handleBeforeChange(fixtures: Fixture[]) {
  emit('before-change', fixtures);
}

const limitsDialog = ref<InstanceType<typeof ChannelLimitsDialog> | null>(null);
</script>

<template>
  <div v-if="channelSections.length === 0" class="text-sm text-muted-foreground text-center mt-10">
    No adjustable properties found.
  </div>
  <div v-else class="space-y-5">
    <div class="space-y-4">
      <FixtureColorControl
        :channel-sections="channelSections"
        :active-step="activeStep"
        @before-change="handleBeforeChange"
      />
      <FixturePanTiltControl
        :channel-sections="channelSections"
        :active-step="activeStep"
        @before-change="handleBeforeChange"
      />
      <ChannelLimitsDialog ref="limitsDialog" />
    </div>
    <div v-for="(section, idx) in channelSections" :key="idx">
      <!-- Section label: only shown when multiple fixture types are selected -->
      <div v-if="section.showLabel" class="flex items-center gap-2 mb-1.5">
        <span class="text-[10px] font-mono text-muted-foreground uppercase tracking-wider flex-shrink-0">
          {{ section.name }}
        </span>
        <div class="h-px bg-border flex-1"></div>
      </div>

      <!-- Channel rows for this section -->
      <div class="space-y-0.5">
        <FixturePropertyControl
          v-for="entry in section.entries"
          :key="`${entry.channelType}:${entry.oflChannelName}`"
          :type="entry.channelType"
          :oflChannelName="entry.oflChannelName"
          :fixtures="entry.fixtures"
          :active-step="activeStep"
          @before-change="handleBeforeChange"
          @open-limits="limitsDialog?.open($event)"
        />
      </div>
    </div>
  </div>
</template>
