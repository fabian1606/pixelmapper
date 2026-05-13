<script setup lang="ts">
definePageMeta({ layout: 'project' });
import { CircleDot, Plus, Trash2, ArrowUpCircle, RefreshCw, Network, ChevronDown, ChevronRight, Gamepad2, PlugZap } from 'lucide-vue-next';
import { ref, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useConnectionsStore } from '~/stores/connections-store';
import { useEngineStore } from '~/stores/engine-store';
import { useControllerStore } from '~/stores/controller-store';
import { useLiveBusStore, TAB_SESSION_ID } from '~/stores/live-bus-store';
import { listControllerDefinitions, getControllerDefinition } from '~/utils/controllers/catalog';
import { AddLiveControllerCommand, RemoveLiveControllerCommand } from '~/components/engine/commands/live-widget-commands';
import { useHistory } from '~/components/engine/composables/use-history';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { OUTPUT_CONNECTOR_REGISTRY, INPUT_CONNECTOR_REGISTRY } from '~/utils/connectors/registry';
import { SerialConnector } from '~/utils/connectors/serial-connector';
import type { BaseConnector } from '~/utils/connectors/base-connector';

const route = useRoute();
const initialTab = route.query.tab === 'inputs' ? 'inputs' : 'outputs';
const connectionsTab = ref<'outputs' | 'inputs'>(initialTab);
watch(() => route.query.tab, (v) => { if (v === 'inputs' || v === 'outputs') connectionsTab.value = v; });

const store = useConnectionsStore();
const engineStore = useEngineStore();
const controllerStore = useControllerStore();
const liveBus = useLiveBusStore();
const liveModeStore = useLiveModeStore();
const history = useHistory();

const controllerDefs = computed(() => listControllerDefinitions());
const { usedUniverses, totalUniverses } = storeToRefs(engineStore);

/**
 * Controllers connected by other tabs/users on this project. Filters out our
 * own session — local controllers already have full editing UI above.
 */
const remoteControllers = computed(() => {
  const out: Array<{ presence: typeof liveBus.presenceUsers[number]; controller: NonNullable<typeof liveBus.presenceUsers[number]['controllers']>[number] }> = [];
  for (const p of liveBus.presenceUsers) {
    if (p.sessionId === TAB_SESSION_ID) continue;
    if (!p.controllers?.length) continue;
    for (const c of p.controllers) out.push({ presence: p, controller: c });
  }
  return out;
});

function controllerLabelFor(definitionKey: string): string {
  return getControllerDefinition(definitionKey)?.label ?? definitionKey;
}

function allDrivers() {
  return Array.from(controllerStore.drivers.entries()).map(([key, driver]) => ({ key, driver }));
}

async function addController(definitionKey: string) {
  const instanceId = crypto.randomUUID();
  history.execute(new AddLiveControllerCommand(instanceId, definitionKey));
  const driver = controllerStore.createDriver(instanceId, definitionKey);
  if (driver) driver.connect().catch(console.warn);
}

async function reconnectController(instanceId: string) {
  const driver = controllerStore.getBindingFor(instanceId);
  if (!driver) return;
  try { await driver.connect(); } catch { /* surfaces via errorMessage */ }
}

async function removeController(instanceId: string, definitionKey: string) {
  history.execute(new RemoveLiveControllerCommand(instanceId, definitionKey));
  await controllerStore.removeDriver(instanceId);
}

const expandedConnectors = ref<Set<string>>(new Set());

const statusColor: Record<string, string> = {
  disconnected: 'text-muted-foreground',
  connecting: 'text-yellow-400',
  connected: 'text-green-400',
  error: 'text-red-400',
};

function addConnector(type: string) {
  const entry = OUTPUT_CONNECTOR_REGISTRY.find(e => e.type === type);
  if (!entry) return;
  store.add(entry.create(crypto.randomUUID()));
}

function asSerial(c: BaseConnector): SerialConnector | null {
  return c instanceof SerialConnector ? c : null;
}

