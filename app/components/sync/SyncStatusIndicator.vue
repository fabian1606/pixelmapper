<script setup lang="ts">
/**
 * Header icon showing the sync state of the open project (ADR 0004 D17).
 *
 * Clicking it opens a popover with the current status (state, pending
 * changes, last sync) and the project's version history. Restoring a
 * version asks for confirmation here (outside the popover, which closes
 * when the dialog takes focus) and runs through the version-history
 * controller (flush pending changes → restore RPC → reload).
 */
import { computed, ref, toRef } from 'vue';
import { notify } from '~/composables/use-notifications';
import { useSyncStatusView } from '~/composables/sync/use-sync-status-view';
import { useVersionDetails } from '~/composables/sync/use-version-details';
import { useVersionHistory } from '~/composables/sync/use-version-history';
import { syncStatus } from '~/utils/sync/project-sync-service';
import type { SnapshotListEntry } from '~/utils/sync/remote-api-snapshots';
import { absoluteTime } from '~/utils/sync/relative-time';
import type { RestoreOutcome } from '~/utils/sync/version-history-controller';
import VersionHistoryPanel from '~/components/sync/VersionHistoryPanel.vue';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';

const props = defineProps<{ projectId: string }>();

const { shownState, view, pending, inlineText, details, ariaLabel, now } = useSyncStatusView();
const history = useVersionHistory(toRef(props, 'projectId'));
const versionDetails = useVersionDetails(toRef(props, 'projectId'));

const open = ref(false);
const isLocal = computed(() => shownState.value === 'local-only');
const lastSyncedAbsolute = computed(() => {
  const last = syncStatus.value.lastSyncedAt;
  return last ? absoluteTime(last) : '';
});

// ── Restore ──────────────────────────────────────────────────────────────────

/**
 * Entry waiting for confirmation. Kept separate from `dialogOpen`: reka's
 * AlertDialogAction closes the dialog BEFORE our click handler runs, so
 * clearing the entry on close would make the confirm a silent no-op.
 */
const confirmEntry = ref<SnapshotListEntry | null>(null);
const dialogOpen = ref(false);

/** Popover → confirmation dialog. */
function requestRestore(entry: SnapshotListEntry): void {
  open.value = false;
  confirmEntry.value = entry;
  dialogOpen.value = true;
}

/** Toast per outcome. */
const OUTCOME_TOAST: Record<RestoreOutcome, Parameters<typeof notify>[0]> = {
  'restored': { title: 'Version restored', description: 'The project was reloaded from the selected version.' },
  'pending': { title: 'Restore cancelled', description: 'Unsynced changes could not be uploaded. Try again once they are synced.', variant: 'warning' },
  'failed': { title: 'Restore failed', description: 'The selected version could not be restored.', variant: 'error' },
  'unavailable': { title: 'Restore unavailable', description: 'Restoring needs a connection and edit access.', variant: 'warning' },
};

/** Confirmed: run the restore and report the result. */
async function confirmRestore(): Promise<void> {
  const entry = confirmEntry.value;
  confirmEntry.value = null;
  if (!entry || !history.value) return;
  const outcome = await history.value.restore(entry);
  notify(OUTCOME_TOAST[outcome], outcome === 'restored' ? 6000 : 8000);
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
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
    </PopoverTrigger>
    <PopoverContent side="bottom" align="end" class="w-96 max-w-[calc(100vw-1rem)] p-2" data-testid="sync-status-popover">
      <div class="flex items-start gap-2 px-2 py-1.5">
        <component :is="view.icon" :size="16" class="mt-0.5 shrink-0" :class="[view.tone, shownState === 'syncing' ? 'animate-spin' : '']" aria-hidden="true" />
        <div class="min-w-0">
          <p class="text-sm font-medium">
            {{ view.label }}<template v-if="shownState === 'offline' && pending > 0"> · {{ pending }} pending</template>
          </p>
          <p v-for="(line, i) in details" :key="i" class="text-xs text-muted-foreground break-words">{{ line }}</p>
          <p v-if="lastSyncedAbsolute && !isLocal" class="text-[11px] text-muted-foreground">{{ lastSyncedAbsolute }}</p>
        </div>
      </div>
      <Separator class="my-1.5" />
      <VersionHistoryPanel :history="history" :local="isLocal" :now="now" :details="versionDetails" @restore="requestRestore" />
    </PopoverContent>
  </Popover>

  <AlertDialog v-model:open="dialogOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Restore this version?</AlertDialogTitle>
        <AlertDialogDescription>
          Your current state is kept in history.
          <template v-if="confirmEntry"> The project will reload with the version from {{ absoluteTime(Date.parse(confirmEntry.createdAt)) }}.</template>
          <template v-if="pending > 0"> {{ pending }} unsynced change{{ pending === 1 ? '' : 's' }} will be uploaded first.</template>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction data-testid="version-restore-confirm" @click="confirmRestore">Restore</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
