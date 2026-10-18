import { installSyncConflictToast } from '~/composables/use-sync-conflict-toast';

/**
 * Shows the sync conflict toast after offline rebases (ADR 0004 D17).
 * Runs once on the client; the listener lives for the whole app session.
 */
export default defineNuxtPlugin(() => {
  installSyncConflictToast();
});
