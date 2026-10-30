/**
 * Account boot (ADR 0004 D13, D14): watches auth state changes and
 * - remembers account labels for the "Owned by …" badge (D15),
 * - on a real sign-in adopts local-only user records (custom fixtures) and,
 *   on desktop, queues the "Upload to your account?" dialog (D14),
 * - on desktop mirrors the account's cloud projects in the background while
 *   signed in and online (on sign-in, on reconnect, every 5 minutes).
 * - on sign-out or an account switch stops mirroring and closes the open
 *   project's sync session; on the web, a sign-in of another account removes
 *   synced copies an automatic sign-out left behind (D16).
 * `onAuthStateChange` reads the cached session, so this works offline; an
 * offline boot without a usable token falls back to the cached session.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccountPolicy } from '#platform';
import { getProjectStore } from '~/utils/persistence/project-store';
import { adoptLocalRecords, clearForeignRecords } from '~/utils/sync/records';
import type { RemoteClient } from '~/utils/sync/remote-api';
import { notify } from '~/composables/use-notifications';
import { rememberAccount, type AccountIdentity } from '~/utils/account/known-accounts';
import { createLoginTracker } from '~/utils/account/login-transition';
import { createMirrorScheduler, type MirrorScheduler } from '~/utils/account/mirror-scheduler';
import { runMirrorPass } from '~/utils/account/mirror';
import { tryGetProjectSyncService } from '~/utils/account/sync-service';
import { createAccountEventHandler } from '~/utils/account/account-events';
import { clearForeignCopies } from '~/utils/account/foreign-cache';
import { closeOpenProject, registerMirrorStopper } from '~/utils/account/session-teardown';
import { bumpLocalProjects, pendingLoginReview, setMirrorTrigger } from '~/composables/account/account-state';

export default defineNuxtPlugin({
  name: 'pm:account',
  dependsOn: ['supabase'],
  setup() {
    const policy = getAccountPolicy();
    let supabase: SupabaseClient;
    try {
      supabase = useSupabaseClient() as unknown as SupabaseClient;
    }
    catch (err) {
      console.warn('[account] Supabase unavailable, account features disabled:', err);
      return;
    }
    const tracker = createLoginTracker(safeLocalStorage());

    // ── Mirroring (desktop) ──────────────────────────────────────────────────

    let scheduler: MirrorScheduler | null = null;
    let mirrorUserId: string | null = null;
    /** Account whose mirroring the sign-out flow stopped (no restart until signed out). */
    let suspendedFor: string | null = null;

    /** One mirror pass for the current account; false → retry with backoff. */
    async function mirrorPass(userId: string): Promise<boolean> {
      const sync = tryGetProjectSyncService();
      if (!sync) return false; // sync engine not registered yet
      const res = await runMirrorPass({
        client: supabase as unknown as RemoteClient,
        store: await getProjectStore(),
        sync,
        userId,
        isCancelled: () => mirrorUserId !== userId,
      });
      if (!res.ok) return false;
      if (res.mirrored || res.reconcile.removed.length || res.reconcile.markedDeleted.length) bumpLocalProjects();
      if (res.reconcile.markedDeleted.length) {
        notify({ variant: 'warning', title: 'Project deleted on the server', description: `${res.reconcile.markedDeleted.map(m => m.name).join(', ')} still had unsynced changes and was kept on this device.` });
      }
      return res.failed === 0;
    }

    /** Starts, restarts or stops mirroring for `userId`. */
    function setMirrorUser(userId: string | null): void {
      if (!policy.mirrorCloudProjects || userId === mirrorUserId) return;
      if (userId && userId === suspendedFor) return;
      scheduler?.stop();
      scheduler = null;
      setMirrorTrigger(null);
      mirrorUserId = userId;
      if (!userId) return;
      const next = createMirrorScheduler({ runPass: () => mirrorPass(userId) });
      scheduler = next;
      setMirrorTrigger(() => next.trigger());
      next.start();
    }

    // The sign-out flow stops mirroring (and waits for a running pass) before
    // it removes the account's copies; no event may restart it until then.
    registerMirrorStopper(async () => {
      const running = scheduler;
      suspendedFor = mirrorUserId;
      setMirrorUser(null);
      await running?.whenIdle();
    });

    // ── Sign-in ──────────────────────────────────────────────────────────────

    /** A real sign-in (not a refresh or a restored session). */
    async function onSignedIn(account: AccountIdentity): Promise<void> {
      adoptLocalRecords(account.id).catch(err => console.warn('[account] adopting local records failed:', err));
      if (policy.offerUploadOnLogin) pendingLoginReview.value = account;
      if (policy.logoutCache === 'clear') await clearOtherAccounts(account.id);
    }

    /**
     * Web (D16): an automatic sign-out (rejected refresh, 401) could not clear
     * the cache. Remove what other accounts left behind as soon as another
     * account signs in, keeping anything unsynced (it syncs when its owner
     * signs in again; the web never shows it to this account).
     */
    async function clearOtherAccounts(userId: string): Promise<void> {
      try {
        const res = await clearForeignCopies(await getProjectStore(), userId);
        const records = await clearForeignRecords(userId);
        if (res.removed.length) bumpLocalProjects();
        const kept = [
          res.keptPending.length ? `${res.keptPending.length} project(s)` : '',
          records.keptDirty ? `${records.keptDirty} custom fixture(s)` : '',
        ].filter(Boolean).join(' and ');
        if (kept) {
          notify({ variant: 'warning', title: 'Unsynced changes of another account', description: `${kept} of a previously signed-in account still have unsynced changes. They stay on this device until that account signs in again.` });
        }
      }
      catch (err) {
        console.warn('[account] clearing other accounts\' copies failed:', err);
      }
    }

    // ── Auth events ──────────────────────────────────────────────────────────

    const handler = createAccountEventHandler({
      auth: supabase.auth,
      tracker,
      rememberAccount,
      onSignedIn,
      setMirrorUser,
      closeOpenProject,
      onSignedOut: () => {
        pendingLoginReview.value = null;
        suspendedFor = null;
      },
    });
    supabase.auth.onAuthStateChange((event, session) => {
      // Synchronous: a sync engine of the previous account stops right away.
      handler.note(event, session);
      // Defer: awaiting Supabase calls inside this callback can deadlock the auth client.
      setTimeout(() => { void handler.handle(event, session); }, 0);
    });
  },
});

/** localStorage, or null where it is unavailable (private mode, sandbox). */
function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  }
  catch {
    return null;
  }
}
