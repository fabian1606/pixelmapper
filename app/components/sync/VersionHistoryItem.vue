<script setup lang="ts">
/**
 * One server snapshot in the version history: label badge, relative and
 * absolute time, author, summary and a Restore button.
 */
import { computed } from 'vue';
import type { SnapshotListEntry } from '~/utils/sync/remote-api-snapshots';
import { absoluteTime, relativeTime } from '~/utils/sync/relative-time';
import { formatSummary, snapshotBadge } from '~/utils/sync/version-history';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoaderCircle, RotateCcw } from 'lucide-vue-next';

const props = defineProps<{
  entry: SnapshotListEntry;
  /** Current time (ticks) for the relative time. */
  now: number;
  canRestore: boolean;
  restoring: boolean;
}>();

const emit = defineEmits<{ restore: [entry: SnapshotListEntry] }>();

const createdMs = computed(() => Date.parse(props.entry.createdAt));
const badge = computed(() => snapshotBadge(props.entry.label));
const when = computed(() => relativeTime(createdMs.value, props.now));
const absolute = computed(() => absoluteTime(createdMs.value));
const summary = computed(() => formatSummary(props.entry.summary));
</script>

<template>
  <li class="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50" data-testid="version-history-item">
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
  </li>
</template>
