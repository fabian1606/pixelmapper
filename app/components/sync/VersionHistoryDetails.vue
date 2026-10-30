<script setup lang="ts">
/**
 * Expanded part of a version-history entry: what changed compared to the
 * previous (older) version — structural diff grouped by kind, then the
 * activity (authors × actions) and restores between the two versions.
 * Loads lazily on mount (the parent only mounts it when expanded).
 */
import { computed, onMounted, watch } from 'vue';
import { isOnline } from '~/utils/sync/connectivity';
import type { VersionDetails } from '~/utils/sync/version-details-controller';
import type { DetailLineKind } from '~/utils/sync/version-details-view';
import { Button } from '@/components/ui/button';
import { LoaderCircle, RotateCcw } from 'lucide-vue-next';

const props = defineProps<{
  details: VersionDetails;
  snapshotId: string;
  /** Older neighbour in the list; null/undefined = server picks it. */
  compareToId?: string | null;
  /** Element id (target of the toggle's `aria-controls`). */
  regionId: string;
}>();

const state = computed(() => props.details.state(props.snapshotId).value);
const view = computed(() => state.value.view);

/** Load (or retry). */
function load(): void {
  void props.details.load(props.snapshotId, props.compareToId);
}

/** Prefix per line kind (screen readers get the word via `title`). */
const MARK: Record<DetailLineKind, { sign: string; cls: string; word: string }> = {
  added: { sign: '+', cls: 'text-emerald-600 dark:text-emerald-400', word: 'Added' },
  removed: { sign: '−', cls: 'text-destructive', word: 'Removed' },
  changed: { sign: '~', cls: 'text-amber-600 dark:text-amber-400', word: 'Changed' },
  info: { sign: '·', cls: 'text-muted-foreground', word: '' },
};

onMounted(load);
// Back online while showing "needs a connection": try again.
watch(isOnline, (online) => { if (online && state.value.status === 'offline') load(); });
</script>

<template>
  <div
    :id="regionId"
    role="region"
    aria-label="Changes in this version"
    class="mt-1 max-h-60 overflow-y-auto rounded-md border bg-muted/30 px-2 py-1.5 text-[11px]"
    data-testid="version-history-details"
  >
    <div v-if="state.status === 'loading' || state.status === 'idle'" class="flex items-center gap-1.5 text-muted-foreground">
      <LoaderCircle :size="12" class="animate-spin" aria-hidden="true" /> Loading changes…
    </div>

    <p v-else-if="state.status === 'offline'" class="text-muted-foreground" data-testid="version-details-offline">
      Details need a connection.
    </p>

    <div v-else-if="state.status === 'error'" class="flex items-center justify-between gap-2" data-testid="version-details-error">
      <span class="text-destructive">{{ state.error }}</span>
      <Button variant="ghost" size="sm" class="h-6 px-2 text-[11px]" data-testid="version-details-retry" @click="load">
        <RotateCcw :size="11" aria-hidden="true" /> Retry
      </Button>
    </div>

    <template v-else-if="view">
      <p v-if="view.restoredFrom" class="mb-1 font-medium">{{ view.restoredFrom }}</p>
      <p v-if="view.first" class="text-muted-foreground">First version</p>
      <p v-else-if="view.noChanges" class="text-muted-foreground">No changes to the project content.</p>

      <section v-for="section in view.sections" :key="section.title" class="mb-1.5 last:mb-0">
        <h4 class="font-semibold text-muted-foreground">{{ section.title }}</h4>
        <ul>
          <li v-for="(line, i) in section.lines" :key="i" class="flex gap-1 min-w-0" :title="MARK[line.kind].word || undefined">
            <span class="w-2 shrink-0 text-center" :class="MARK[line.kind].cls" aria-hidden="true">{{ MARK[line.kind].sign }}</span>
            <span v-if="MARK[line.kind].word" class="sr-only">{{ MARK[line.kind].word }}:</span>
            <span class="break-words min-w-0">{{ line.text }}</span>
          </li>
          <li v-if="section.more" class="pl-3 text-muted-foreground">+{{ section.more }} more</li>
        </ul>
      </section>

      <section v-if="view.activity.length || view.restores.length" class="mt-1.5 border-t pt-1.5" data-testid="version-details-activity">
        <h4 class="font-semibold text-muted-foreground">Activity</h4>
        <p v-for="(line, i) in view.restores" :key="`r${i}`" class="break-words">{{ line }}</p>
        <p v-for="(line, i) in view.activity" :key="`a${i}`" class="break-words">{{ line }}</p>
      </section>
    </template>
  </div>
</template>
