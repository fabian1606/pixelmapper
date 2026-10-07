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
import { WebSocketConnector, type FixtureSlot } from '~/utils/connectors/websocket-connector';
import { ArtNetConnector } from '~/utils/connectors/artnet-connector';
import { EspNowBridgeConnector } from '~/utils/connectors/espnow-bridge-connector';
import type { BaseConnector } from '~/utils/connectors/base-connector';
import { SetFixtureKindConfigCommand } from '~/components/engine/commands/set-fixture-kind-config-command';
import { stripOf, stripPixelCount, type StripKindView } from '~/utils/connectors/strip-kind';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Json } from '@pixelmapper/extension-api';
import {
  AddConnectorCommand,
  RemoveConnectorCommand,
  UpdateConnectorConfigCommand,
} from '~/components/engine/commands/connector-commands';
import EspWebFlasher from '~/components/connectors/EspWebFlasher.vue';

// ID of the connector currently being configured via the USB wizard.
// null = wizard closed. Single wizard instance, target picked per click.
const wizardConnectorId = ref<string | null>(null);

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

function addConnector(type: 'websocket' | 'serial' | 'artnet' | 'espnow-bridge') {
  const entry = OUTPUT_CONNECTOR_REGISTRY.find(e => e.type === type);
  if (!entry) return;
  const id = crypto.randomUUID();
  history.execute(new AddConnectorCommand(id, type));
  // WebSocket connector starts useless without a hostname — open the wizard
  // immediately so the user has one continuous flow ("click + → set up →
  // ready") instead of two clicks and a confused-empty-card-in-between.
  if (type === 'websocket') wizardConnectorId.value = id;
}

function removeConnector(connector: BaseConnector) {
  history.execute(new RemoveConnectorCommand(
    connector.id,
    connector.meta.type as 'websocket' | 'serial' | 'artnet' | 'espnow-bridge',
    connector.getConfig(),
  ));
}

/**
 * Dispatch a partial config update on a connector. Merges the patch onto
 * the current getConfig() result and goes through the command system so the
 * change lands in the project_changes tail (and the undo stack).
 */
function patchConnector(connector: BaseConnector, patch: Record<string, unknown>) {
  history.execute(new UpdateConnectorConfigCommand(
    connector.id,
    { ...connector.getConfig(), ...patch },
  ));
}

/** Build a new outputMapping array with one slot replaced. */
function nextOutputMapping(connector: BaseConnector, index: number, universe: number): number[] {
  const next = connector.outputMapping.value.slice();
  next[index] = universe;
  return next;
}

/**
 * Human-readable status. Folds the autoReconnect-while-connecting case into a
 * dedicated label so the user knows the connector is actively retrying rather
 * than stuck.
 */
function statusLabel(connector: BaseConnector): string {
  const s = connector.status.value;
  if (s === 'connecting' && connector.autoReconnect.value) return 'neu verbinden…';
  if (s === 'connecting') return 'verbinden…';
  if (s === 'connected')  return 'verbunden';
  if (s === 'error')      return 'Fehler';
  return 'getrennt';
}

function asSerial(c: BaseConnector): SerialConnector | null {
  return c instanceof SerialConnector ? c : null;
}

function asWebSocket(c: BaseConnector): WebSocketConnector | null {
  return c instanceof WebSocketConnector ? c : null;
}

function asArtNet(c: BaseConnector): ArtNetConnector | null {
  return c instanceof ArtNetConnector ? c : null;
}

function asEspNowBridge(c: BaseConnector): EspNowBridgeConnector | null {
  return c instanceof EspNowBridgeConnector ? c : null;
}

/** All LED-strip fixtures in the project, available for binding to a WebSocketConnector. */
const stripFixtures = computed(() =>
  engineStore.flatFixtures.filter(f => stripOf(f))
);

/** All fixtures, available as ESP-NOW bridge broadcast source. */
const allFixtures = computed(() => engineStore.flatFixtures);

function fixtureFor(connector: WebSocketConnector) {
  const id = connector.fixtureId;
  if (id == null) return null;
  return engineStore.flatFixtures.find(f => String(f.id) === String(id)) ?? null;
}

function fixtureForSlot(connector: WebSocketConnector, slotIndex: number) {
  const id = connector.fixtureSlots.value[slotIndex]?.fixtureId;
  if (id == null) return null;
  return engineStore.flatFixtures.find(f => String(f.id) === String(id)) ?? null;
}

