/**
 * The account this tab is signed in as, as last reported by an auth event
 * (ADR 0004 D15/D16). Synchronous, so sync code can check it right before
 * a network call or a store write without awaiting the auth client.
 *
 * - `undefined`: no auth event seen yet (boot, unit tests) → unknown;
 * - `null`: signed out;
 * - a string: the signed-in account id.
 *
 * Set by `05.account.client.ts`.
 */

let current: string | null | undefined;

/** Record the signed-in account (`null` = signed out). */
export function setCurrentAccountId(id: string | null): void {
  current = id;
}

/** Last known account; `undefined` before the first auth event. */
export function getCurrentAccountId(): string | null | undefined {
  return current;
}

/**
 * True unless the known account differs from `userId` (also when signed
 * out). An unknown account does not block: the open flow already checked
 * the binding with the resolved user.
 */
export function isCurrentAccount(userId: string): boolean {
  return current === undefined || current === userId;
}

/** Test helper: forget the account. */
export function resetCurrentAccount(): void {
  current = undefined;
}
