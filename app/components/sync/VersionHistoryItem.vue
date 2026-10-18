<script setup lang="ts">
/**
 * One server snapshot in the version history: label badge, relative and
 * absolute time, author, summary and a Restore button. With a details
 * loader, a chevron expands it to show what changed since the previous
 * version (`VersionHistoryDetails`, loaded lazily on first expand).
 */
import { computed, ref } from 'vue';
import type { SnapshotListEntry } from '~/utils/sync/remote-api-snapshots';
import { absoluteTime, relativeTime } from '~/utils/sync/relative-time';
import type { VersionDetails } from '~/utils/sync/version-details-controller';
import { formatSummary, snapshotBadge } from '~/utils/sync/version-history';
import VersionHistoryDetails from '~/components/sync/VersionHistoryDetails.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronRight, LoaderCircle, RotateCcw } from 'lucide-vue-next';

const props = defineProps<{
  entry: SnapshotListEntry;
  /** Current time (ticks) for the relative time. */
  now: number;
  canRestore: boolean;
  restoring: boolean;
  /** Details loader; no chevron without it. */
  details?: VersionDetails | null;
  /** Id of the next older entry in the list (diff base). */
  compareToId?: string | null;
}>();

const emit = defineEmits<{ restore: [entry: SnapshotListEntry] }>();

const expanded = ref(false);
const regionId = computed(() => `version-details-${props.entry.id}`);

const createdMs = computed(() => Date.parse(props.entry.createdAt));
const badge = computed(() => snapshotBadge(props.entry.label));
const when = computed(() => relativeTime(createdMs.value, props.now));
const absolute = computed(() => absoluteTime(createdMs.value));
const summary = computed(() => formatSummary(props.entry.summary));
</script>

<template>
  <li class="rounded-md px-2 py-1.5 hover:bg-accent/50" data-testid="version-history-item">
    <div class="flex items-start gap-1">
      <button
        v-if="details"
        type="button"
        class="mt-0.5 -ml-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-expanded="expanded"
        :aria-controls="regionId"
        :aria-label="`${expanded ? 'Hide' : 'Show'} changes of version from ${absolute}`"
        data-testid="version-history-toggle"
        @click="expanded = !expanded"
      >
        <ChevronRight :size="14" class="transition-transform" :class="expanded ? 'rotate-90' : ''" aria-hidden="true" />
      </button>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <Badge :variant="badge.variant" class="max-w-36 truncate" :title="entry.label ?? 'Autosave'">{{ badge.text }}</Badge>
          <span class="text-xs font-medium truncate">{{ when }}</span>
        </div>
        <p class="text-[11px] text-muted-foreground truncate" :title="`Change #${entry.sequenceNumber}`">
          {{ absolute }}<template v-if="entry.authorName"> · {{ entry.authorName }}</template>
        </p>
        <p class="text-[11px] text-muted-foreground truncate">{{ summary }}</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 px-2 text-xs shrink-0"
        :disabled="!canRestore"
        :aria-label="`Restore version from ${absolute}`"
        @click="emit('restore', entry)"
      >
        <LoaderCircle v-if="restoring" :size="12" class="animate-spin" aria-hidden="true" />
        <RotateCcw v-else :size="12" aria-hidden="true" />
        Restore
      </Button>
    </div>
    <VersionHistoryDetails
      v-if="details && expanded"
      :details="details"
      :snapshot-id="entry.id"
      :compare-to-id="compareToId"
      :region-id="regionId"
    />
  </li>
</template>