function updateSlotFixture(connector: WebSocketConnector, slotIndex: number, fixtureId: string | null) {
  const slots = connector.fixtureSlots.value.slice();
  if (slots[slotIndex]) {
    slots[slotIndex] = { ...slots[slotIndex]!, fixtureId: fixtureId ?? '' };
  }
  patchConnector(connector, { fixtureSlots: slots });
}

function updateSlotPin(connector: WebSocketConnector, slotIndex: number, pin: number | null) {
  const slots = connector.fixtureSlots.value.slice();
  if (slots[slotIndex]) {
    slots[slotIndex] = { ...slots[slotIndex]!, pin };
    // Bei gemeinsamem Pin: Offset automatisch auf die Summe der LEDs der
    // vorherigen Slots an diesem Pin vorschlagen (editierbar). Übersprungen,
    // sobald der User den Offset bereits manuell gesetzt hat (>0).
    if (pin != null && !slots[slotIndex]!.ledOffset) {
      slots[slotIndex] = { ...slots[slotIndex]!, ledOffset: computeSuggestedOffset(slots, slotIndex, pin) };
    }
  }
  patchConnector(connector, { fixtureSlots: slots });
}

function updateSlotOffset(connector: WebSocketConnector, slotIndex: number, offset: number | null) {
  const slots = connector.fixtureSlots.value.slice();
  if (slots[slotIndex]) {
    slots[slotIndex] = { ...slots[slotIndex]!, ledOffset: Math.max(0, Math.round(offset ?? 0)) };
  }
  patchConnector(connector, { fixtureSlots: slots });
}

/** LED-Anzahl der Fixture eines Slots (0, falls nicht aufgelöst). */
function slotLedCount(connector: WebSocketConnector, slotIndex: number): number {
  return stripOf(fixtureForSlot(connector, slotIndex))?.ledCount ?? 0;
}

/**
 * Vorgeschlagener Start-LED-Offset für einen Slot: Summe der LED-Anzahl aller
 * vorherigen Slots, die denselben Pin verwenden (= sie liegen vor diesem Strip
 * auf der gemeinsamen Datenleitung).
 */
function computeSuggestedOffset(slots: FixtureSlot[], slotIndex: number, pin: number): number {
  let sum = 0;
  for (let i = 0; i < slotIndex; i++) {
    if (slots[i]?.pin === pin) {
      const fx = engineStore.flatFixtures.find(f => String(f.id) === String(slots[i]!.fixtureId));
      sum += stripOf(fx)?.ledCount ?? 0;
    }
  }
  return sum;
}

/** Anzahl Slots am Connector, die diesen Pin teilen. */
function slotsSharingPin(connector: WebSocketConnector, pin: number | null): number {
  if (pin == null) return 0;
  return connector.fixtureSlots.value.filter(s => s.pin === pin).length;
}

/**
 * Überlappungs-Warnung: true, wenn dieser Slot mit einem anderen Slot am selben
 * Pin überlappt (LED-Bereiche überschneiden sich).
 */
function slotOverlaps(connector: WebSocketConnector, slotIndex: number): boolean {
  const slots = connector.fixtureSlots.value;
  const slot = slots[slotIndex];
  if (!slot || slot.pin == null) return false;
  const offset = slot.ledOffset ?? 0;
  const end = offset + slotLedCount(connector, slotIndex);
  for (let i = 0; i < slots.length; i++) {
    if (i === slotIndex || slots[i]?.pin !== slot.pin) continue;
    const otherOffset = slots[i]!.ledOffset ?? 0;
    const otherEnd = otherOffset + slotLedCount(connector, i);
    if (offset < otherEnd && otherOffset < end) return true;
  }
  return false;
}

function addSlot(connector: WebSocketConnector) {
  const slots = [...connector.fixtureSlots.value, { fixtureId: '', pin: null, ledOffset: 0 }];
  patchConnector(connector, { fixtureSlots: slots });
}

function removeSlot(connector: WebSocketConnector, slotIndex: number) {
  const slots = connector.fixtureSlots.value.slice();
  slots.splice(slotIndex, 1);
  patchConnector(connector, { fixtureSlots: slots });
}

/**
 * Merges a patch into a strip fixture's kind config as one undo step
 * (core SetFixtureKindConfig). A new shape clears the points so the kind
 * regenerates default geometry.
 */
