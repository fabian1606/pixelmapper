/**
 * Account boot (ADR 0004 D13, D14): watches auth state changes and
 * - remembers account labels for the "Owned by …" badge (D15),
 * - on a real sign-in adopts local-only user records (custom fixtures) and,
 *   on desktop, queues the "Upload to your account?" dialog (D14),
 * - on desktop mirrors the account's cloud projects in the background while
 *   signed in and online (on sign-in, on reconnect, every 5 minutes).
 * `onAuthStateChange` reads the cached session, so this works offline.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccountPolicy } from '#platform';
import { getProjectStore } from '~/utils/persistence/project-store';
import { adoptLocalRecords } from '~/utils/sync/records';
import type { RemoteClient } from '~/utils/sync/remote-api';
import { notify } from '~/composables/use-notifications';
import { rememberAccount, type AccountIdentity } from '~/utils/account/known-accounts';
import { createLoginTracker } from '~/utils/account/login-transition';
import { createMirrorScheduler, type MirrorScheduler } from '~/utils/account/mirror-scheduler';
import { runMirrorPass } from '~/utils/account/mirror';
import { tryGetProjectSyncService } from '~/utils/account/sync-service';
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

    // ── Sign-in ──────────────────────────────────────────────────────────────

    /** A real sign-in (not a refresh or a restored session). */
    function onSignedIn(account: AccountIdentity): void {
      adoptLocalRecords(account.id).catch(err => console.warn('[account] adopting local records failed:', err));
      if (policy.offerUploadOnLogin) pendingLoginReview.value = account;
    }

    // ── Auth events ──────────────────────────────────────────────────────────

    supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user;
      const account: AccountIdentity | null = user ? { id: user.id, label: user.email ?? null } : null;
      // Defer: awaiting Supabase calls inside this callback can deadlock the auth client.
      setTimeout(() => {
        if (account) rememberAccount(account);
        const signedIn = tracker.observe(event, account?.id ?? null);
        if (signedIn && account) onSignedIn(account);
        if (event === 'SIGNED_OUT') {
          pendingLoginReview.value = null;
          setMirrorUser(null);
        }
        else if (account) {
          setMirrorUser(account.id);
        }
      }, 0);
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
