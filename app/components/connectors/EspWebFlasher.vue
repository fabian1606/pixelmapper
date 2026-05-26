<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';
import { X, Usb, Settings as SettingsIcon, CheckCircle2, AlertTriangle, Terminal } from 'lucide-vue-next';
import { useConnectionsStore } from '~/stores/connections-store';
import { WebSocketConnector } from '~/utils/connectors/websocket-connector';
import { useHistory } from '~/components/engine/composables/use-history';
import { UpdateConnectorConfigCommand } from '~/components/engine/commands/connector-commands';

const props = defineProps<{
  connectorId: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

// Wizard for configuring an already-flashed ESP32-S3 over USB serial.
// The firmware itself is uploaded ahead of time via `bun run flash:ws` (or
// `pio run -t upload` in pio-ws/). All this wizard does is:
//   1. open the serial port (user picks via requestPort()),
//   2. read the firmware's `[info]` boot broadcast to pre-fill the form,
//   3. send `[config] ssid=…\npass=…\npin=…\ncommit\n`,
//   4. wait for the ESP32 to reboot into run mode,
//   5. create a WebSocketConnector with the device's mDNS URL.

type Step =
  | 'idle'
  | 'connecting'
  | 'waiting-boot'
  | 'configuring'
  | 'restarting'
  | 'done'
  | 'error';

const step         = ref<Step>('idle');
const errorMessage = ref<string>('');
const logLines     = ref<string[]>([]);

const detected = ref({
  hostname: '' as string,
  ssid:     '' as string,
  pin:      48 as number,
  mode:     '' as string,
  net:      'wifi' as 'wifi' | 'eth',
});

const formSsid = ref('');
const formPass = ref('');
const formPin  = ref(48);

let port: SerialPort | null = null;
let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let textBuf = '';
let readerLoopActive = false;

// Double-click guard for factory reset
let resetClickTimer: ReturnType<typeof setTimeout> | null = null;
const resetArmed = ref(false);

function handleResetClick() {
  if (resetArmed.value) {
    // Second click — execute
    if (resetClickTimer) clearTimeout(resetClickTimer);
    resetArmed.value = false;
    resetClickTimer = null;
    writeLine('[config] factory-reset');
    step.value = 'waiting-boot';
    pushLog('[wizard] factory reset sent — waiting for reboot…');
  } else {
    // First click — arm
    resetArmed.value = true;
    resetClickTimer = setTimeout(() => {
      resetArmed.value = false;
      resetClickTimer = null;
    }, 2000);
  }
}

function pushLog(line: string) {
  logLines.value.push(line);
  if (logLines.value.length > 200) logLines.value.shift();
}

async function start() {
  errorMessage.value = '';
  logLines.value = [];
  detected.value = { hostname: '', ssid: '', pin: 48, mode: '', net: 'wifi' };
  formSsid.value = '';
  formPass.value = '';
  formPin.value  = 48;
  step.value = 'connecting';
  try {
    port = await (navigator as any).serial.requestPort();
    await port!.open({ baudRate: 115200 });
    writer = port!.writable!.getWriter();
    readerLoopActive = true;
    readSerial();
    step.value = 'waiting-boot';
    pushLog('[wizard] port opened — waiting for [info] boot lines…');
    // The firmware reprints its [info] block every 2s in CONFIG_MODE, so it
    // arrives within ~2s even if we missed the first one.
  } catch (e) {
    errorMessage.value = (e as Error).message ?? String(e);
    step.value = 'error';
    pushLog(`[wizard] error: ${errorMessage.value}`);
  }
}

async function readSerial() {
  if (!port || !port.readable) return;
  reader = port.readable.getReader();
  const decoder = new TextDecoder();
  try {
    while (readerLoopActive) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      textBuf += decoder.decode(value, { stream: true });
      const lines = textBuf.split('\n');
      textBuf = lines.pop() ?? '';
      for (const raw of lines) {
        const line = raw.replace(/\r/g, '').trimEnd();
        if (!line) continue;
        pushLog(line);
        handleSerialLine(line);
      }
    }
  } catch (e) {
    pushLog(`[serial] read err: ${(e as Error).message ?? e}`);
  } finally {
    try { reader?.releaseLock(); } catch {}
    reader = null;
  }
}

