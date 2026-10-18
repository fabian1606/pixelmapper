/**
 * View model of the header sync status (ADR 0004 D17): icon, label, inline
 * text and detail lines, driven by the read-only `syncStatus` of the sync
 * engine. The "syncing" look is delayed by `SYNCING_DELAY_MS` so short
 * pushes do not flicker. Must be called from component setup.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Component } from 'vue';
import type { SyncState } from '~/utils/sync/project-sync-service';
import { syncStatus } from '~/utils/sync/project-sync-service';
import { relativeTime } from '~/utils/sync/relative-time';
import { CloudCheck, CloudOff, HardDrive, RefreshCw, TriangleAlert } from 'lucide-vue-next';

/** Minimum time in `syncing` before the spinner shows. */
const SYNCING_DELAY_MS = 600;
/** Refresh interval of the relative "last synced" time. */
export const CLOCK_TICK_MS = 30_000;

/** Icon, label and color per state. */
const STATE_VIEW: Record<SyncState, { icon: Component; label: string; tone: string }> = {
  'synced': { icon: CloudCheck, label: 'Synced', tone: 'text-sidebar-foreground/50' },
  'syncing': { icon: RefreshCw, label: 'Syncing…', tone: 'text-sidebar-foreground/70' },
  'offline': { icon: CloudOff, label: 'Offline', tone: 'text-yellow-500' },
  'error': { icon: TriangleAlert, label: 'Sync error', tone: 'text-destructive' },
  'local-only': { icon: HardDrive, label: 'Local only', tone: 'text-sidebar-foreground/50' },
};

export function useSyncStatusView() {
  // ── Debounced state ────────────────────────────────────────────────────────

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

  // ── Clock for relative times ───────────────────────────────────────────────

  const now = ref(Date.now());
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  onMounted(() => {
    clockTimer = setInterval(() => { now.value = Date.now(); }, CLOCK_TICK_MS);
  });
  onUnmounted(() => {
    if (clockTimer) clearInterval(clockTimer);
    if (syncingTimer) clearTimeout(syncingTimer);
  });

  // ── View ───────────────────────────────────────────────────────────────────

  const view = computed(() => STATE_VIEW[shownState.value]);
  const pending = computed(() => syncStatus.value.pending);

  /** Short inline text next to the icon (offline pending count, local-only). */
  const inlineText = computed(() => {
    if (shownState.value === 'offline' && pending.value > 0) return `${pending.value} pending`;
    if (shownState.value === 'local-only') return 'Local only';
    return '';
  });

  /** Detail lines (pending count, last sync, error). */
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

  return { shownState, view, pending, inlineText, details, ariaLabel, now };
}
