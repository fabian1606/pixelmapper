import type { ProjectStore } from '~/utils/persistence/project-store';
import type { ProjectStatePort } from '~/utils/sync/project-state-port';
import type { RemoteClient } from '~/utils/sync/remote-api';
import type { SyncDeps } from '~/utils/sync/sync-context';

/**
 * Backstop for a `SyncEngine` that was stopped (project switch, sign-out)
 * or whose account is no longer signed in (ADR 0004 D15/D16).
 *
 * The engine awaits its running operation on stop, but a hanging request can
 * outlive that wait. Every side effect the sync steps perform goes through
 * `SyncDeps`, so wrapping those makes a late step harmless: remote calls,
 * live-state access (the port is shared with the next project) and store
 * writes throw `SyncBlockedError`, notifications become no-ops.
 */

// ── Error ────────────────────────────────────────────────────────────────────

/** A sync step ran after its engine was stopped or its account left. */
export class SyncBlockedError extends Error {
  constructor(what: string) {
    super(`[sync] ${what} blocked: session closed or account changed`);
    this.name = 'SyncBlockedError';
  }
}

/** Store methods that only read. */
const STORE_READS = new Set(['listProjects', 'getProject', 'getBaseSnapshot', 'getWorkingSnapshot', 'getOutbox', 'countPending']);

// ── Wrappers ─────────────────────────────────────────────────────────────────

/** Store whose writes throw while `allowed()` is false (reads stay open). */
function guardStore(store: ProjectStore, allowed: () => boolean): ProjectStore {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function') return value;
      const fn = value as (...args: unknown[]) => unknown;
      if (STORE_READS.has(String(prop))) return fn.bind(target);
      return (...args: unknown[]) => {
        if (!allowed()) return Promise.reject(new SyncBlockedError(`store.${String(prop)}`));
        return fn.apply(target, args);
      };
    },
  });
}

/** Live-state port that refuses access while `allowed()` is false. */
function guardPort(port: ProjectStatePort, allowed: () => boolean): ProjectStatePort {
  return {
    capture: () => {
      if (!allowed()) throw new SyncBlockedError('port.capture');
      return port.capture();
    },
    apply: (snapshot) => {
      if (!allowed()) throw new SyncBlockedError('port.apply');
      port.apply(snapshot);
    },
    replay: (change) => {
      if (!allowed()) throw new SyncBlockedError('port.replay');
      return port.replay(change);
    },
  };
}

/** Remote client whose calls throw while `allowed()` is false. */
function guardClient(client: RemoteClient, allowed: () => boolean): RemoteClient {
  return {
    functions: {
      invoke: (name, options) => {
        if (!allowed()) return Promise.reject(new SyncBlockedError(`invoke ${name}`));
        return client.functions.invoke(name, options);
      },
    },
  };
}

/** `deps` with every side effect gated by `allowed()`. */
export function guardSyncDeps(deps: SyncDeps, allowed: () => boolean): SyncDeps {
  return {
    ...deps,
    client: guardClient(deps.client, allowed),
    store: guardStore(deps.store, allowed),
    port: guardPort(deps.port, allowed),
    writeWorking: () => (allowed() ? deps.writeWorking() : Promise.resolve()),
    onLiveChanged: deps.onLiveChanged ? () => { if (allowed()) deps.onLiveChanged!(); } : undefined,
    onRebased: deps.onRebased ? () => { if (allowed()) deps.onRebased!(); } : undefined,
    onSequence: deps.onSequence ? (seq) => { if (allowed()) deps.onSequence!(seq); } : undefined,
  };
}
