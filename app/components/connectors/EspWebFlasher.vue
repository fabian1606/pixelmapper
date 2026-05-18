<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';
import { X, Usb, Zap, Settings as SettingsIcon, CheckCircle2, AlertTriangle } from 'lucide-vue-next';
import { ESPLoader, Transport } from 'esptool-js';
import { useConnectionsStore } from '~/stores/connections-store';
import { WebSocketConnector } from '~/utils/connectors/websocket-connector';

const emit = defineEmits<{
  (e: 'close'): void;
}>();

interface ManifestPart { path: string; offset: number; }
interface Manifest {
  name?:        string;
  version?:     string;
  chipFamily?:  string;
  releaseTag?:  string;
  parts:        ManifestPart[];
}

type Step =
  | 'idle'
  | 'connecting'
  | 'fetching-manifest'
  | 'flashing'
  | 'waiting-boot'
  | 'configuring'
  | 'restarting'
  | 'done'
  | 'error';

const step           = ref<Step>('idle');
const errorMessage   = ref<string>('');
const progressFile   = ref<string>('');
const progressPct    = ref<number>(0);
const logLines       = ref<string[]>([]);
const manifest       = ref<Manifest | null>(null);

// Detected from the firmware's "[info] …" boot broadcast.
const detected = ref({
  hostname: '' as string,
  ssid:     '' as string,
  pin:      48 as number,
  mode:     '' as string,
});

// User-entered values (pre-filled from `detected` on Schritt 2)
const formSsid = ref('');
const formPass = ref('');
const formPin  = ref(48);

let port: SerialPort | null = null;
let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let textBuf = '';
let readerLoopActive = false;

function pushLog(line: string) {
  logLines.value.push(line);
  if (logLines.value.length > 200) logLines.value.shift();
}

async function fetchManifest(): Promise<Manifest> {
  // Pick the most recent release that has a strip-manifest.json (= a build of
  // the ESP32-S3 strip firmware). The P4 firmware ships in the same release
  // but uses different asset filenames (firmware.bin vs strip-firmware.bin),
  // so they coexist on a single GitHub release.
  const releasesResp = await fetch('https://api.github.com/repos/fabian1606/pixelmapper/releases');
  if (!releasesResp.ok) throw new Error(`GitHub releases fetch failed: HTTP ${releasesResp.status}`);
  const releases = await releasesResp.json() as Array<{ tag_name: string; assets: Array<{ name: string; browser_download_url: string }> }>;
  const release = releases.find(r => r.assets.some(a => a.name === 'strip-manifest.json'));
  if (!release) throw new Error('No release with strip-manifest.json found');
  const manifestAsset = release.assets.find(a => a.name === 'strip-manifest.json');
  if (!manifestAsset) throw new Error(`Release ${release.tag_name} has no strip-manifest.json`);

  const mfResp = await fetch(`/api/firmware-proxy?url=${encodeURIComponent(manifestAsset.browser_download_url)}`);
  if (!mfResp.ok) throw new Error(`strip-manifest.json fetch failed: HTTP ${mfResp.status}`);
  const mf = await mfResp.json() as Manifest;
  mf.releaseTag = release.tag_name;

  // Resolve part paths against the same release's asset URLs
  const assetByName = new Map(release.assets.map(a => [a.name, a.browser_download_url]));
  mf.parts = mf.parts.map(p => ({
    ...p,
    path: assetByName.get(p.path) ?? p.path,
  }));
  return mf;
}

async function downloadPart(url: string): Promise<Uint8Array> {
  const resp = await fetch(`/api/firmware-proxy?url=${encodeURIComponent(url)}`);
  if (!resp.ok) throw new Error(`download failed: HTTP ${resp.status} (${url})`);
  return new Uint8Array(await resp.arrayBuffer());
}

async function openPort() {
  port = await (navigator as any).serial.requestPort();
  step.value = 'connecting';
  errorMessage.value = '';
}

