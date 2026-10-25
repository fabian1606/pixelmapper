<script setup lang="ts">
/**
 * Port mapping of an `artnet-node` connector (plan D7, M5.5): per output
 * port the Pixelmapper universe (default = the Port-Address), the node's
 * Port-Address read-only, and “Write port address to node” (ArtAddress)
 * when they differ. Nothing is written to the node without that click.
 */
import { computed, ref } from 'vue';
import { useScope } from '@pixelmapper/extension-api';
import { formatPortAddress, portLabel, samePort } from '../bridge/protocol-model';
import type { ArtNetNodeConnector } from '../node/node-connector';
import { portAddressForUniverse, portAddressWriteError } from '../node/output-ports';

const props = defineProps<{ connector: ArtNetNodeConnector }>();
const emit = defineEmits<{ change: [patch: Record<string, unknown>] }>();

const project = useScope('project');
const node = computed(() => props.connector.node.value);
const busy = ref(false);
const error = ref<string | null>(null);

/** Universes that carry fixtures (for the “no fixtures” hint). */
const usedUniverses = computed(() => {
  const used = new Set<number>();
  for (const f of project.value?.fixtures ?? []) {
    if (f.startAddress < 1 || f.channelCount < 1) continue;
    const first = Math.floor((f.startAddress - 1) / 512) + 1;
    const last = Math.floor((f.startAddress + f.channelCount - 2) / 512) + 1;
    for (let u = first; u <= last; u++) used.add(u);
  }
  return used;
});

/** One row per output port. */
const rows = computed(() => props.connector.ports.value.map((port, i) => {
  const state = node.value?.ports.find(p => samePort(p.port, port)) ?? null;
  const universe = props.connector.outputMapping.value[i] ?? 0;
  const target = universe > 0 ? portAddressForUniverse(universe) : null;
  const portAddress = state?.outputPortAddress ?? null;
  const mismatch = node.value !== null && portAddress !== null && target !== null && portAddress !== target;
  const writeError = mismatch ? portAddressWriteError(node.value!, [{ port, portAddress: target! }]) : null;
  return { i, port, label: portLabel(port, props.connector.ports.value), state, universe, target, portAddress, mismatch, writeError };
}));

type Row = (typeof rows.value)[number];

/** Rows whose node Port-Address differs from their universe. */
const mismatched = computed(() => rows.value.filter(r => r.mismatch));

/** Sets the universe of one output (0 = off). */
function setUniverse(index: number, raw: string) {
  const n = Math.floor(Number(raw));
  const universe = Number.isFinite(n) && n > 0 ? Math.min(n, 32768) : 0;
  const mapping = props.connector.outputMapping.value.slice();
  mapping[index] = universe;
  emit('change', { outputMapping: mapping });
}

/** Writes the universes of `list` as the node's Port-Addresses. */
async function write(list: Row[]) {
  busy.value = true;
  error.value = null;
  try {
    await props.connector.writePortAddresses(list.map(r => ({ port: r.port, portAddress: r.target! })));
  }
  catch (e) {
    error.value = (e as Error).message ?? String(e);
  }
  finally {
    busy.value = false;
  }
}

/** Tooltip of a write button. */
function writeTitle(r: Row): string {
  return r.writeError ?? `Set the node's Port-Address of ${r.label} to ${formatPortAddress(r.target!)} (${r.target}) so it matches U${r.universe}`;
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex items-center gap-2">
      <span class="text-xs font-medium text-muted-foreground">Ports</span>
      <span class="text-[10px] text-muted-foreground/80">Universe → node port. The node's Port-Address only changes when you write it.</span>
    </div>
    <div v-for="r in rows" :key="`${r.port.bind}.${r.port.index}`" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span class="w-14 flex items-center gap-1 text-muted-foreground">
        <span class="inline-block size-1.5 rounded-full" :class="r.state?.output.data ? 'bg-primary' : 'bg-muted-foreground/30'" :title="r.state?.output.data ? 'Outputting DMX' : 'No DMX output'" />
        {{ r.label }}
      </span>
      <label class="flex items-center gap-1 text-muted-foreground">
        U
        <input
          type="number"
          min="0"
          max="32768"
          placeholder="off"
          class="w-16 rounded border border-border bg-background text-xs px-1.5 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          :value="r.universe || ''"
          @change="setUniverse(r.i, ($event.target as HTMLInputElement).value)"
        >
      </label>
      <span class="font-mono text-[11px] text-muted-foreground" :title="r.portAddress !== null ? `Node Port-Address ${r.portAddress}` : 'Node offline'">
        node {{ r.portAddress !== null ? formatPortAddress(r.portAddress) : '—' }}
      </span>
      <span v-if="r.universe && !usedUniverses.has(r.universe)" class="text-[10px] text-muted-foreground/70">no fixtures</span>
      <button
        v-if="r.mismatch"
        class="ml-auto px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors text-[11px] disabled:opacity-50"
        :disabled="busy || !!r.writeError"
        :title="writeTitle(r)"
        @click="write([r])"
      >
        Write port address to node
      </button>
    </div>
    <button
      v-if="mismatched.length > 1"
      class="self-end px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors text-[11px] disabled:opacity-50"
      :disabled="busy"
      @click="write(mismatched)"
    >
      Write all port addresses
    </button>
    <p v-if="error" class="text-[11px] text-destructive">{{ error }}</p>
  </div>
</template>
