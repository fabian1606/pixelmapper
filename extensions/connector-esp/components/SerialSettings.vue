<script setup lang="ts">
/**
 * USB serial node: firmware version, update warning/button and flash progress.
 */
import type { EspSerialConnector } from '../serial-connector';

const props = defineProps<{ connector: EspSerialConnector }>();
defineEmits<{ change: [patch: Record<string, unknown>] }>();
</script>

<template>
  <div class="flex flex-col gap-1.5 text-xs">
    <div class="flex items-center gap-2 text-muted-foreground">
      <span>Firmware: {{ props.connector.firmwareVersion.value ? `v${props.connector.firmwareVersion.value}` : '—' }}</span>
      <span v-if="props.connector.latestFirmware.value" class="text-muted-foreground/60">
        (latest v{{ props.connector.latestFirmware.value.version }}{{ props.connector.latestFirmware.value.origin === 'bundled' ? ', bundled' : '' }})
      </span>
      <span v-else-if="props.connector.status.value === 'connected'" class="text-muted-foreground/60">(no firmware available offline)</span>
      <button
        v-if="props.connector.latestFirmware.value && props.connector.status.value === 'connected' && !props.connector.isFlashing.value"
        type="button"
        class="ml-auto px-2 py-0.5 rounded border border-border hover:bg-accent transition-colors"
        title="Flash the latest firmware"
        @click="props.connector.flashFirmware()"
      >
        Update firmware
      </button>
    </div>

    <div v-if="props.connector.isFlashing.value">
      <div class="flex items-center justify-between mb-1 text-muted-foreground">
        <span>Flashing firmware…</span>
        <span>{{ props.connector.flashProgress.value }}%</span>
      </div>
      <div class="h-1 rounded bg-border overflow-hidden">
        <div class="h-full bg-primary transition-all duration-200" :style="{ width: `${props.connector.flashProgress.value}%` }" />
      </div>
    </div>
    <div
      v-else-if="props.connector.status.value === 'connected' && props.connector.updateAvailable.value"
      class="px-2 py-1.5 rounded border border-destructive/40 bg-destructive/10 text-destructive"
    >
      Firmware v{{ props.connector.firmwareVersion.value }} is outdated — update to v{{ props.connector.latestVersion.value }}.
    </div>
    <p class="text-[10px] text-muted-foreground/80 leading-snug">
      Streams rendered DMX universes (map outputs below). Requires firmware that accepts frame packets.
    </p>
  </div>
</template>