function patchStrip(f: Fixture | null, patch: Partial<StripKindView>) {
  const current = stripOf(f);
  if (!f?.kind || !current) return;
  if ((Object.keys(patch) as (keyof StripKindView)[]).every(k => patch[k] === current[k])) return;
  const before = f.kind.config as Json;
  const after = { ...(before as Record<string, Json>), ...patch, ...(patch.shapeType ? { points: [] } : {}) } as Json;
  history.execute(new SetFixtureKindConfigCommand(engineStore.flatFixtures, f.id, before, after, `Edit ${f.name}`));
  engineStore.flushEngineOutput();
}

function commitStripPatchForSlot(connector: WebSocketConnector, slotIndex: number, patch: Partial<StripKindView>) {
  patchStrip(fixtureForSlot(connector, slotIndex), patch);
}

// Sum of logical pixels (= ceil(ledCount/groupSize)) across all strip slots of a
// connector. This is the real driver of ESP32 RAM usage — each logical pixel
// becomes ~3 render targets in the engine. Heavy pixel counts (esp. with Bezier
// SpeedCurve effects) can exhaust the ESP32-S3 heap and crash it.
const WARN_PIXEL_THRESHOLD = 600;
const HARD_PIXEL_THRESHOLD = 1000;

function connectorLogicalPixels(connector: WebSocketConnector): number {
  let total = 0;
  const slots = connector.fixtureSlots.value;
  for (let i = 0; i < slots.length; i++) {
    const f = fixtureForSlot(connector, i);
    const sc = stripOf(f);
    if (sc) total += stripPixelCount(sc);
  }
  return total;
}

/** 'none' | 'warn' | 'hard' depending on total logical pixels. */
function connectorPixelSeverity(connector: WebSocketConnector): 'none' | 'warn' | 'hard' {
  const n = connectorLogicalPixels(connector);
  if (n > HARD_PIXEL_THRESHOLD) return 'hard';
  if (n > WARN_PIXEL_THRESHOLD) return 'warn';
  return 'none';
}

function commitStripShapeForSlot(connector: WebSocketConnector, slotIndex: number, newShape: StripKindView['shapeType']) {
  patchStrip(fixtureForSlot(connector, slotIndex), { shapeType: newShape });
}

function commitStripClockwiseForSlot(connector: WebSocketConnector, slotIndex: number, cw: boolean) {
  patchStrip(fixtureForSlot(connector, slotIndex), { clockwise: cw });
}

function commitStripShape(connector: WebSocketConnector, newShape: StripKindView['shapeType']) {
  patchStrip(fixtureFor(connector), { shapeType: newShape });
}

function commitStripClockwise(connector: WebSocketConnector, cw: boolean) {
  patchStrip(fixtureFor(connector), { clockwise: cw });
}

