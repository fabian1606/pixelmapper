<script setup lang="ts">
/**
 * One output connector on the connections page (generic, plan P6.1):
 * status, label, connect/disconnect/remove, the type's settings component
 * (rendered in its extension's context), universe output mapping and logs.
 */
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { CircleDot, ChevronDown, ChevronRight, Trash2 } from 'lucide-vue-next';
import type { Connector } from '@pixelmapper/extension-api';
import { useConnectionsStore } from '~/stores/connections-store';
import { useEngineStore } from '~/stores/engine-store';
import { getConnectorType } from '~/utils/connectors/connector-registry';
import ExtensionContributionHost from '~/components/extension-host/ExtensionContributionHost.vue';

const props = defineProps<{ connector: Connector }>();

const store = useConnectionsStore();
const { usedUniverses, totalUniverses } = storeToRefs(useEngineStore());

const registered = computed(() => getConnectorType(props.connector.meta.type));
const outputsOpen = ref(false);
const logsOpen = ref(false);

const STATUS_COLOR: Record<string, string> = {
  disconnected: 'text-muted-foreground',
  connecting: 'text-yellow-400',
  connected: 'text-green-400',
  error: 'text-red-400',
};

/** Status text; a connecting connector with auto-reconnect is retrying. */
const statusLabel = computed(() => {
  const s = props.connector.status.value;
  if (s === 'connecting') return props.connector.autoReconnect.value ? 'reconnecting…' : 'connecting…';
  return { connected: 'connected', error: 'error', disconnected: 'disconnected' }[s] ?? s;
});

/** True while the connector is connected or retrying (shows Disconnect). */
const active = computed(() => props.connector.status.value === 'connected' || props.connector.autoReconnect.value);

/** Connectors without a user-managed connection (e.g. direct UDP) only offer Retry after an error. */
const alwaysConnected = computed(() => props.connector.alwaysConnected?.() ?? false);

/** Applies and persists a config patch. */
function change(patch: Record<string, unknown>) {
  store.update(props.connector.id, patch);
}

/** Sets the universe of one output. */
function setOutput(index: number, universe: number) {
  const mapping = props.connector.outputMapping.value.slice();
  mapping[index] = universe;
  change({ outputMapping: mapping });
}
</script>

<template>
  <div class="flex flex-col gap-2 px-3 py-2.5 rounded border border-border bg-background text-sm">
    <div class="flex items-center gap-3">
      <CircleDot :size="14" :class="STATUS_COLOR[connector.status.value]" />
      <div class="flex-1 min-w-0">
        <input
          class="w-full bg-transparent font-medium text-sm focus:outline-none focus:ring-1 focus:ring-ring rounded px-0.5"
          :placeholder="connector.meta.label"
          :value="connector.label.value"
          @change="change({ label: ($event.target as HTMLInputElement).value })"
        >
        <div v-if="connector.errorMessage.value" class="text-xs text-red-400 truncate">{{ connector.errorMessage.value }}</div>
        <div v-else class="text-xs text-muted-foreground">{{ connector.meta.label }} · {{ statusLabel }}</div>
      </div>
      <button
        v-if="alwaysConnected && connector.status.value === 'error'"
        class="px-2 py-1 rounded text-xs border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        @click="connector.connect()"
      >
        Retry
      </button>
      <template v-else-if="alwaysConnected" />
      <button
        v-else-if="active"
        class="px-2 py-1 rounded text-xs border border-border hover:bg-accent transition-colors"
        @click="connector.disconnect()"
      >
        Disconnect
      </button>
      <button
        v-else
        class="px-2 py-1 rounded text-xs border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        :disabled="connector.status.value === 'connecting'"
        @click="connector.connect()"
      >
        Connect
      </button>
      <button class="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title="Remove" @click="store.remove(connector.id)">
        <Trash2 :size="14" />
      </button>
    </div>

    <!-- Type-specific settings from the connector's extension -->
    <ExtensionContributionHost
      v-if="registered?.def.settings"
      :extension-id="registered.extensionId"
      :slot-id="`connections/${connector.meta.type}:settings`"
      :component="registered.def.settings"
      :connector="connector"
      @change="change"
    />
    <p v-else-if="!registered" class="text-xs text-muted-foreground">The extension providing “{{ connector.meta.type }}” is not installed.</p>

    <!-- Universe outputs -->
    <template v-if="connector.outputCount > 0">
      <button class="flex items-center gap-2 px-1 py-1 rounded hover:bg-accent/50 transition-colors w-full text-left" @click="outputsOpen = !outputsOpen">
        <component :is="outputsOpen ? ChevronDown : ChevronRight" :size="14" class="text-muted-foreground" />
        <span class="text-xs font-medium text-muted-foreground">Outputs</span>
        <span class="text-xs text-muted-foreground">({{ connector.outputMapping.value.filter(u => u > 0).length }}/{{ connector.outputCount }} assigned)</span>
      </button>
      <div v-if="outputsOpen" class="px-1 flex flex-col gap-1">
        <div v-for="(_, i) in connector.outputCount" :key="i" class="flex items-center gap-2">
          <span class="text-xs text-muted-foreground w-14">Out {{ i + 1 }}</span>
          <select
            class="flex-1 rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
            :value="connector.outputMapping.value[i] ?? 0"
            @change="setOutput(i, Number(($event.target as HTMLSelectElement).value))"
          >
            <option :value="0">— none —</option>
            <option v-for="u in Math.max(totalUniverses, 1)" :key="u" :value="u">U{{ u }}{{ usedUniverses.includes(u) ? '' : ' (unused)' }}</option>
          </select>
        </div>
      </div>
    </template>

    <!-- Logs -->
    <template v-if="connector.logs.length">
      <button class="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-accent/50 transition-colors w-full text-left" @click="logsOpen = !logsOpen">
        <component :is="logsOpen ? ChevronDown : ChevronRight" :size="14" class="text-muted-foreground" />
        <span class="text-xs text-muted-foreground">Log ({{ connector.logs.length }})</span>
      </button>
      <div v-if="logsOpen" class="rounded border border-border/50 bg-muted/20 overflow-y-auto max-h-32 px-2 py-1.5 flex flex-col gap-0.5">
        <div
          v-for="(line, i) in connector.logs.slice().reverse()"
          :key="i"
          class="text-[10px] font-mono leading-tight"
          :class="/fail|error/i.test(line.text) ? 'text-red-400' : 'text-muted-foreground'"
        >
          {{ line.text }}
        </div>
      </div>
    </template>
  </div>
</template>
