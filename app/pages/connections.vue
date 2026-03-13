<script setup lang="ts">
import { ref } from 'vue';
import { Usb, Plus, Trash2, CircleDot } from 'lucide-vue-next';
import { useConnectionsStore } from '~/stores/connections-store';
import { CONNECTOR_REGISTRY } from '~/utils/connectors/registry';
import type { BaseConnector } from '~/utils/connectors/base-connector';

const store = useConnectionsStore();

function addConnector(type: string) {
  const entry = CONNECTOR_REGISTRY.find(e => e.type === type);
  if (!entry) return;
  store.add(entry.create(crypto.randomUUID()));
}

const statusColor: Record<string, string> = {
  disconnected: 'text-muted-foreground',
  connecting: 'text-yellow-400',
  connected: 'text-green-400',
  error: 'text-red-400',
};
</script>

<template>
  <div class="p-6 flex flex-col gap-4 max-w-xl">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold">Connectors</h2>
      <div class="flex gap-2">
        <button
          v-for="entry in CONNECTOR_REGISTRY"
          :key="entry.type"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border border-border bg-background hover:bg-accent transition-colors"
          @click="addConnector(entry.type)"
        >
          <Plus :size="12" />
          {{ entry.label }}
        </button>
      </div>
    </div>

    <p v-if="!store.connectors.length" class="text-sm text-muted-foreground py-6">
      No connectors added yet.
    </p>

    <div
      v-for="connector in store.connectors"
      :key="connector.id"
      class="flex items-center gap-3 px-3 py-2.5 rounded border border-border bg-background text-sm"
    >
      <CircleDot :size="14" :class="statusColor[connector.status]" />

      <div class="flex-1 min-w-0">
        <div class="font-medium">{{ connector.meta.label }}</div>
        <div v-if="connector.errorMessage" class="text-xs text-red-400 truncate">
          {{ connector.errorMessage }}
        </div>
        <div v-else class="text-xs text-muted-foreground capitalize">
          {{ connector.status }}
        </div>
      </div>

      <button
        v-if="connector.status === 'connected'"
        class="px-2 py-1 rounded text-xs border border-border hover:bg-accent transition-colors"
        @click="connector.disconnect()"
      >
        Disconnect
      </button>
      <button
        v-else
        class="px-2 py-1 rounded text-xs border border-border hover:bg-accent transition-colors"
        :disabled="connector.status === 'connecting'"
        @click="connector.connect()"
      >
        Connect
      </button>

      <button
        class="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        @click="store.remove(connector.id)"
      >
        <Trash2 :size="14" />
      </button>
    </div>
  </div>
</template>
