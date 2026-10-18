<script setup lang="ts">
/**
 * "Version history" section of the sync status popover (ADR 0004 D17):
 * the project's server snapshots, newest first, with collapsed autosave
 * runs and "Load more". Restore requests are emitted; the parent confirms
 * and runs them (the dialog must outlive this popover content).
 */
import { computed, onMounted, ref, watch } from 'vue';
import type { SnapshotListEntry } from '~/utils/sync/remote-api-snapshots';
import { isOnline } from '~/utils/sync/connectivity';
import { collapseAutosaves } from '~/utils/sync/version-history';
import type { VersionHistory } from '~/utils/sync/version-history-controller';
import VersionHistoryItem from '~/components/sync/VersionHistoryItem.vue';
import { Button } from '@/components/ui/button';
import { ChevronsUpDown, LoaderCircle } from 'lucide-vue-next';

const props = defineProps<{
  history: VersionHistory | null;
  /** Local-only project: no server, no history. */
  local: boolean;
  now: number;
}>();

const emit = defineEmits<{ restore: [entry: SnapshotListEntry] }>();

/** Expanded autosave runs (keys of `collapsed` rows). */
const expanded = ref(new Set<string>());

const h = computed(() => props.history);
const rows = computed(() => (h.value ? collapseAutosaves(h.value.entries.value, expanded.value) : []));

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

onMounted(() => { void h.value?.refresh(); });
// Reconnected while open: fetch a fresh list.
watch(isOnline, (online) => { if (online) void h.value?.refresh(); });
</script>

<template>
  <section aria-label="Version history" data-testid="version-history">
    <h3 class="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Version history</h3>

    <p v-if="local" class="px-2 py-2 text-xs text-muted-foreground">Local project — no version history.</p>

    <template v-else-if="h">
      <p v-if="note" class="px-2 pb-1 text-[11px] text-muted-foreground" data-testid="version-history-note">{{ note }}</p>

      <div v-if="h.loading.value && !h.entries.value.length" class="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
        <LoaderCircle :size="14" class="animate-spin" aria-hidden="true" /> Loading versions…
      </div>
      <p v-else-if="h.loaded.value && !h.entries.value.length" class="px-2 py-2 text-xs text-muted-foreground">No versions saved yet.</p>

      <ul v-if="rows.length" class="max-h-80 overflow-y-auto -mx-1 px-1">
        <template v-for="row in rows" :key="row.type === 'entry' ? row.entry.id : `c-${row.key}`">
          <VersionHistoryItem
            v-if="row.type === 'entry'"
            :entry="row.entry"
            :now="now"
            :can-restore="h.canRestore.value"
            :restoring="h.restoringId.value === row.entry.id"
            @restore="emit('restore', $event)"
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
    </template>
  </section>
</template>