function handleSerialLine(line: string) {
  const infoMatch = line.match(/^\[info\] (\w+)=(.*)$/);
  if (infoMatch) {
    const [, key, value] = infoMatch;
    if      (key === 'hostname') detected.value.hostname = value!;
    else if (key === 'net')      detected.value.net = value as 'wifi' | 'eth';
    else if (key === 'ssid')     { detected.value.ssid = value!; if (!formSsid.value) formSsid.value = value!; }
    else if (key === 'pin')      { detected.value.pin  = Number(value); if (!formPin.value || formPin.value === 48) formPin.value = Number(value); }
    else if (key === 'mode')     {
      detected.value.mode = value!;
      // First [info mode=…] line confirms we've caught the boot broadcast.
      if (step.value === 'waiting-boot') step.value = 'configuring';
    }
    return;
  }
  if (line.includes('[config] ok — restarting')) {
    step.value = 'restarting';
  }
  if (step.value === 'restarting' && line.startsWith('[boot] ready')) {
    step.value = 'done';
  }
}

async function writeLine(line: string) {
  if (!writer) return;
  const enc = new TextEncoder();
  await writer.write(enc.encode(line + '\n'));
  pushLog(`→ ${line}`);
}

async function submitConfig() {
  if (detected.value.net === 'wifi') {
    if (formSsid.value && formSsid.value !== detected.value.ssid) {
      await writeLine(`[config] ssid=${formSsid.value}`);
    }
    if (formPass.value) {
      await writeLine(`[config] pass=${formPass.value}`);
    }
  }
  if (formPin.value && formPin.value !== detected.value.pin) {
    await writeLine(`[config] pin=${formPin.value}`);
  }
  await writeLine('[config] commit');
}

const connectionsStore = useConnectionsStore();
const history = useHistory();

// Surface to the user that fixture bindings on the existing card will survive
// the re-configuration — important when migrating a strip from WiFi to Ethernet
// (or vice versa) on a swapped physical device.
const existingSlotCount = computed(() => {
  const target = connectionsStore.connectors.find(c => c.id === props.connectorId);
  if (!(target instanceof WebSocketConnector)) return 0;
  const slots = (target.getConfig() as { fixtureSlots?: unknown[] }).fixtureSlots;
  return Array.isArray(slots) ? slots.filter(s => (s as { fixtureId?: unknown }).fixtureId != null).length : 0;
});
const hasExistingBindings = computed(() => existingSlotCount.value > 0);

// Update the existing target connector with the detected URL / label / pin
// instead of creating a new one. The user pressed "Einrichten" *on* a card —
// duplicating would leave a stale card behind every time they reconfigure.
// All three field updates land in a single UpdateConnectorConfigCommand so
// the tail sees one atomic edit (and undo reverts everything together).
function applyToConnector() {
  if (!detected.value.hostname) return;
  const target = connectionsStore.connectors.find(c => c.id === props.connectorId);
  if (!(target instanceof WebSocketConnector)) {
    emit('close');
    return;
  }
  // Disconnect first if currently connected — URL change while open is invalid.
  target.disconnect().catch(() => {});
  const url = `ws://${detected.value.hostname}/ws`;
  const prev = target.getConfig();
  // Preserve a custom label the user set earlier (e.g. "Bühne links") so that
  // re-pointing the connector at a different physical ESP — including swapping
  // a WiFi board for an Ethernet one — keeps the user's naming. fixtureSlots
  // / outputMapping always survive via the spread, so the strip's fixture
  // bindings carry over to the new transport untouched.
  const labelLooksAutoGenerated = !prev.label || prev.label === prev.url || /^pixelmapper-strip-/.test(prev.label);
  const next = {
    ...prev,
    url,
    label: labelLooksAutoGenerated ? detected.value.hostname : prev.label,
    ...(detected.value.pin ? { devicePin: detected.value.pin } : {}),
  };
  history.execute(new UpdateConnectorConfigCommand(target.id, next));
  emit('close');
}

