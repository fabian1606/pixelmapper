/**
 * Fixture change guards (plan M4.5, API `onBeforeFixtureChange`).
 *
 * Core UI paths that change a fixture's start address, universe or mode
 * call `requestFixtureChanges()` before executing their command. Every
 * registered guard is asked; any `deny` wins (its message is shown as a
 * notification), otherwise all `confirm` messages are shown in one core
 * confirm dialog. Commands themselves never consult guards, so programmatic
 * changes, undo/redo, collaborator changes and replays are never blocked.
 */
import type {
  FixtureChangeGuard,
  FixtureChangeRequest,
  FixtureChangeVerdict,
} from '@pixelmapper/extension-api';
import { requestConfirm } from '~/composables/use-confirm-dialog';
import { notify } from '~/composables/use-notifications';
import { patchStatesDiffer } from './fixture-patch-state';

/** Registered guards. */
const guards = new Set<FixtureChangeGuard>();

/** Default dialog texts. */
const DEFAULT_TITLE = 'Change fixture patch?';
const DEFAULT_CONFIRM_LABEL = 'Change anyway';

/** Registers a guard; returns the unregister function. */
export function registerFixtureChangeGuard(guard: FixtureChangeGuard): () => void {
  guards.add(guard);
  return () => { guards.delete(guard); };
}

/** Removes all guards (tests). */
export function clearFixtureChangeGuards(): void {
  guards.clear();
}

/** Combined answer of all guards for a set of requests. */
export type GuardOutcome =
  | { kind: 'allow' }
  | { kind: 'deny'; messages: string[] }
  | { kind: 'confirm'; prompts: Extract<FixtureChangeVerdict, { action: 'confirm' }>[] };

/** Asks one guard; failures count as allow. */
async function ask(guard: FixtureChangeGuard, request: FixtureChangeRequest): Promise<FixtureChangeVerdict | void> {
  try {
    return await guard(structuredClone(request));
  }
  catch (err) {
    console.error('[fixture-change-guard] guard failed (treated as allow):', err);
    return undefined;
  }
}

/** Evaluates all guards for all requests (requests without a change are skipped). */
export async function evaluateFixtureChanges(requests: readonly FixtureChangeRequest[]): Promise<GuardOutcome> {
  const relevant = requests.filter(r => patchStatesDiffer(r.before, r.after));
  if (guards.size === 0 || relevant.length === 0) return { kind: 'allow' };

  const denials: string[] = [];
  const prompts: Extract<FixtureChangeVerdict, { action: 'confirm' }>[] = [];
  for (const request of relevant) {
    for (const guard of [...guards]) {
      const verdict = await ask(guard, request);
      if (!verdict || verdict.action === 'allow') continue;
      if (verdict.action === 'deny') denials.push(verdict.message ?? '');
      else prompts.push(verdict);
    }
  }
  if (denials.length > 0) return { kind: 'deny', messages: denials.filter(Boolean) };
  if (prompts.length > 0) return { kind: 'confirm', prompts };
  return { kind: 'allow' };
}

/**
 * Entry point of the core UI paths: evaluates the guards and asks the user
 * when needed. Resolves `true` when the change may proceed.
 */
export async function requestFixtureChanges(requests: readonly FixtureChangeRequest[]): Promise<boolean> {
  const outcome = await evaluateFixtureChanges(requests);
  if (outcome.kind === 'allow') return true;
  if (outcome.kind === 'deny') {
    notify({ title: 'Change not possible', description: outcome.messages.join(' ') || undefined, variant: 'warning' });
    return false;
  }
  const [first] = outcome.prompts;
  // Same message from several requests/guards is shown once.
  const messages = [...new Set(outcome.prompts.map(p => p.message))];
  return requestConfirm({
    title: first?.title ?? DEFAULT_TITLE,
    message: messages.join('\n\n'),
    confirmLabel: first?.confirmLabel ?? DEFAULT_CONFIRM_LABEL,
  });
}
