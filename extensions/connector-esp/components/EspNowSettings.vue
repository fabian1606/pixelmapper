<script setup lang="ts">
/**
 * ESP-NOW bridge: the fixture whose rendered color is broadcast.
 */
import { useScope } from '@pixelmapper/extension-api';
import type { EspNowBridgeConnector } from '../espnow-bridge-connector';

const props = defineProps<{ connector: EspNowBridgeConnector }>();
const emit = defineEmits<{ change: [patch: Record<string, unknown>] }>();

const project = useScope('project');
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label class="text-xs text-muted-foreground">
      Color source fixture
      <select
        class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
        :value="props.connector.fixtureId.value != null ? String(props.connector.fixtureId.value) : ''"
        @change="emit('change', { fixtureId: ($event.target as HTMLSelectElement).value || null })"
      >
        <option value="">— none —</option>
        <option v-for="f in project?.fixtures ?? []" :key="String(f.id)" :value="String(f.id)">{{ f.name || `Fixture ${f.id}` }}</option>
      </select>
    </label>
    <p class="text-[10px] text-muted-foreground/80 leading-snug">
      Broadcasts the fixture's R/G/B + dimmer as a 4-byte color command via ESP-NOW (FF:FF:FF:FF:FF:FF) so audience devices without WiFi follow along.
    </p>
  </div>
</template>