async function cleanup() {
  readerLoopActive = false;
  try { await reader?.cancel(); } catch {}
  try { writer?.releaseLock(); } catch {}
  reader = null;
  writer = null;
  try { await port?.close(); } catch {}
  port = null;
}

onBeforeUnmount(cleanup);

const isWebSerialSupported = typeof navigator !== 'undefined' && 'serial' in navigator;

const stepLabel = computed(() => ({
  idle:              'Bereit',
  connecting:        'Verbinde mit dem Gerät…',
  'waiting-boot':    'Warte auf Boot-Log…',
  configuring:       'Gerät konfigurieren',
  restarting:        'Neu starten…',
  done:              'Fertig',
  error:             'Fehler',
}[step.value]));
</script>

<template>
  <div class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
    <div class="w-full max-w-lg rounded-lg border border-border bg-background shadow-xl flex flex-col max-h-[90vh]">
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-border">
        <div class="flex items-center gap-2">
          <SettingsIcon :size="16" class="text-blue-400" />
          <h2 class="text-sm font-semibold">LED-Strip-Gerät konfigurieren</h2>
        </div>
        <button class="p-1 rounded hover:bg-accent" @click="cleanup().then(() => emit('close'))">
          <X :size="16" />
        </button>
      </div>

      <!-- Body -->
      <div class="flex flex-col gap-3 p-4 overflow-y-auto">
        <p v-if="!isWebSerialSupported" class="text-sm text-red-400">
          Web Serial wird in diesem Browser nicht unterstützt. Bitte Chrome/Edge benutzen.
        </p>

        <!-- Step indicator -->
        <div class="text-xs text-muted-foreground uppercase tracking-wider">
          {{ stepLabel }}
        </div>

        <!-- Step 1: Start — also explains the firmware-flash prerequisite -->
        <div v-if="step === 'idle' || step === 'error'" class="flex flex-col gap-3">
          <div class="flex items-start gap-2 rounded border border-border/60 bg-muted/30 px-3 py-2.5 text-xs">
            <Terminal :size="14" class="mt-0.5 flex-shrink-0 text-muted-foreground" />
            <div class="flex flex-col gap-1">
              <p class="text-muted-foreground">
                Stelle sicher, dass auf dem ESP32-S3 die aktuelle Firmware läuft:
              </p>
              <code class="px-2 py-1 rounded bg-background/60 text-foreground font-mono text-[11px]">
                bun run flash:ws
              </code>
              <p class="text-muted-foreground">
                Wenn das Gerät frisch ist, bleibt es im CONFIG_MODE und wartet auf die
                Konfiguration unten.
              </p>
            </div>
          </div>

          <button
            class="flex items-center justify-center gap-2 px-4 py-2 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40 hover:bg-blue-500/30 transition-colors"
            :disabled="!isWebSerialSupported"
            @click="start"
          >
            <Usb :size="14" />
            Mit Gerät verbinden
          </button>
        </div>

        <!-- Step 2: waiting for boot info -->
        <div
          v-if="step === 'waiting-boot'"
          class="rounded border border-border/40 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground"
        >
          Warte auf <span class="font-mono">[info] …</span>-Zeilen vom Gerät — die Firmware
          sendet sie alle 2 Sekunden (sowohl im CONFIG_MODE als auch im RUN_MODE).
        </div>

        <!-- Step 3: Configure -->
        <div v-if="step === 'configuring'" class="flex flex-col gap-2 border-t border-border/40 pt-3">
          <div class="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <SettingsIcon :size="12" />
            <span>Gerät erkannt: <span class="font-mono">{{ detected.hostname || '—' }}</span></span>
          </div>
          <div v-if="hasExistingBindings" class="rounded border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-300">
            Vorhandene Fixture-Zuordnungen ({{ existingSlotCount }} Slot{{ existingSlotCount === 1 ? '' : 's' }}) bleiben erhalten — der Streifen kann ohne Neuzuweisung weiterverwendet werden, auch beim Wechsel WiFi&nbsp;↔&nbsp;Ethernet.
          </div>
          <template v-if="detected.net === 'wifi'">
            <label class="text-xs text-muted-foreground">
              WiFi-SSID
              <input
                v-model="formSsid"
                type="text"
                class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                :placeholder="detected.ssid || 'Heim-WLAN'"
              />
            </label>
            <label class="text-xs text-muted-foreground">
              WiFi-Passwort
              <input
                v-model="formPass"
                type="password"
                class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                :placeholder="detected.ssid ? '(unverändert lassen)' : ''"
              />
            </label>
          </template>
          <div v-else class="rounded border border-border/40 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Ethernet-Modus: Gerät erhält IP-Adresse automatisch per DHCP — kein WLAN nötig.
          </div>
          <label class="text-xs text-muted-foreground">
            LED Data Pin
            <input
              v-model.number="formPin"
              type="number"
              min="0" max="48"
              class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>
          <div class="flex flex-col gap-2 mt-2">
            <!-- Ethernet: direct-connect skips the unnecessary reboot when the
                 pin hasn't changed — the device is already in run mode. -->
            <button
              v-if="detected.net === 'eth' && formPin === detected.pin"
              class="flex items-center justify-center gap-2 px-4 py-2 rounded bg-green-500/20 text-green-300 border border-green-500/40 hover:bg-green-500/30 transition-colors"
              @click="applyToConnector"
            >
              <CheckCircle2 :size="14" />
              Direkt verbinden (kein Neustart nötig)
            </button>
            <div class="flex gap-2">
              <button
                class="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40 hover:bg-blue-500/30 transition-colors"
                @click="submitConfig"
              >
                {{ detected.net === 'eth' ? 'LED-Pin speichern & neu starten' : 'Übernehmen & neu starten' }}
              </button>
              <button
                class="px-3 py-2 rounded border text-xs transition-colors"
                :class="resetArmed
                  ? 'border-red-500/60 bg-red-500/20 text-red-300 hover:bg-red-500/30'
                  : 'border-border text-muted-foreground hover:bg-accent'"
                :title="resetArmed ? 'Nochmal klicken zum Bestätigen' : 'NVS löschen & auf Werkseinstellungen zurücksetzen'"
                @click="handleResetClick"
              >
                {{ resetArmed ? '⚠ Bestätigen' : 'Reset' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Step 4: restarting -->
        <div
          v-if="step === 'restarting'"
          class="rounded border border-border/40 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground"
        >
          Gerät startet neu und verbindet sich{{ detected.net === 'eth' ? ' per Ethernet' : ' mit WiFi' }}…
        </div>

        <!-- Step 5: Done -->
        <div v-if="step === 'done'" class="flex flex-col gap-2 border-t border-border/40 pt-3">
          <div class="flex items-center gap-2 text-sm text-green-400">
            <CheckCircle2 :size="16" />
            Gerät einsatzbereit unter <span class="font-mono">{{ detected.hostname }}</span>
          </div>
          <button
            class="flex items-center justify-center gap-2 px-4 py-2 rounded bg-green-500/20 text-green-300 border border-green-500/40 hover:bg-green-500/30 transition-colors"
            @click="applyToConnector"
          >
            Übernehmen &amp; fertig
          </button>
        </div>

        <!-- Error -->
        <div v-if="step === 'error'" class="flex items-start gap-2 text-sm text-red-400">
          <AlertTriangle :size="16" class="flex-shrink-0 mt-0.5" />
          <span>{{ errorMessage }}</span>
        </div>

        <!-- Log -->
        <details v-if="logLines.length" class="text-xs">
          <summary class="cursor-pointer text-muted-foreground">Log ({{ logLines.length }})</summary>
          <pre class="mt-2 max-h-48 overflow-y-auto bg-muted/30 rounded p-2 text-[10px] font-mono">{{ logLines.join('\n') }}</pre>
        </details>
      </div>
    </div>
  </div>
</template>
