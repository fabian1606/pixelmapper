<script setup lang="ts">
/**
 * "Version history" section of the sync status popover (ADR 0004 D17):
 * the project's server snapshots, newest first, with collapsed autosave
 * runs and "Load more". Restore requests are emitted; the parent confirms
 * and runs them (the dialog must outlive this popover content). With a
 * details loader, entries expand to show what changed since the next older
 * entry of the (uncollapsed) list. With a preview loader, hovering or
 * focusing an entry for 300 ms shows a live layout preview next to the
 * popover (below the entry when there is no room on the left).
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { SnapshotListEntry } from '~/utils/sync/remote-api-snapshots';
import { isOnline } from '~/utils/sync/connectivity';
import { collapseAutosaves } from '~/utils/sync/version-history';
import type { VersionDetails } from '~/utils/sync/version-details-controller';
import type { VersionHistory } from '~/utils/sync/version-history-controller';
import { createHoverIntent } from '~/utils/sync/version-preview/hover-intent';
import type { VersionPreview } from '~/utils/sync/version-preview/preview-controller';
import VersionHistoryItem from '~/components/sync/VersionHistoryItem.vue';
import VersionPreviewCard from '~/components/sync/VersionPreviewCard.vue';
import { Button } from '@/components/ui/button';
import { ChevronsUpDown, LoaderCircle } from 'lucide-vue-next';

const props = defineProps<{
  history: VersionHistory | null;
  /** Local-only project: no server, no history. */
  local: boolean;
  now: number;
  /** "What changed" loader; entries are not expandable without it. */
  details?: VersionDetails | null;
  /** Hover-preview loader; no previews without it. */
  preview?: VersionPreview | null;
  /** Force the preview renderer (tests: `svg`). */
  previewRenderer?: 'auto' | 'svg';
}>();

const emit = defineEmits<{ restore: [entry: SnapshotListEntry] }>();

/** Expanded autosave runs (keys of `collapsed` rows). */
const expanded = ref(new Set<string>());

const h = computed(() => props.history);
const rows = computed(() => (h.value ? collapseAutosaves(h.value.entries.value, expanded.value) : []));

/**
 * Entry id → id of the next older entry (diff base). The last loaded entry
 * gets none: the server finds its older neighbour (or reports the first version).
 */
const olderIds = computed(() => {
  const list = h.value?.entries.value ?? [];
  return new Map(list.map((e, i) => [e.id, list[i + 1]?.id ?? null]));
});

/** Note below the heading (offline / viewer / error). */
const note = computed(() => {
  const hist = h.value;
  if (!hist) return '';
  if (hist.error.value) return hist.error.value;
  if (!isOnline.value) return hist.loaded.value ? 'Offline — showing the last loaded list.' : 'Offline — version history is unavailable.';
  if (hist.stale.value) return 'Could not refresh — showing the last loaded list.';
  if (hist.role.value === 'viewer') return 'Viewers can’t restore versions.';
  return '';
});

/** Expand one collapsed autosave run. */
function expand(key: string): void {
  expanded.value = new Set([...expanded.value, key]);
}

// ── Hover preview ────────────────────────────────────────────────────────────

/** Card width incl. gap: below this much room on the left the card goes under the entry. */
const SIDE_ROOM = 360;
/** Devices without hover (touch) toggle the preview with a button. */
const touchPreview = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? !window.matchMedia('(hover: hover)').matches
  : false;

const sectionEl = ref<HTMLElement | null>(null);
/** Row element per entry id (last reported anchor). */
const anchors = new Map<string, HTMLElement>();
/** Shown preview: entry + position relative to the section. */
const shown = shallowRef<{ entry: SnapshotListEntry; top: number; side: boolean } | null>(null);

/** Places the card next to (or below) the entry's row. */
function place(id: string): void {
  const entry = h.value?.entries.value.find(e => e.id === id);
  const anchor = anchors.get(id);
  const section = sectionEl.value;
  if (!entry || !anchor || !section) return;
  const s = section.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const side = s.left >= SIDE_ROOM;
  shown.value = { entry, side, top: side ? Math.max(a.top - s.top - 8, -s.top + 8) : a.bottom - s.top + 4 };
}

const intent = createHoverIntent<string>({
  onShow: place,
  onHide: () => { shown.value = null; },
});

/** Renderer warmed (once per panel). */
let warmed = false;

