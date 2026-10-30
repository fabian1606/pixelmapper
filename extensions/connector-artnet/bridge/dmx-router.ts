/**
 * Collects the universes of one rendered frame and keeps the route table of
 * the bridge connection (contract §6 `dmxRoutes`, §7).
 *
 * Callers address DMX by target (node + Port-Address, or IP + Port-Address);
 * the router assigns numeric route ids, reports when the table must be
 * re-sent, and hands out the queued universes as frame-set entries. Routes
 * unused for a while are pruned so the table stays small.
 */
import type { DmxTarget } from './backend';
import type { DmxRoute } from './protocol-model';
import type { FrameSetEntry } from './frame-set';
import { MAX_DMX_LENGTH } from './frame-set';

/** Routes not used for this long are dropped from the table. */
const ROUTE_IDLE_MS = 10_000;

/** Highest route id. */
const MAX_ROUTE = 0xffff;

/** One route of the table. */
interface RouteEntry {
  route: number;
  target: DmxTarget;
  lastUsed: number;
}

/** What one flush has to send. */
export interface RouterBatch {
  /** Full route table when it changed since the last batch, else null. */
  routes: DmxRoute[] | null;
  /** Queued universes, one per route (last write wins). */
  entries: FrameSetEntry[];
}

/** Map key of a target. */
function targetKey(t: DmxTarget): string {
  return 'nodeId' in t ? `n|${t.nodeId}|${t.portAddress}` : `i|${t.ip}|${t.portAddress}`;
}

export class DmxRouter {
  private routes = new Map<string, RouteEntry>();
  private pending = new Map<number, Uint8Array>();
  private dirty = false;
  private nextRoute = 1;

  /**
   * @param now Clock (tests).
   * @param validate Returns why a new target is invalid (null = valid). The
   *   bridge rejects a route table with one invalid route as a whole and
   *   keeps the old one, so invalid targets never enter the table.
   */
  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly validate: (target: DmxTarget) => string | null = () => null,
  ) {}

  /**
   * Queues `data` (copied, max 512 bytes) for `target` in the current frame
   * set. Returns why the target was refused, or null when queued.
   */
  queue(target: DmxTarget, data: Uint8Array): string | null {
    const key = targetKey(target);
    let entry = this.routes.get(key);
    if (!entry) {
      const problem = this.validate(target);
      if (problem) return problem;
      const route = this.allocate();
      if (route === null) return 'Too many DMX routes';
      entry = { route, target: { ...target }, lastUsed: 0 };
      this.routes.set(key, entry);
      this.dirty = true;
    }
    entry.lastUsed = this.now();
    this.pending.set(entry.route, data.slice(0, MAX_DMX_LENGTH));
    return null;
  }

  /** True when universes are queued. */
  hasPending(): boolean {
    return this.pending.size > 0;
  }

  /** Takes the queued universes and the route table if it changed; prunes idle routes. */
  take(): RouterBatch {
    const now = this.now();
    for (const [key, entry] of this.routes) {
      if (now - entry.lastUsed > ROUTE_IDLE_MS && !this.pending.has(entry.route)) {
        this.routes.delete(key);
        this.dirty = true;
      }
    }
    const entries = [...this.pending].map(([route, data]) => ({ route, data }));
    this.pending.clear();
    const routes = this.dirty ? this.table() : null;
    this.dirty = false;
    return { routes, entries };
  }

  /** Forces the table to be re-sent with the next batch (new connection). */
  markDirty(): void {
    this.dirty = true;
  }

  /** Drops queued universes (connection lost). */
  clearPending(): void {
    this.pending.clear();
  }

  /** Current route table in contract form. */
  table(): DmxRoute[] {
    return [...this.routes.values()].map(({ route, target }) => ({ route, ...target }));
  }

  /** Next free route id, or null when all 65535 are taken. */
  private allocate(): number | null {
    const used = new Set([...this.routes.values()].map(r => r.route));
    if (used.size >= MAX_ROUTE) return null;
    while (used.has(this.nextRoute)) this.nextRoute = this.nextRoute >= MAX_ROUTE ? 1 : this.nextRoute + 1;
    const route = this.nextRoute;
    this.nextRoute = route >= MAX_ROUTE ? 1 : route + 1;
    return route;
  }
}
