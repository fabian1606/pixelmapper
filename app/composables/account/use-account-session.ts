import { computed } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccountPolicy } from '#platform';
import { getProjectStore } from '~/utils/persistence/project-store';
import { clearLocalRecords, countPendingRecords, syncAllRecords } from '~/utils/sync/records';
import { identityFromUser } from '~/utils/account/known-accounts';
import { tryGetProjectSyncService } from '~/utils/account/sync-service';
import { bumpLocalProjects } from './account-state';
import { createSignOutFlow, type SignOutFlow } from './sign-out-flow';

/**
 * The signed-in account and the single sign-out entry point (ADR 0004 D3,
 * D15, D16). Every deliberate sign-out goes through `signOut()`, which runs
 * the flow shown by `SignOutDialog` (sync first, confirm unsynced changes,
 * desktop: keep or remove local copies).
 */

let flow: SignOutFlow | null = null;

/** Account composable; call from setup (needs the Nuxt context). */
export function useAccountSession() {
  const supabase = useSupabaseClient() as unknown as SupabaseClient;
  const userState = useSupabaseUser();
  const router = useRouter();
  const policy = getAccountPolicy();

  /** Signed-in account, `null` when signed out. */
  const account = computed(() => identityFromUser(userState.value));

  if (!flow) {
    flow = createSignOutFlow({
      resolve: async () => ({
        policy,
        store: await getProjectStore(),
        sync: tryGetProjectSyncService(),
        records: { syncAllRecords, countPendingRecords, clearLocalRecords },
        auth: supabase.auth,
      }),
      userId: () => identityFromUser(userState.value)?.id ?? null,
      onSignedOut: async () => {
        bumpLocalProjects();
        await router.push(policy.accountRequired ? '/auth/login' : '/');
      },
    });
  }
  const signOutFlow = flow;

  return {
    account,
    policy,
    /** Sign-out flow state for the dialog. */
    signOutState: signOutFlow.state,
    /** Starts the sign-out flow. */
    signOut: () => signOutFlow.start(),
    confirmPendingSignOut: () => signOutFlow.confirmPending(),
    chooseLocalCopies: (keep: boolean) => signOutFlow.chooseCopies(keep),
    cancelSignOut: () => signOutFlow.cancel(),
  };
}
