<script setup lang="ts">
/**
 * Header icon showing the sync state of the open project (ADR 0004 D17).
 *
 * Driven by the read-only `syncStatus` of the sync engine. The "syncing"
 * look is delayed by `SYNCING_DELAY_MS` so short pushes do not flicker.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Component } from 'vue';
import type { SyncState } from '~/utils/sync/project-sync-service';
import { syncStatus } from '~/utils/sync/project-sync-service';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CloudCheck, CloudOff, HardDrive, RefreshCw, TriangleAlert } from 'lucide-vue-next';

/** Minimum time in `syncing` before the spinner shows. */
const SYNCING_DELAY_MS = 600;
/** Refresh interval of the relative "last synced" time. */
const CLOCK_TICK_MS = 30_000;

// ── Debounced state ──────────────────────────────────────────────────────────

/** State shown in the UI (`syncing` only after the delay). */
const shownState = ref<SyncState>(syncStatus.value.state);
/** State before `syncing` started, shown during the delay. */
let previousState: SyncState = shownState.value === 'syncing' ? 'synced' : shownState.value;
let syncingTimer: ReturnType<typeof setTimeout> | null = null;

/** Applies a new raw state, delaying the switch to `syncing`. */
function applyState(state: SyncState): void {
  if (syncingTimer) { clearTimeout(syncingTimer); syncingTimer = null; }
  if (state !== 'syncing') {
    previousState = state;
    shownState.value = state;
    return;
  }
  // Keep showing the previous state; switch only if syncing lasts long enough.
  shownState.value = previousState;
  syncingTimer = setTimeout(() => {
    syncingTimer = null;
    if (syncStatus.value.state === 'syncing') shownState.value = 'syncing';
  }, SYNCING_DELAY_MS);
}

watch(() => syncStatus.value.state, applyState, { immediate: true });

// ── Clock for the relative time ──────────────────────────────────────────────

const now = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  clockTimer = setInterval(() => { now.value = Date.now(); }, CLOCK_TICK_MS);
});

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
  if (syncingTimer) clearTimeout(syncingTimer);
});

/** "just now", "2 min ago", "3 h ago", "4 days ago". */
function relativeTime(ts: number, at: number): string {
  const s = Math.max(0, Math.round((at - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

// ── View model ───────────────────────────────────────────────────────────────

/** Icon, label and color per state. */
const STATE_VIEW: Record<SyncState, { icon: Component; label: string; tone: string }> = {
  'synced': { icon: CloudCheck, label: 'Synced', tone: 'text-sidebar-foreground/50' },
  'syncing': { icon: RefreshCw, label: 'Syncing…', tone: 'text-sidebar-foreground/70' },
  'offline': { icon: CloudOff, label: 'Offline', tone: 'text-yellow-500' },
  'error': { icon: TriangleAlert, label: 'Sync error', tone: 'text-destructive' },
  'local-only': { icon: HardDrive, label: 'Local only', tone: 'text-sidebar-foreground/50' },
};

const view = computed(() => STATE_VIEW[shownState.value]);
const pending = computed(() => syncStatus.value.pending);

/** Short inline text next to the icon (offline pending count, local-only). */
const inlineText = computed(() => {
  if (shownState.value === 'offline' && pending.value > 0) return `${pending.value} pending`;
  if (shownState.value === 'local-only') return 'Local only';
  return '';
});

/** Tooltip detail lines. */
const details = computed(() => {
  const out: string[] = [];
  if (pending.value > 0) out.push(`${pending.value} pending change${pending.value === 1 ? '' : 's'}`);
  const last = syncStatus.value.lastSyncedAt;
  if (shownState.value !== 'local-only') {
    out.push(last ? `Last synced ${relativeTime(last, now.value)}` : 'Not synced yet');
  }
  if (shownState.value === 'error' && syncStatus.value.error) out.push(syncStatus.value.error);
  return out;
});

/** Screen-reader label summarising state and details. */
const ariaLabel = computed(() => [`Sync status: ${view.value.label}`, ...details.value].join('. '));
</script>

<template>
  <TooltipProvider :delay-duration="200">
    <Tooltip>
      <TooltipTrigger as-child>
        <button
          type="button"
          class="flex items-center gap-1.5 h-8 px-1.5 rounded-md text-xs transition-colors hover:bg-sidebar-accent"
          :class="view.tone"
          :aria-label="ariaLabel"
          data-testid="sync-status-indicator"
        >
          <component :is="view.icon" :size="16" :class="shownState === 'syncing' ? 'animate-spin' : ''" aria-hidden="true" />
          <span v-if="inlineText">{{ inlineText }}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" class="max-w-64">
        <p class="font-medium">{{ view.label }}</p>
        <p v-for="(line, i) in details" :key="i" class="opacity-80 break-words">{{ line }}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
