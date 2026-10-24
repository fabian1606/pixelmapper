/**
 * Adapter to the host's connector set for things the extension API does
 * not offer yet (plan M5.2: “Connect” on a suggested node creates a
 * connector instance; dismissals are stored per user).
 *
 * TEMPORARY: until the core exposes `connectors.add(connector)` and the
 * current user id to extensions (requested in the WP2 report), the add path
 * falls back to the host's Pinia store `connections` and the user key to
 * `'local'`. Everything else in the extension goes through this file, so
 * the workaround is removed in one place.
 */
import { getActivePinia } from 'pinia';
import { getHostApi, type Connector } from '@pixelmapper/extension-api';

/** What the extension needs from the host's connector set. */
export interface HostConnectorSet {
  /** Adds an instance (persisted per user; always-connected ones connect at once). */
  add(connector: Connector): void;
}

/** Host API members this adapter uses once the core provides them. */
interface FutureHostApi {
  connectors?: Partial<HostConnectorSet>;
  currentUserId?: () => string | null;
}

/** The host API, or null outside the app (tests). */
function hostApi(): FutureHostApi | null {
  try {
    return getHostApi() as unknown as FutureHostApi;
  }
  catch {
    return null;
  }
}

/** The host's connector set, or null when it cannot be reached. */
export function getHostConnectorSet(): HostConnectorSet | null {
  const api = hostApi()?.connectors;
  if (typeof api?.add === 'function') return { add: c => api.add!(c) };
  // Workaround: the host's connections store (same Pinia instance as ours).
  const pinia = getActivePinia() as unknown as { _s?: Map<string, unknown> } | undefined;
  const store = pinia?._s?.get('connections') as Partial<HostConnectorSet> | undefined;
  return typeof store?.add === 'function' ? { add: c => store.add!(c) } : null;
}

/** Key of the current user for per-user storage (`'local'` until the core exposes the user). */
export function hostUserKey(): string {
  return hostApi()?.currentUserId?.() || 'local';
}
