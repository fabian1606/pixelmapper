<script setup lang="ts">
/**
 * Connections: output connectors (from extensions, per user/device — ADR
 * D17/D18) and hardware controller inputs.
 */
import { CircleDot, Plus, Trash2, Network, Gamepad2, PlugZap } from 'lucide-vue-next';
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
import { listConnectorTypes } from '~/utils/connectors/connector-registry';
import ConnectorCard from '~/components/connectors/ConnectorCard.vue';
import ExtensionSlot from '~/components/extension-host/ExtensionSlot.vue';

// Same layout as Design/Live: keeps the header and the loaded project across tab switches.
definePageMeta({ layout: 'project' });

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

const statusColor: Record<string, string> = {
  disconnected: 'text-muted-foreground',
  connecting: 'text-yellow-400',
  connected: 'text-green-400',
  error: 'text-red-400',
};

/** Output connector types contributed by extensions. */
const outputTypes = computed(() => listConnectorTypes('output'));

/** Adds a connector instance of a type (persisted per user/device). */
function addConnector(type: string) {
  const reg = outputTypes.value.find(t => t.def.type === type);
  if (!reg) return;
  store.add(reg.def.create(crypto.randomUUID()));
}

/** Check if a universe is used by any fixture. */
function isUniverseUsed(u: number): boolean {
  return usedUniverses.value.includes(u);
}
</script>

<template>
  <!-- Scroll container: the project layout gives the page a fixed-height slot -->
  <div class="h-full overflow-y-auto">
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

    <!-- Add connector buttons: one per type contributed by extensions -->
    <div v-if="connectionsTab === 'outputs'" class="flex gap-2 flex-wrap">
      <button
        v-for="t in outputTypes"
        :key="t.def.type"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border border-border bg-background hover:bg-accent transition-colors"
        :title="t.def.description"
        @click="addConnector(t.def.type)"
      >
        <Plus :size="12" />
        {{ t.def.label }}
      </button>
      <p v-if="!outputTypes.length" class="text-xs text-muted-foreground">No output extensions installed.</p>
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
      <!-- Extension slot above the output connectors (e.g. devices found on the network) -->
      <ExtensionSlot id="connections/outputs:before" />
      <p v-if="!store.connectors.length" class="text-sm text-muted-foreground py-6">
        No connectors added yet. Connector setups are stored for your account on this device.
      </p>
      <ConnectorCard v-for="connector in store.connectors" :key="connector.id" :connector="connector" />
    </template><!-- end outputs tab -->
  </div>
  </div>
</template>
