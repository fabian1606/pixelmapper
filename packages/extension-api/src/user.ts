/**
 * The current user (API 1.4).
 *
 * Extensions that keep per-user state outside the project (e.g. dismissed
 * suggestions in `localStorage`) namespace it with the user key, like the
 * host does for connector setups (ADR D18).
 */
import { getHostApi } from './host';

/**
 * Key of the current user for per-user storage: the signed-in user's id,
 * else `'local'`. Reactive when read inside a `computed`/template, so state
 * keyed by it follows a sign-in or user switch.
 *
 * @example
 * const key = computed(() => `pm:my-extension:dismissed:${getUserKey()}`);
 */
export function getUserKey(): string {
  return getHostApi().getUserKey();
}