async function flashFirmware() {
  if (!port) throw new Error('No serial port');
  step.value = 'fetching-manifest';
  pushLog('[wizard] fetching manifest.json…');
  manifest.value = await fetchManifest();
  pushLog(`[wizard] release=${manifest.value.releaseTag} parts=${manifest.value.parts.length}`);

  // Download all parts up-front
  const parts: { data: Uint8Array; address: number }[] = [];
  for (const p of manifest.value.parts) {
    pushLog(`[wizard] downloading ${p.path.split('/').pop()}…`);
    const data = await downloadPart(p.path);
    parts.push({ data: binaryToString(data), address: p.offset } as any);
    // esptool-js wants strings ("latin-1") for fileArray.data; we'll pass Uint8Array.
    // The library accepts both Uint8Array and string in practice.
    parts[parts.length - 1].data = data;
  }

  step.value = 'flashing';
  progressFile.value = '';
  progressPct.value = 0;

  const transport = new Transport(port, true);
  const loader = new ESPLoader({
    transport,
    baudrate: 921600,
    terminal: {
      clean: () => {},
      writeLine: (s: string) => pushLog(s),
      write:     (s: string) => pushLog(s),
    },
  });
  pushLog('[esp] entering bootloader…');
  await loader.main();   // detect chip + sync
  pushLog('[esp] connected — flashing…');

  await loader.writeFlash({
    fileArray: parts as any,
    flashSize: 'keep',
    flashMode: 'keep',
    flashFreq: 'keep',
    eraseAll:  false,
    compress:  true,
    reportProgress: (idx, written, total) => {
      progressFile.value = manifest.value!.parts[idx]!.path.split('/').pop() ?? '';
      progressPct.value  = total > 0 ? Math.round((written / total) * 100) : 0;
    },
  });

  pushLog('[esp] flash complete — resetting…');
  // esptool-js 0.6.x: `after('hard_reset')` toggles DTR/RTS to reset the chip
  // into user code. Older versions had `hardReset()`; newer use this signature.
  await loader.after('hard_reset');
  await transport.disconnect();

  // The ESP32-S3 uses USB-Serial-JTAG (VID 0x303A, PID 0x1001) — after reset
  // the USB endpoint re-enumerates, so the original SerialPort handle is
  // stale. We try to reopen, and on failure look up the new port via
  // navigator.serial.getPorts() filtered by VID/PID.
  await reopenForBoot(115200);
}

