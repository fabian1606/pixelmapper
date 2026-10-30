import { readonly, ref, type DeepReadonly, type Ref } from 'vue';
import { listBoundCloudProjects } from '~/utils/account/local-projects';
import { finishSignOut, flushBeforeSignOut, type PendingAfterFlush, type SignOutDeps } from '~/utils/account/sign-out';

/**
 * Sign-out state machine (ADR 0004 D15, D16), driven by `SignOutDialog`:
 *
 *   idle → syncing → [pending] → [copies] → finishing → idle
 *
 * - `pending`: changes could not be synced (offline) → explicit confirmation.
 * - `copies` (desktop only): keep or remove local copies of cloud projects.
 * Dependencies are injected so the flow is testable without Nuxt.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type SignOutState =
  | { step: 'idle' }
  | { step: 'syncing' }
  | { step: 'pending'; pending: PendingAfterFlush }
  | { step: 'copies'; copies: number; pending: PendingAfterFlush }
  | { step: 'finishing' };

export interface SignOutFlowDeps {
  /** Resolves the dependencies when a sign-out starts (store, sync service, …). */
  resolve(): Promise<SignOutDeps>;
  /** Account to sign out, `null` when nobody is signed in. */
  userId(): string | null;
  /** Called after the session ended (navigation, list refresh). */
  onSignedOut(): void | Promise<void>;
}

export interface SignOutFlow {
  state: DeepReadonly<Ref<SignOutState>>;
  /** Starts the flow (no-op while one is running). */
  start(): Promise<void>;
  /** Confirms signing out despite unsynced changes. */
  confirmPending(): Promise<void>;
  /** Desktop: keep (`true`) or remove the local copies of cloud projects. */
  chooseCopies(keep: boolean): Promise<void>;
  /** Aborts while waiting for a confirmation. */
  cancel(): void;
}

// ── Implementation ───────────────────────────────────────────────────────────

/** Creates an idle flow. */
export function createSignOutFlow(deps: SignOutFlowDeps): SignOutFlow {
  const state = ref<SignOutState>({ step: 'idle' });
  let resolved: SignOutDeps | null = null;
  let userId: string | null = null;

  /** Ends the session, cleaning up according to the policy. */
  async function finish(keepLocalCopies: boolean): Promise<void> {
    state.value = { step: 'finishing' };
    try {
      if (resolved && userId) await finishSignOut(resolved, userId, { keepLocalCopies });
      await deps.onSignedOut();
    }
    catch (err) {
      console.error('[account] sign-out failed:', err);
    }
    finally {
      state.value = { step: 'idle' };
      resolved = null;
      userId = null;
    }
  }

  /** After the pending check: ask about copies (desktop) or finish. */
  async function proceed(pending: PendingAfterFlush): Promise<void> {
    if (!resolved || !userId) return finish(true);
    if (resolved.policy.logoutCache === 'ask') {
      const copies = (await listBoundCloudProjects(resolved.store, userId)).length;
      if (copies > 0) {
        state.value = { step: 'copies', copies, pending };
        return;
      }
    }
    await finish(true);
  }

  return {
    state: readonly(state),
    async start() {
      if (state.value.step !== 'idle') return;
      userId = deps.userId();
      state.value = { step: 'syncing' };
      try {
        resolved = await deps.resolve();
      }
      catch (err) {
        console.error('[account] sign-out setup failed:', err);
        state.value = { step: 'idle' };
        return;
      }
      if (!userId) return finish(true);
      const pending = await flushBeforeSignOut(resolved, userId);
      if (pending.projects + pending.records > 0) {
        state.value = { step: 'pending', pending };
        return;
      }
      await proceed(pending);
    },
    async confirmPending() {
      const s = state.value;
      if (s.step !== 'pending') return;
      await proceed({ ...s.pending });
    },
    async chooseCopies(keep) {
      if (state.value.step !== 'copies') return;
      await finish(keep);
    },
    cancel() {
      if (state.value.step === 'pending' || state.value.step === 'copies') {
        state.value = { step: 'idle' };
        resolved = null;
        userId = null;
      }
    },
  };
}
