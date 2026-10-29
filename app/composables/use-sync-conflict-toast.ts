/**
 * Conflict toast after an offline rebase (ADR 0004 D5, D17).
 *
 * Subscribes to conflict reports of the sync engine, lists the conflicts in
 * human terms and offers "Restore state before sync" when a pre-sync
 * snapshot exists.
 */
import { dismiss, notify } from '~/composables/use-notifications';
import type { AppNotificationAction } from '~/composables/use-notifications';
import { modifierName } from '~/utils/engine/modifiers';
import { describeConflicts } from '~/utils/sync/describe-conflicts';
import { onSyncConflicts } from '~/utils/sync/sync-conflicts';
import type { SyncConflictReport } from '~/utils/sync/sync-conflicts';

/** Restores the pre-sync snapshot, closes the toast and reports the result. */
async function restoreBeforeSync(report: SyncConflictReport, toastId: number): Promise<void> {
  const ok = await report.restore();
  dismiss(toastId);
  if (ok) {
    notify({ title: 'Restored state before sync', description: 'The project was reloaded from the snapshot taken before syncing.' });
  }
  else {
    notify({ title: 'Restore failed', description: 'The state before sync could not be restored.', variant: 'error' }, 8000);
  }
}

/** Shows the conflict toast for one report. */
function showConflictToast(report: SyncConflictReport): void {
  const lines = describeConflicts(report.items, report.state, { modifierName });
  const actions: AppNotificationAction[] = [];
  // Filled below once the toast id is known (the action needs it to dismiss).
  let toastId = 0;
  if (report.canRestore) {
    actions.push({ label: 'Restore state before sync', run: () => restoreBeforeSync(report, toastId) });
  }
  toastId = notify({
    title: 'Sync conflicts resolved',
    description: 'Your offline changes were kept for these fields:',
    lines,
    actions,
    variant: 'warning',
  }, 0);
}

/** Installs the conflict toast; returns an uninstall function. */
export function installSyncConflictToast(): () => void {
  return onSyncConflicts((report) => {
    try { showConflictToast(report); }
    catch (err) { console.error('[sync] conflict toast failed:', err); }
  });
}
