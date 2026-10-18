/**
 * Teardown of everything that runs on behalf of the signed-in account
 * (ADR 0004 D15/D16): the open project's sync session and background
 * mirroring. Both are registered here by their owners (engine store,
 * account plugin), so the sign-out flow and auth events can stop them
 * without importing Pinia or the plugin.
 *
 * Order matters: mirroring first (a running pass could write copies back
 * that sign-out removes), then the open project (its engine, working
 * snapshot writer, unload handlers and auth listener).
 */

type Teardown = () => Promise<void>;

let closeProject: Teardown | null = null;
let stopMirror: Teardown | null = null;

/** Registered by the engine store while a project session is open. */
export function registerOpenProjectCloser(fn: Teardown | null): void {
  closeProject = fn;
}

/** Registered by the account plugin while mirroring may run. */
export function registerMirrorStopper(fn: Teardown | null): void {
  stopMirror = fn;
}

/** Close the open project's session (flushes its working snapshot first). */
export async function closeOpenProject(): Promise<void> {
  try { await closeProject?.(); }
  catch (err) { console.warn('[account] closing the open project failed:', err); }
}

/** Stop mirroring and wait for a running pass. */
export async function stopMirroring(): Promise<void> {
  try { await stopMirror?.(); }
  catch (err) { console.warn('[account] stopping mirroring failed:', err); }
}

/** Stop mirroring, then close the open project. Never throws. */
export async function teardownAccountSession(): Promise<void> {
  await stopMirroring();
  await closeOpenProject();
}