/** Sets up the WebGL renderer during the first hover delay (one-time init cost). */
function warmRenderer(): void {
  if (warmed || props.previewRenderer === 'svg') return;
  warmed = true;
  void import('~/utils/sync/version-preview/preview-wasm')
    .then(m => m.warmWasmPreview())
    .catch(err => console.warn('[version-preview] renderer warm-up failed:', err));
}

function onPreviewEnter(entry: SnapshotListEntry, anchor: HTMLElement): void {
  if (!props.preview) return;
  anchors.set(entry.id, anchor);
  warmRenderer();
  intent.enter(entry.id);
}

function onPreviewLeave(entry: SnapshotListEntry): void {
  intent.leave(entry.id);
}

function onPreviewToggle(entry: SnapshotListEntry, anchor: HTMLElement): void {
  if (!props.preview) return;
  anchors.set(entry.id, anchor);
  warmRenderer();
  intent.toggle(entry.id);
}

// The row moved away under the card: hide instead of pointing at the wrong entry.
function onListScroll(): void {
  intent.cancel();
}

// Entry gone after a refresh / project switched: hide.
watch(() => h.value?.entries.value, (list) => {
  const id = intent.current();
  if (id && !list?.some(e => e.id === id)) intent.cancel();
});
watch(() => props.preview, () => intent.cancel());
onBeforeUnmount(() => intent.cancel());

onMounted(() => { void h.value?.refresh(); });
// Reconnected while open: fetch a fresh list.
watch(isOnline, (online) => { if (online) void h.value?.refresh(); });
</script>

<template>
  <section ref="sectionEl" class="relative" aria-label="Version history" data-testid="version-history">
    <h3 class="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Version history</h3>

    <p v-if="local" class="px-2 py-2 text-xs text-muted-foreground">Local project — no version history.</p>

    <template v-else-if="h">
      <p v-if="note" class="px-2 pb-1 text-[11px] text-muted-foreground" data-testid="version-history-note">{{ note }}</p>

      <div v-if="h.loading.value && !h.entries.value.length" class="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
        <LoaderCircle :size="14" class="animate-spin" aria-hidden="true" /> Loading versions…
      </div>
      <p v-else-if="h.loaded.value && !h.entries.value.length" class="px-2 py-2 text-xs text-muted-foreground">No versions saved yet.</p>

      <ul v-if="rows.length" class="max-h-80 overflow-y-auto -mx-1 px-1" @scroll.passive="onListScroll">
        <template v-for="row in rows" :key="row.type === 'entry' ? row.entry.id : `c-${row.key}`">
          <VersionHistoryItem
            v-if="row.type === 'entry'"
            :entry="row.entry"
            :now="now"
            :can-restore="h.canRestore.value"
            :restoring="h.restoringId.value === row.entry.id"
            :details="details"
            :compare-to-id="olderIds.get(row.entry.id)"
            :previewable="!!preview"
            :touch-preview="touchPreview"
            :preview-shown="shown?.entry.id === row.entry.id"
            @restore="emit('restore', $event)"
            @preview-enter="onPreviewEnter"
            @preview-leave="onPreviewLeave"
            @preview-toggle="onPreviewToggle"
          />
          <li v-else>
            <button
              type="button"
              class="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent/50"
              data-testid="version-history-expand"
              @click="expand(row.key)"
            >
              <ChevronsUpDown :size="12" aria-hidden="true" />
              {{ row.count }} more autosaves
            </button>
          </li>
        </template>
      </ul>

      <Button
        v-if="h.nextCursor.value"
        variant="ghost"
        size="sm"
        class="mt-1 h-7 w-full text-xs"
        :disabled="!isOnline || h.loadingMore.value"
        data-testid="version-history-more"
        @click="h.loadMore()"
      >
        <LoaderCircle v-if="h.loadingMore.value" :size="12" class="animate-spin" aria-hidden="true" />
        Load more
      </Button>

      <VersionPreviewCard
        v-if="preview && shown"
        :key="shown.entry.id"
        class="absolute z-10"
        :class="shown.side ? 'right-full mr-4 pointer-events-none' : 'left-0'"
        :style="{ top: `${shown.top}px` }"
        :preview="preview"
        :entry="shown.entry"
        :now="now"
        :renderer="previewRenderer"
      />
    </template>
  </section>
</template>