function binaryToString(bytes: Uint8Array): string {
  // esptool-js historically expected latin-1 string; new versions accept Uint8Array.
  // We pass Uint8Array; this helper is here as a fallback.
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Reopen the port at the firmware's serial baud after a hard-reset.
 * ESP32-S3's native USB-Serial-JTAG re-enumerates after reset, so the existing
 * SerialPort handle is often stale; in that case we look up the freshly
 * permitted port via navigator.serial.getPorts() filtered by VID/PID.
 */
async function reopenForBoot(baud: number) {
  if (!port) return;
  const origInfo = port.getInfo();

  // First close the existing handle so its writable/readable streams free up.
  try { await port.close(); } catch {}

  // ESP32-S3 USB-Serial-JTAG needs ~1s to re-enumerate after reset.
  await sleep(1200);

  // Try the original handle first.
  try {
    await port.open({ baudRate: baud });
  } catch (firstErr) {
    pushLog(`[wizard] port stale (${(firstErr as Error).message}) — searching re-enumerated device…`);
    // Poll getPorts() for up to 4 seconds for a port matching the original VID/PID.
    let fresh: SerialPort | null = null;
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const ports: SerialPort[] = await (navigator as any).serial.getPorts();
      fresh = ports.find(p => {
        const i = p.getInfo();
        return i.usbVendorId === origInfo.usbVendorId
            && i.usbProductId === origInfo.usbProductId;
      }) ?? null;
      if (fresh) break;
      await sleep(250);
    }
    if (!fresh) throw new Error('Re-enumerated serial port not found after reset');
    port = fresh;
    await port.open({ baudRate: baud });
  }

  writer = port.writable!.getWriter();
  readerLoopActive = true;
  readSerial();
  pushLog(`[wizard] serial reopened @${baud} — waiting for boot info…`);
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
  // Boot info broadcast — pre-fills form fields on first arrival.
  const infoMatch = line.match(/^\[info\] (\w+)=(.*)$/);
  if (infoMatch) {
    const [, key, value] = infoMatch;
    if      (key === 'hostname') detected.value.hostname = value!;
    else if (key === 'ssid')     { detected.value.ssid = value!; if (!formSsid.value) formSsid.value = value!; }
    else if (key === 'pin')      { detected.value.pin  = Number(value); if (!formPin.value) formPin.value = Number(value); }
    else if (key === 'mode')     detected.value.mode = value!;
    return;
  }
  if (line.includes('CONFIG_MODE') || line.includes('mode=config') || line.includes('mode=run')) {
    if (step.value === 'flashing' || step.value === 'waiting-boot') {
      step.value = 'configuring';
    }
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
  if (formSsid.value && formSsid.value !== detected.value.ssid) {
    await writeLine(`[config] ssid=${formSsid.value}`);
  }
  if (formPass.value) {
    await writeLine(`[config] pass=${formPass.value}`);
  }
  if (formPin.value && formPin.value !== detected.value.pin) {
    await writeLine(`[config] pin=${formPin.value}`);
  }
  await writeLine('[config] commit');
}

const connectionsStore = useConnectionsStore();

function createConnector() {
  if (!detected.value.hostname) return;
  const url = `ws://${detected.value.hostname}/ws`;
  const wc = new WebSocketConnector(crypto.randomUUID(), url, null);
  connectionsStore.add(wc);
  emit('close');
}

async function start() {
  errorMessage.value = '';
  logLines.value = [];
  step.value = 'idle';
  try {
    await openPort();
    await flashFirmware();
    step.value = 'waiting-boot';
  } catch (e) {
    errorMessage.value = (e as Error).message ?? String(e);
    step.value = 'error';
    pushLog(`[wizard] error: ${errorMessage.value}`);
  }
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
  'fetching-manifest':'Firmware-Manifest laden…',
  flashing:          `Flash: ${progressFile.value} (${progressPct.value}%)`,
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
          <Zap :size="16" class="text-yellow-400" />
          <h2 class="text-sm font-semibold">Neues LED-Strip-Gerät einrichten</h2>
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

        <!-- Step 1: Start -->
        <button
          v-if="step === 'idle' || step === 'error'"
          class="flex items-center justify-center gap-2 px-4 py-2 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40 hover:bg-blue-500/30 transition-colors"
          :disabled="!isWebSerialSupported"
          @click="start"
        >
          <Usb :size="14" />
          Gerät verbinden &amp; flashen
        </button>

        <!-- Progress bar -->
        <div v-if="step === 'flashing'" class="px-1">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs text-muted-foreground">{{ progressFile }}</span>
            <span class="text-xs text-muted-foreground">{{ progressPct }}%</span>
          </div>
          <div class="h-1 rounded bg-border overflow-hidden">
            <div
              class="h-full bg-blue-400 transition-all duration-200"
              :style="{ width: progressPct + '%' }"
            />
          </div>
        </div>

        <!-- Step 2: Configure -->
        <div v-if="step === 'configuring'" class="flex flex-col gap-2 border-t border-border/40 pt-3">
          <div class="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <SettingsIcon :size="12" />
            <span>Gerät erkannt: <span class="font-mono">{{ detected.hostname || '—' }}</span></span>
          </div>
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
              :placeholder="detected.ssid ? '(unverändert)' : ''"
            />
          </label>
          <label class="text-xs text-muted-foreground">
            LED Data Pin
            <input
              v-model.number="formPin"
              type="number"
              min="0" max="48"
              class="mt-1 w-full rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>
          <button
            class="mt-2 flex items-center justify-center gap-2 px-4 py-2 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40 hover:bg-blue-500/30 transition-colors"
            @click="submitConfig"
          >
            Übernehmen &amp; neu starten
          </button>
        </div>

        <!-- Step 3: Done -->
        <div v-if="step === 'done'" class="flex flex-col gap-2 border-t border-border/40 pt-3">
          <div class="flex items-center gap-2 text-sm text-green-400">
            <CheckCircle2 :size="16" />
            Gerät einsatzbereit unter <span class="font-mono">{{ detected.hostname }}</span>
          </div>
          <button
            class="flex items-center justify-center gap-2 px-4 py-2 rounded bg-green-500/20 text-green-300 border border-green-500/40 hover:bg-green-500/30 transition-colors"
            @click="createConnector"
          >
            Connector anlegen &amp; fertig
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