function toggleExpanded(connectorId: string) {
  if (expandedConnectors.value.has(connectorId)) {
    expandedConnectors.value.delete(connectorId);
  } else {
    expandedConnectors.value.add(connectorId);
  }
}

/** Build list of universe options for a dropdown (0 = none, plus all available universes). */
function universeOptions(total: number): { value: number; label: string }[] {
  const opts = [{ value: 0, label: '—' }];
  for (let u = 1; u <= total; u++) {
    opts.push({ value: u, label: `U${u}` });
  }
  return opts;
}

/** Check if a universe is used by any fixture. */
function isUniverseUsed(u: number): boolean {
  return usedUniverses.value.includes(u);
}

/** Count how many outputs are assigned for this connector. */
function assignedCount(connector: BaseConnector): number {
  return connector.outputMapping.value.filter(u => u > 0).length;
}
</script>

<template>
  <div class="p-6 flex flex-col gap-4 max-w-xl">
    <!-- Header row -->
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold">Connectors</h2>
      <!-- Tab switcher: Outputs / Inputs -->
      <div class="flex items-center bg-muted/50 p-1 rounded-lg border border-border/50">
        <button
          class="px-3 py-1 text-xs font-medium rounded-md transition-all duration-150"
          :class="connectionsTab === 'outputs' ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground'"
          @click="connectionsTab = 'outputs'"
        >Outputs</button>
        <button
          class="px-3 py-1 text-xs font-medium rounded-md transition-all duration-150"
          :class="connectionsTab === 'inputs' ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground'"
          @click="connectionsTab = 'inputs'"
        >Inputs</button>
      </div>
    </div>

    <!-- Add connector buttons (only for active tab) -->
    <div v-if="connectionsTab === 'outputs'" class="flex gap-2 flex-wrap">
      <button
        v-for="entry in OUTPUT_CONNECTOR_REGISTRY"
        :key="entry.type"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border border-border bg-background hover:bg-accent transition-colors"
        @click="addConnector(entry.type)"
      >
        <Plus :size="12" />
        {{ entry.label }}
      </button>
    </div>

    <!-- Inputs: controller instances -->
    <template v-if="connectionsTab === 'inputs'">
      <!-- Add buttons: one per catalog definition -->
      <div class="flex gap-2 flex-wrap">
        <button
          v-for="def in controllerDefs"
          :key="def.key"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border border-border bg-background hover:bg-accent transition-colors"
          @click="addController(def.key)"
        >
          <Plus :size="12" />
          {{ def.label }}
        </button>
      </div>

      <p v-if="!liveModeStore.liveControllers.length" class="text-sm text-muted-foreground py-2">
        Noch keine Controller angelegt.
      </p>

      <!-- One row per instance -->
      <div
        v-for="inst in liveModeStore.liveControllers"
        :key="inst.id"
        class="flex flex-col gap-2 px-3 py-2.5 rounded border border-border bg-background text-sm"
      >
        <div class="flex items-center gap-3">
          <CircleDot
            :size="14"
            :class="controllerStore.drivers.get(inst.id)
              ? statusColor[(controllerStore.drivers.get(inst.id) as any).status]
              : 'text-muted-foreground/30'"
          />

          <div class="flex-1 min-w-0">
            <div class="font-medium flex items-center gap-1.5">
              <Gamepad2 :size="12" class="text-muted-foreground" />
              {{ (controllerStore.drivers.get(inst.id) as any)?.deviceLabel ?? controllerLabelFor(inst.definitionKey) }}
            </div>
            <div v-if="(controllerStore.drivers.get(inst.id) as any)?.errorMessage" class="text-xs text-red-400 truncate">
              {{ (controllerStore.drivers.get(inst.id) as any).errorMessage }}
            </div>
            <div v-else class="text-xs text-muted-foreground capitalize">
              {{ (controllerStore.drivers.get(inst.id) as any)?.status ?? 'Nicht verbunden' }}
            </div>
          </div>

          <button
            v-if="(controllerStore.drivers.get(inst.id) as any)?.status !== 'connected'"
            class="flex items-center gap-1 px-2 py-1 rounded text-xs border border-border hover:bg-accent transition-colors"
            :disabled="(controllerStore.drivers.get(inst.id) as any)?.status === 'connecting'"
            @click="reconnectController(inst.id)"
          >
            <PlugZap :size="12" />
            Verbinden
          </button>
          <button
            v-else
            class="px-2 py-1 rounded text-xs border border-border hover:bg-accent transition-colors"
            @click="reconnectController(inst.id)"
          >
            Reconnect
          </button>

          <button
            class="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
            title="Entfernen"
            @click="removeController(inst.id, inst.definitionKey)"
          >
            <Trash2 :size="14" />
          </button>
        </div>
      </div>

      <!-- Remote controllers: read-only view of what other tabs/users have open -->
      <template v-if="remoteControllers.length">
        <div class="mt-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Andere Sessions
        </div>
        <div
          v-for="entry in remoteControllers"
          :key="`${entry.presence.sessionId}:${entry.controller.id}`"
          class="flex items-center gap-3 px-3 py-2 rounded border border-border/60 bg-muted/20 text-sm"
        >
          <CircleDot :size="14" :class="statusColor[entry.controller.status]" />
          <div class="flex-1 min-w-0">
            <div class="font-medium flex items-center gap-1.5 truncate">
              <Gamepad2 :size="12" class="text-muted-foreground" />
              {{ entry.controller.deviceLabel ?? controllerLabelFor(entry.controller.definitionKey) }}
            </div>
            <div class="text-xs text-muted-foreground capitalize flex items-center gap-1.5">
              <span
                class="inline-block size-2 rounded-full"
                :style="{ backgroundColor: entry.presence.color }"
              />
              <span>{{ entry.presence.displayName || 'Unbekannt' }}</span>
              <span>·</span>
              <span>{{ entry.controller.status }}</span>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- Universe overview -->
    <div v-if="totalUniverses > 0" class="px-3 py-2.5 rounded border border-border bg-background text-sm">
      <div class="flex items-center gap-2 mb-2">
        <Network :size="14" class="text-muted-foreground" />
        <span class="font-medium text-xs">Universes</span>
        <span class="text-xs text-muted-foreground">{{ usedUniverses.length }} used / {{ totalUniverses }} total</span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="u in totalUniverses"
          :key="u"
          class="px-2 py-0.5 rounded text-xs border"
          :class="isUniverseUsed(u)
            ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
            : 'border-border text-muted-foreground'"
        >
          U{{ u }}
        </span>
      </div>
    </div>

    <template v-if="connectionsTab === 'outputs'">
    <p v-if="!store.connectors.length" class="text-sm text-muted-foreground py-6">
      No connectors added yet.
    </p>

    <div
      v-for="connector in store.connectors"
      :key="connector.id"
      class="flex flex-col gap-2 px-3 py-2.5 rounded border border-border bg-background text-sm"
    >
      <!-- Header row -->
      <div class="flex items-center gap-3">
        <CircleDot :size="14" :class="statusColor[connector.status.value]" />

        <div class="flex-1 min-w-0">
          <div class="font-medium">{{ connector.meta.label }}</div>
          <div v-if="connector.errorMessage.value" class="text-xs text-red-400 truncate">
            {{ connector.errorMessage.value }}
          </div>
          <div v-else class="text-xs text-muted-foreground capitalize">
            {{ connector.status.value }}
          </div>
        </div>

        <!-- Version badge -->
        <template v-if="asSerial(connector) && connector.status.value === 'connected'">
          <span
            v-if="asSerial(connector)!.firmwareVersion.value && !asSerial(connector)!.updateAvailable.value"
            class="text-xs text-muted-foreground"
          >
            v{{ asSerial(connector)!.firmwareVersion.value }}
            <span class="text-green-400/80">✓</span>
          </span>
          <span v-else-if="!asSerial(connector)!.firmwareVersion.value" class="text-xs text-muted-foreground">v—</span>
        </template>

        <button
          v-if="connector.status.value === 'connected' && !asSerial(connector)?.isFlashing.value"
          class="px-2 py-1 rounded text-xs border border-border hover:bg-accent transition-colors"
          @click="connector.disconnect()"
        >
          Disconnect
        </button>
        <button
          v-else-if="connector.status.value !== 'connected'"
          class="px-2 py-1 rounded text-xs border border-border hover:bg-accent transition-colors"
          :disabled="connector.status.value === 'connecting'"
          @click="connector.connect()"
        >
          Connect
        </button>

        <button
          v-if="asSerial(connector) && asSerial(connector)!.latestBinUrl.value"
          class="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Force firmware update"
          @click="asSerial(connector)!.flashFirmware()"
        >
          <RefreshCw :size="14" />
        </button>

        <button
          class="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          @click="store.remove(connector.id)"
        >
          <Trash2 :size="14" />
        </button>
      </div>

      <!-- Expandable outputs section -->
      <button
        v-if="connector.outputCount > 0"
        class="flex items-center gap-2 px-1 py-1 rounded hover:bg-accent/50 transition-colors w-full text-left"
        @click="toggleExpanded(connector.id)"
      >
        <ChevronDown v-if="expandedConnectors.has(connector.id)" :size="14" class="text-muted-foreground" />
        <ChevronRight v-else :size="14" class="text-muted-foreground" />
        <span class="text-xs font-medium text-muted-foreground">Outputs</span>
        <span class="text-xs text-muted-foreground">({{ assignedCount(connector) }}/{{ connector.outputCount }} assigned)</span>
      </button>

      <!-- Output mapping rows (collapsible) -->
      <div v-if="expandedConnectors.has(connector.id) && connector.outputCount > 0" class="px-1 pt-1 flex flex-col gap-1">
        <div
          v-for="(_, i) in connector.outputCount"
          :key="i"
          class="flex items-center gap-2"
        >
          <span class="text-xs text-muted-foreground w-14">Out {{ i + 1 }}</span>
          <select
            class="flex-1 rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
            :value="connector.outputMapping.value[i] ?? 0"
            @change="connector.setOutputUniverse(i, Number(($event.target as HTMLSelectElement).value))"
          >
            <option :value="0">— none —</option>
            <option
              v-for="u in totalUniverses"
              :key="u"
              :value="u"
            >
              U{{ u }}{{ isUniverseUsed(u) ? '' : ' (unused)' }}
            </option>
          </select>
        </div>
      </div>

      <!-- Firmware flash progress -->
      <div
        v-if="asSerial(connector) && asSerial(connector)!.isFlashing.value"
        class="px-1"
      >
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs text-muted-foreground">Flashing firmware…</span>
          <span class="text-xs text-muted-foreground">{{ asSerial(connector)!.flashProgress.value }}%</span>
        </div>
        <div class="h-1 rounded bg-border overflow-hidden">
          <div
            class="h-full bg-blue-400 transition-all duration-200"
            :style="{ width: asSerial(connector)!.flashProgress.value + '%' }"
          />
        </div>
      </div>

      <!-- Outdated firmware warning -->
      <div
        v-else-if="asSerial(connector) && connector.status.value === 'connected' && asSerial(connector)!.updateAvailable.value"
        class="px-2 py-2 rounded border border-red-500/40 bg-red-500/10"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-xs font-medium text-red-400">Firmware outdated</div>
            <div class="text-xs text-red-400/70 mt-0.5 leading-relaxed">
              Device runs engine v{{ asSerial(connector)!.firmwareVersion.value }} —
              some effects may not work correctly.
              Update to v{{ asSerial(connector)!.latestVersion.value }}.
            </div>
          </div>
          <button
            class="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs
                   bg-red-500/20 text-red-300 border border-red-500/40
                   hover:bg-red-500/30 transition-colors"
            @click="asSerial(connector)!.flashFirmware()"
          >
            <ArrowUpCircle :size="12" />
            Update
          </button>
        </div>
      </div>
    </div>
    </template><!-- end outputs tab -->
  </div>
</template>
