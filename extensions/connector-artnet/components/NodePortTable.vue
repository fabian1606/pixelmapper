<script setup lang="ts">
/**
 * Port mapping of an `artnet` connector (plan D7, M5.5): per output
 * port the Pixelmapper universe (default = the Port-Address) and the
 * node's Port-Address, read-only. When they differ the row says so; the
 * Port-Address itself is written only in the node configuration's Ports
 * section (M7.3), so there is one place that writes it.
 */
import { computed } from 'vue';
import { useScope } from '@pixelmapper/extension-api';
import { formatPortAddress, portAddressOf, portLabel, samePort } from '../bridge/protocol-model';
import type { ArtNetNodeConnector } from '../node/node-connector';
import { portAddressForUniverse } from '../node/output-ports';

const props = defineProps<{ connector: ArtNetNodeConnector }>();
const emit = defineEmits<{ change: [patch: Record<string, unknown>] }>();

const project = useScope('project');
const node = computed(() => props.connector.node.value);

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
  // The field of the port's current direction is its Port-Address (contract §4).
  const portAddress = state ? portAddressOf(state) : null;
  const differs = node.value !== null && portAddress !== null && target !== null && portAddress !== target;
  return { i, port, label: portLabel(port, props.connector.ports.value), state, universe, portAddress, differs };
}));

/** Sets the universe of one output (0 = off). */
function setUniverse(index: number, raw: string) {
  const n = Math.floor(Number(raw));
  const universe = Number.isFinite(n) && n > 0 ? Math.min(n, 32768) : 0;
  const mapping = props.connector.outputMapping.value.slice();
  mapping[index] = universe;
  emit('change', { outputMapping: mapping });
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex items-center gap-2">
      <span class="text-xs font-medium text-muted-foreground">Universes</span>
      <span class="text-[10px] text-muted-foreground/80">Universe → node port. Port-Addresses are set under Ports below.</span>
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
      <span
        v-if="r.differs"
        class="ml-auto text-[10px] text-muted-foreground"
        :title="`The node's Port-Address ${r.portAddress} differs from U${r.universe}. DMX still reaches the port; change the Port-Address under Ports if other Art-Net software should see the same number.`"
        data-differs
      >
        ≠ U{{ r.universe }}
      </span>
    </div>
  </div>
</template>