function commitStripPatch(connector: WebSocketConnector, patch: Partial<StripKindView>) {
  patchStrip(fixtureFor(connector), patch);
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
        class="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border border-border bg-background hover:bg-accent transition-colors"
        @click="addConnector('serial')"
      >
        <Plus :size="12" />
        USB Serial (ESP32)
      </button>
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border border-blue-500/40 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 transition-colors"
        @click="addConnector('websocket')"
      >
        <Plus :size="12" />
        WebSocket LED-Strip ESP32-S3
      </button>
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border border-border bg-background hover:bg-accent transition-colors"
        @click="addConnector('artnet')"
      >
        <Plus :size="12" />
        ArtNet (lokale Bridge)
      </button>
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border border-purple-500/40 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 transition-colors"
        @click="addConnector('espnow-bridge')"
      >
        <Plus :size="12" />
        ESP-NOW USB-Bridge
      </button>
    </div>

    <EspWebFlasher
      v-if="wizardConnectorId"
      :connector-id="wizardConnectorId"
      @close="wizardConnectorId = null"
    />


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
          <div class="font-medium font-mono text-sm">
            {{ asWebSocket(connector)?.label.value || asArtNet(connector)?.label.value || connector.meta.label }}
          </div>
          <div v-if="connector.errorMessage.value" class="text-xs text-red-400 truncate">
            {{ connector.errorMessage.value }}
          </div>
          <div v-else class="text-xs text-muted-foreground">
            {{ statusLabel(connector) }}
          </div>
        </div>

        <!-- Version badge (serial only) -->
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

        <!-- WebSocket: Einrichten button -->
        <button
          v-if="asWebSocket(connector)"
          class="px-2 py-1 rounded text-xs border border-border hover:bg-accent transition-colors"
          title="Via USB konfigurieren"
          @click="wizardConnectorId = connector.id"
        >
          Einrichten
        </button>

        <!--
          "Trennen" shows whenever the connector is actively trying to stay
          connected — either currently connected OR mid-retry-loop. That's the
          only way for the user to stop the 2 s retry cycle.
        -->
        <button
          v-if="(connector.status.value === 'connected' || connector.autoReconnect.value) && !asSerial(connector)?.isFlashing.value"
          class="px-2 py-1 rounded text-xs border border-border hover:bg-accent transition-colors"
          @click="connector.disconnect()"
        >
          Trennen
        </button>
        <!--
          "Verbinden" only appears when we're idle (not connected, not retrying).
          During retries it would do nothing useful since connect() is already
          being called on a timer.
        -->
        <button
          v-else-if="connector.status.value !== 'connected' && !connector.autoReconnect.value"
          class="px-2 py-1 rounded text-xs border transition-colors"
          :class="asWebSocket(connector) && !asWebSocket(connector)!.url.value
            ? 'border-border/40 text-muted-foreground/40 cursor-not-allowed'
            : 'border-blue-500/40 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20'"
          :disabled="connector.status.value === 'connecting' || (!!asWebSocket(connector) && !asWebSocket(connector)!.url.value)"
          :title="asWebSocket(connector) && !asWebSocket(connector)!.url.value ? 'Bitte zuerst eine URL eingeben oder Gerät einrichten' : undefined"
          @click="connector.connect()"
        >
          Verbinden
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
          @click="removeConnector(connector)"
        >
          <Trash2 :size="14" />
        </button>
      </div>

      <!-- WebSocketConnector settings: URL + Fixture-Slot binding -->
      <div
        v-if="asWebSocket(connector)"
        class="flex flex-col gap-1.5 px-1"
      >
        <label class="text-xs text-muted-foreground">
          WebSocket-URL
          <input
            type="text"
            class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring font-mono"
            placeholder="ws://pixelmapper-strip-XXXX.local/ws"
            :value="asWebSocket(connector)!.url.value"
            :disabled="connector.status.value === 'connected' || connector.status.value === 'connecting'"
            @change="patchConnector(connector, { url: ($event.target as HTMLInputElement).value })"
          />
        </label>

        <!-- Per-Slot: Fixture + GPIO-Pin -->
        <div
          v-for="(slot, slotIndex) in asWebSocket(connector)!.fixtureSlots.value"
          :key="slotIndex"
          class="flex flex-col gap-1 pt-1 border-t border-border/30 mt-0.5"
        >
          <div class="flex items-center justify-between gap-1">
            <span class="text-xs text-muted-foreground font-medium">
              Streifen {{ asWebSocket(connector)!.fixtureSlots.value.length > 1 ? slotIndex + 1 : '' }}
            </span>
            <button
              v-if="asWebSocket(connector)!.fixtureSlots.value.length > 1"
              class="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Streifen entfernen"
              @click="removeSlot(asWebSocket(connector)!, slotIndex)"
            >
              <Trash2 :size="12" />
            </button>
          </div>
          <div class="flex gap-1.5 items-end">
            <label class="text-xs text-muted-foreground flex-1 min-w-0">
              Strip-Fixture
              <select
                class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                :value="String(slot.fixtureId ?? '')"
                @change="updateSlotFixture(asWebSocket(connector)!, slotIndex, ($event.target as HTMLSelectElement).value || null)"
              >
                <option value="">— keine —</option>
                <option
                  v-for="f in stripFixtures"
                  :key="String(f.id)"
                  :value="String(f.id)"
                >
                  {{ f.name || `Fixture ${f.id}` }}
                  ({{ stripOf(f)?.ledCount }} LEDs)
                </option>
              </select>
            </label>
            <label class="text-xs text-muted-foreground w-16 shrink-0">
              GPIO-Pin
              <input
                type="number"
                min="0" max="48" step="1"
                placeholder="—"
                class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                :value="slot.pin ?? ''"
                @change="updateSlotPin(asWebSocket(connector)!, slotIndex, ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null)"
              />
            </label>
            <!-- Start-LED-Offset: nur relevant, wenn mehrere Strips denselben Pin teilen -->
            <label
              v-if="slotsSharingPin(asWebSocket(connector)!, slot.pin) > 1"
              class="text-xs text-muted-foreground w-16 shrink-0"
              title="Start-LED dieses Strips auf der gemeinsamen Datenleitung"
            >
              ab LED
              <input
                type="number"
                min="0" step="1"
                class="mt-1 w-full rounded border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                :class="slotOverlaps(asWebSocket(connector)!, slotIndex) ? 'border-red-400 text-red-400' : 'border-border'"
                :value="slot.ledOffset ?? 0"
                @change="updateSlotOffset(asWebSocket(connector)!, slotIndex, ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : 0)"
              />
            </label>
          </div>

          <!-- Hinweis: geteilte Datenleitung -->
          <p
            v-if="slot.pin != null && slotsSharingPin(asWebSocket(connector)!, slot.pin) > 1"
            class="text-[10px]"
            :class="slotOverlaps(asWebSocket(connector)!, slotIndex) ? 'text-red-400' : 'text-muted-foreground'"
          >
            <template v-if="slotOverlaps(asWebSocket(connector)!, slotIndex)">
              ⚠ LED-Bereich überlappt mit einem anderen Streifen an Pin {{ slot.pin }}.
            </template>
            <template v-else>
              Geteilte Datenleitung (Pin {{ slot.pin }}): Streifen ab LED {{ slot.ledOffset ?? 0 }}–{{ (slot.ledOffset ?? 0) + slotLedCount(asWebSocket(connector)!, slotIndex) }}.
            </template>
          </p>

          <!-- Strip parameter editor for this slot -->
          <template v-if="fixtureForSlot(asWebSocket(connector)!, slotIndex)">
            <div class="grid grid-cols-3 gap-2 pt-1">
              <label class="text-xs text-muted-foreground">
                LED-Anzahl
                <input
                  type="number"
                  min="1" max="2048" step="1"
                  class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                  :value="stripOf(fixtureForSlot(asWebSocket(connector)!, slotIndex))?.ledCount ?? 0"
                  @change="commitStripPatchForSlot(asWebSocket(connector)!, slotIndex, { ledCount: Number(($event.target as HTMLInputElement).value) })"
                />
                <span
                  v-if="stripOf(fixtureForSlot(asWebSocket(connector)!, slotIndex))"
                  class="mt-0.5 block text-[10px] text-muted-foreground/70"
                >
                  {{ stripPixelCount(stripOf(fixtureForSlot(asWebSocket(connector)!, slotIndex))!) }} log. Pixel
                </span>
              </label>
              <label class="text-xs text-muted-foreground">
                Gruppe
                <input
                  type="number"
                  min="1" max="64" step="1"
                  class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                  :value="stripOf(fixtureForSlot(asWebSocket(connector)!, slotIndex))?.groupSize ?? 1"
                  @change="commitStripPatchForSlot(asWebSocket(connector)!, slotIndex, { groupSize: Number(($event.target as HTMLInputElement).value) })"
                />
              </label>
              <label class="text-xs text-muted-foreground">
                LEDs/m
                <input
                  type="number"
                  min="1" max="500" step="1"
                  class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                  :value="stripOf(fixtureForSlot(asWebSocket(connector)!, slotIndex))?.ledsPerMeter ?? 60"
                  @change="commitStripPatchForSlot(asWebSocket(connector)!, slotIndex, { ledsPerMeter: Number(($event.target as HTMLInputElement).value) })"
                />
              </label>
            </div>
            <label class="text-xs text-muted-foreground">
              Shape
              <select
                class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                :value="stripOf(fixtureForSlot(asWebSocket(connector)!, slotIndex))?.shapeType ?? 'bezier'"
                @change="commitStripShapeForSlot(asWebSocket(connector)!, slotIndex, ($event.target as HTMLSelectElement).value as StripKindView['shapeType'])"
              >
                <option value="bezier">Bezier Curve</option>
                <option value="line">Straight Line</option>
                <option value="circle">Circle</option>
              </select>
            </label>
            <template v-if="stripOf(fixtureForSlot(asWebSocket(connector)!, slotIndex))?.shapeType === 'circle'">
              <label class="text-xs text-muted-foreground">
                Direction
                <div class="flex gap-1 mt-1">
                  <button
                    type="button"
                    class="flex-1 rounded border text-xs py-1 transition-colors"
                    :class="(stripOf(fixtureForSlot(asWebSocket(connector)!, slotIndex))?.clockwise ?? true)
                      ? 'bg-primary/15 border-primary/40 text-primary'
                      : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/60'"
                    @click="commitStripClockwiseForSlot(asWebSocket(connector)!, slotIndex, true)"
                  >CW</button>
                  <button
                    type="button"
                    class="flex-1 rounded border text-xs py-1 transition-colors"
                    :class="!(stripOf(fixtureForSlot(asWebSocket(connector)!, slotIndex))?.clockwise ?? true)
                      ? 'bg-primary/15 border-primary/40 text-primary'
                      : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/60'"
                    @click="commitStripClockwiseForSlot(asWebSocket(connector)!, slotIndex, false)"
                  >CCW</button>
                </div>
              </label>
            </template>
          </template>
        </div>

        <!-- Add strip slot button -->
        <button
          class="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-1 py-0.5 rounded hover:bg-accent transition-colors self-start"
          @click="addSlot(asWebSocket(connector)!)"
        >
          <Plus :size="12" />
          Streifen hinzufügen
        </button>

        <!-- LED count / RAM warning -->
        <div
          v-if="connectorPixelSeverity(asWebSocket(connector)!) !== 'none'"
          class="mt-1 rounded border px-2 py-1.5 text-xs leading-relaxed"
          :class="connectorPixelSeverity(asWebSocket(connector)!) === 'hard'
            ? 'border-orange-500/40 bg-orange-500/10 text-orange-300'
            : 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300'"
        >
          <span class="font-medium">{{ connectorLogicalPixels(asWebSocket(connector)!) }} logische Pixel</span>
          <template v-if="connectorPixelSeverity(asWebSocket(connector)!) === 'hard'">
            — sehr hoch. Der ESP32 kann hier (v.a. mit Bezier/SpeedCurve-Effekten)
            instabil werden oder abstürzen. Reduziere die LED-Anzahl oder erhöhe die
            Gruppengröße. Über LAN/Ethernet ist mehr möglich als über WLAN.
          </template>
          <template v-else>
            — am Limit. Über WLAN können hier Aussetzer auftreten; erhöhe die
            Gruppengröße, falls der ESP abstürzt.
          </template>
        </div>

        <div class="flex items-center gap-3 flex-wrap mt-0.5">
          <div
            v-if="asWebSocket(connector)!.firmwareVersion.value"
            class="text-xs text-muted-foreground"
          >
            Firmware: v{{ asWebSocket(connector)!.firmwareVersion.value }}
          </div>
          <div class="text-xs text-muted-foreground flex items-center gap-1">
            Data-Pin:
            <span class="font-mono">
              {{ asWebSocket(connector)!.devicePin.value != null ? asWebSocket(connector)!.devicePin.value : '—' }}
            </span>
            <button
              class="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-muted/40 hover:bg-muted/70 border border-border/50 transition-colors"
              title="Pin via USB-Serial ändern"
              @click="wizardConnectorId = connector.id"
            >ändern</button>
          </div>
        </div>
        <p v-if="!stripFixtures.length" class="text-xs text-yellow-400/80">
          Es gibt noch keine LED-Strip-Fixture in dieser Szene.
        </p>
      </div>

      <!-- ArtNetConnector settings: Bridge-URL, Ziel-IP, Port, Universe-Anzahl -->
      <div
        v-if="asArtNet(connector)"
        class="flex flex-col gap-1.5 px-1"
      >
        <label class="text-xs text-muted-foreground">
          Label
          <input
            type="text"
            class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="z. B. Bühne West"
            :value="asArtNet(connector)!.label.value"
            @change="patchConnector(connector, { label: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label class="text-xs text-muted-foreground">
          Bridge-URL
          <input
            type="text"
            class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring font-mono"
            placeholder="ws://localhost:7777"
            :value="asArtNet(connector)!.bridgeUrl.value"
            :disabled="connector.status.value === 'connected' || connector.status.value === 'connecting'"
            @change="patchConnector(connector, { bridgeUrl: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <div class="flex gap-1.5">
          <label class="text-xs text-muted-foreground flex-1">
            ArtNet-Ziel-IP
            <input
              type="text"
              class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring font-mono"
              placeholder="2.255.255.255"
              :value="asArtNet(connector)!.targetIp.value"
              @change="patchConnector(connector, { targetIp: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <label class="text-xs text-muted-foreground w-20 shrink-0">
            Port
            <input
              type="number"
              min="1" max="65535" step="1"
              class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring font-mono"
              :value="asArtNet(connector)!.artnetPort.value"
              @change="patchConnector(connector, { artnetPort: Number(($event.target as HTMLInputElement).value) })"
            />
          </label>
          <label class="text-xs text-muted-foreground w-24 shrink-0">
            Universes
            <input
              type="number"
              min="1" max="64" step="1"
              class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
              :value="asArtNet(connector)!.outputCount"
              @change="patchConnector(connector, { outputCount: Number(($event.target as HTMLInputElement).value) })"
            />
          </label>
        </div>
        <p class="text-[10px] text-muted-foreground/80 leading-snug">
          Die ArtNet-Bridge muss lokal laufen (z. B. <span class="font-mono">bun run artnet-bridge</span>) und leitet Pakete an die obige Ziel-IP weiter.
        </p>

        <!-- Bridge log output -->
        <div
          v-if="asArtNet(connector)!.logs.length"
          class="mt-1 rounded border border-border/50 bg-muted/20 overflow-y-auto max-h-28 px-2 py-1.5 flex flex-col gap-0.5"
        >
          <div
            v-for="(line, i) in asArtNet(connector)!.logs.slice().reverse()"
            :key="i"
            class="text-[10px] font-mono leading-tight"
            :class="line.text.includes('failed') || line.text.includes('error') || line.text.includes('Error')
              ? 'text-red-400'
              : 'text-muted-foreground'"
          >
            {{ line.text }}
          </div>
        </div>
      </div>

      <!-- EspNowBridgeConnector settings: zugewiesene Fixture + Empfänger-ID -->
      <div
        v-if="asEspNowBridge(connector)"
        class="flex flex-col gap-1.5 px-1"
      >
        <label class="text-xs text-muted-foreground">
          Label
          <input
            type="text"
            class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="z. B. Publikum-Bridge"
            :value="asEspNowBridge(connector)!.label.value"
            @change="patchConnector(connector, { label: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label class="text-xs text-muted-foreground">
          Scheinwerfer (Farbquelle)
          <select
            class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
            :value="asEspNowBridge(connector)!.fixtureId.value != null ? String(asEspNowBridge(connector)!.fixtureId.value) : ''"
            @change="patchConnector(connector, { fixtureId: ($event.target as HTMLSelectElement).value || null })"
          >
            <option value="">— keiner —</option>
            <option
              v-for="f in allFixtures"
              :key="String(f.id)"
              :value="String(f.id)"
            >
              {{ f.name || `Fixture ${f.id}` }}
            </option>
          </select>
        </label>
        <p class="text-[10px] text-muted-foreground/80 leading-snug">
          Sendet R/G/B + Dimmer der zugewiesenen Fixture als 4-Byte ColorCommand per ESP-NOW Broadcast (FF:FF:FF:FF:FF:FF). Publikum-ESPs ohne WLAN leuchten so mit.
        </p>

        <!-- Bridge log output -->
        <div
          v-if="asEspNowBridge(connector)!.logs.length"
          class="mt-1 rounded border border-border/50 bg-muted/20 overflow-y-auto max-h-28 px-2 py-1.5 flex flex-col gap-0.5"
        >
          <div
            v-for="(line, i) in asEspNowBridge(connector)!.logs.slice().reverse()"
            :key="i"
            class="text-[10px] font-mono leading-tight"
            :class="line.text.includes('failed') || line.text.includes('error')
              ? 'text-red-400'
              : 'text-muted-foreground'"
          >
            {{ line.text }}
          </div>
        </div>
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
          <span class="text-xs text-muted-foreground w-14">Out {{ asArtNet(connector) ? i : i + 1 }}</span>
          <select
            class="flex-1 rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
            :value="connector.outputMapping.value[i] ?? 0"
            @change="patchConnector(connector, { outputMapping: nextOutputMapping(connector, i, Number(($event.target as HTMLSelectElement).value)) })"
          >
            <option :value="0">— none —</option>
            <option
              v-for="u in totalUniverses"
              :key="u"
              :value="u"
            >
              U{{ asArtNet(connector) ? u - 1 : u }}{{ isUniverseUsed(u) ? '' : ' (unused)' }}
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
