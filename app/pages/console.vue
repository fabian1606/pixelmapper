<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { useConnectionsStore } from '~/stores/connections-store';

const store = useConnectionsStore();

// Aggregate logs from all connectors, sorted by timestamp
const logs = computed(() => {
  return store.connectors
    .flatMap(c => c.logs.map(l => ({ ...l, label: c.meta.label })))
    .sort((a, b) => a.ts - b.ts)
    .slice(-500);
});

const bottomRef = ref<HTMLElement | null>(null);

watch(logs, async () => {
  await nextTick();
  bottomRef.value?.scrollIntoView({ behavior: 'instant' });
}, { deep: true });

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('de-DE', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>

<template>
  <div class="h-full flex flex-col bg-background font-mono text-xs">
    <div v-if="!store.connectors.length" class="flex-1 flex items-center justify-center text-muted-foreground">
      Keine Connectoren aktiv — gehe zu <NuxtLink to="/connections" class="underline mx-1">Connections</NuxtLink> um einen hinzuzufügen.
    </div>

    <div v-else-if="!logs.length" class="flex-1 flex items-center justify-center text-muted-foreground">
      Warte auf Daten…
    </div>

    <div v-else class="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
      <div
        v-for="(line, i) in logs"
        :key="i"
        class="flex gap-3 leading-5"
      >
        <span class="text-muted-foreground/50 shrink-0 select-none">{{ formatTime(line.ts) }}</span>
        <span class="text-muted-foreground/60 shrink-0 select-none">[{{ line.label }}]</span>
        <span class="text-foreground/80 break-all">{{ line.text }}</span>
      </div>
      <div ref="bottomRef" />
    </div>
  </div>
</template>
