<script setup lang="ts">
/**
 * ArtNet settings: bridge URL (browser only), target IP/port, universe count. Emits
 * `change(patch)`; the host applies and persists it.
 */
import { LEGACY_BRIDGE_URL, type ArtNetConnector } from '../artnet-connector';

const props = defineProps<{ connector: ArtNetConnector }>();
const emit = defineEmits<{ change: [patch: Record<string, unknown>] }>();

/** Value of an input event. */
const val = (e: Event) => (e.target as HTMLInputElement).value;
const input = 'mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring';
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="!props.connector.directUdp" class="text-xs text-muted-foreground">
      Bridge URL
      <input
        type="text"
        :class="[input, 'font-mono']"
        :placeholder="LEGACY_BRIDGE_URL"
        :value="props.connector.bridgeUrl.value"
        :disabled="props.connector.status.value === 'connected' || props.connector.status.value === 'connecting'"
        @change="emit('change', { bridgeUrl: val($event) })"
      >
    </label>
    <div class="flex gap-1.5">
      <label class="text-xs text-muted-foreground flex-1">
        ArtNet target IP
        <input type="text" :class="[input, 'font-mono']" placeholder="2.255.255.255" :value="props.connector.targetIp.value" @change="emit('change', { targetIp: val($event) })">
      </label>
      <label class="text-xs text-muted-foreground w-20 shrink-0">
        Port
        <input type="number" min="1" max="65535" :class="[input, 'font-mono']" :value="props.connector.artnetPort.value" @change="emit('change', { artnetPort: Number(val($event)) })">
      </label>
      <label class="text-xs text-muted-foreground w-24 shrink-0">
        Universes
        <input type="number" min="1" max="64" :class="input" :value="props.connector.outputCount" @change="emit('change', { outputCount: Number(val($event)) })">
      </label>
    </div>
    <p v-if="props.connector.directUdp" class="text-[10px] text-muted-foreground/80 leading-snug">
      Packets are sent directly from the app over UDP.
    </p>
    <p v-else class="text-[10px] text-muted-foreground/80 leading-snug">
      The ArtNet bridge must run locally (e.g. <span class="font-mono">bun run artnet-bridge</span>) and forwards packets to the target IP.
    </p>
  </div>
</template>
