<script setup lang="ts">
/**
 * Custom panel of a content plugin (plan P4.6, ADR §6.9): runs the plugin's
 * transpiled `ui.ts` in a sandboxed iframe (`allow-scripts`, opaque origin,
 * no network) and proxies the `PanelApi`. Messages are validated against the
 * param schema; `beginScrub`/`endScrub` map to one history step.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { encodeParams } from '@pixelmapper/plugin-toolchain/params';
import type { ContentPluginManifest } from '@pixelmapper/plugin-toolchain/types';
import type { ParamValue } from '@pixelmapper/extension-api';
import type { ModifierInstance } from '~/utils/engine/types';
import { buildPanelSrcdoc, envelope, parsePanelMessage, resolveTheme, type HostToPanel } from '~/utils/plugins/iframe-runtime';
import { loadWasm } from '~/utils/plugins/plugin-store';
import { liveHub } from '~/utils/extensions/live-hub';

const props = defineProps<{
  modifier: ModifierInstance;
  manifest: ContentPluginManifest;
  /** Transpiled panel code (`ContentPluginPackage.uiJs`). */
  uiJs: string;
}>();

const emit = defineEmits<{
  /** New params (continuous while scrubbing). */
  'update:params': [params: Record<string, ParamValue>];
  scrubStart: [];
  /** End of a scrub, or a single discrete change: commit one history step. */
  scrubEnd: [];
}>();

const iframe = ref<HTMLIFrameElement | null>(null);
const height = ref(80);
const error = ref<string | null>(null);
const theme = shallowRef<Record<string, string>>({});

/** Per-instance channel id (messages on other channels are ignored). */
const channel = `${props.modifier.id}:${Math.random().toString(36).slice(2)}`;

const srcdoc = computed(() => buildPanelSrcdoc(channel, props.uiJs, theme.value));

let scrubbing = false;
let disposeFrames: (() => void) | null = null;

/** Posts a host message into the iframe. */
function post(msg: HostToPanel, transfer: Transferable[] = []) {
  iframe.value?.contentWindow?.postMessage(envelope(channel, msg), '*', transfer);
}

/** Current params with defaults, encoded for the plugin. */
function paramState() {
  return { params: { ...props.modifier.params }, encoded: encodeParams(props.manifest.params, props.modifier.params) };
}

/** Sends init (params, theme, plugin wasm for api.render). */
async function init() {
  const bytes = await loadWasm(props.modifier.plugin);
  const wasm = bytes ? bytes.slice().buffer : null;
  post({ type: 'init', ...paramState(), theme: theme.value, wasm }, wasm ? [wasm] : []);
}

/** Starts/stops forwarding beat frames (~30 fps). */
function setFrames(enabled: boolean) {
  disposeFrames?.();
  disposeFrames = null;
  if (!enabled) return;
  let last = 0;
  disposeFrames = liveHub.addFrameCallback((f) => {
    if (f.timeMs - last < 33) return;
    last = f.timeMs;
    post({ type: 'frame', timeMs: f.timeMs, beatTime: f.beat.beatTime, bpm: f.beat.bpm });
  }, [{ kind: 'beat' }]);
}

/** Handles validated iframe messages. */
function onMessage(e: MessageEvent) {
  if (!iframe.value || e.source !== iframe.value.contentWindow || e.origin !== 'null') return;
  const msg = parsePanelMessage(e.data, channel, props.manifest.params);
  if (!msg) return;
  switch (msg.type) {
    case 'ready':
      void init();
      break;
    case 'set-param':
      emit('update:params', { ...props.modifier.params, [msg.key]: msg.value });
      if (!scrubbing) emit('scrubEnd');
      break;
    case 'scrub':
      if (msg.phase === 'begin' && !scrubbing) { scrubbing = true; emit('scrubStart'); }
      if (msg.phase === 'end' && scrubbing) { scrubbing = false; emit('scrubEnd'); }
      break;
    case 'frames':
      setFrames(msg.enabled);
      break;
    case 'resize':
      height.value = msg.height;
      break;
    case 'error':
      error.value = msg.message;
      console.warn(`[plugin-panel] ${props.manifest.name}: ${msg.message}`);
      break;
  }
}

// Param changes from elsewhere (other inputs, undo, collaborators).
watch(() => props.modifier.params, () => post({ type: 'params', ...paramState() }), { deep: true });

/** Re-reads theme variables when the color mode class changes (reloads the panel). */
const themeObserver = typeof MutationObserver !== 'undefined'
  ? new MutationObserver(() => { theme.value = resolveTheme(); })
  : null;

onMounted(() => {
  theme.value = resolveTheme();
  themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  window.addEventListener('message', onMessage);
});

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage);
  themeObserver?.disconnect();
  setFrames(false);
  if (scrubbing) emit('scrubEnd');
});
</script>

<template>
  <div class="flex flex-col gap-1">
    <iframe
      ref="iframe"
      sandbox="allow-scripts"
      :srcdoc="srcdoc"
      :title="`${manifest.name} panel`"
      class="w-full border-0 bg-transparent"
      :style="{ height: `${height}px` }"
    />
    <div v-if="error" class="text-[11px] text-destructive">Panel error: {{ error }}</div>
  </div>
</template>
