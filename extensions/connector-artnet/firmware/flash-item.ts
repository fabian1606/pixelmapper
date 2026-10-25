/**
 * Types of the firmware batch (`FlashScheduler`): one update per tube, its
 * status, and the runner that talks to the bridge.
 */
import type { FirmwareImageInfo, FlashJob, NodeId, PortRef, RdmUid } from '../bridge/protocol-model';

/** State of one tube's update. */
export type FlashItemStatus =
  /** Waiting for its port. */
  | 'queued'
  /** `flash` sent; the bridge runs its pre-checks. */
  | 'starting'
  | 'running'
  /** `flashCancel` sent; waiting for phase `cancelled`. */
  | 'cancelling'
  | 'done'
  | 'failed'
  | 'cancelled';

/** One tube to update. */
export interface FlashRequest {
  nodeId: NodeId;
  port: PortRef;
  uid: RdmUid;
  /** Pass `allowDowngrade` (only after the user confirmed). */
  allowDowngrade: boolean;
  /** Trailer of the image (shown while queued). */
  image: FirmwareImageInfo | null;
}

/** One tube's update as the UI sees it (a snapshot; never mutated). */
export interface FlashItem extends Readonly<FlashRequest> {
  /** Unique, increasing. */
  readonly key: number;
  /** Started by this window; false = attached job started elsewhere. */
  readonly ours: boolean;
  readonly status: FlashItemStatus;
  /** Last state the bridge reported. */
  readonly job: FlashJob | null;
  /** Why it failed (English). */
  readonly error: string | null;
  /** The bridge's own text, when it adds something. */
  readonly errorDetail: string | null;
}

/** Talks to the bridge for the scheduler. */
export interface FlashRunner {
  /** Sends `flash`; resolves with the job after the pre-checks. */
  start(request: FlashRequest & { hex: string }): Promise<FlashJob>;
  /** Sends `flashCancel`. */
  cancel(jobId: string): Promise<void>;
}

/** Options of `FlashScheduler`. */
export interface FlashSchedulerOptions {
  runner: FlashRunner;
  /** Called after every state change. */
  onChange?: () => void;
  /** A `flash` answer was lost (timeout/disconnect): call `sync` with a fresh `flashJobs`. */
  onLost?: () => void;
  /** Start paused (nothing is sent until `resume`). */
  paused?: boolean;
}

/** Statuses that hold the port (one job per port). */
const HOLDS_PORT: ReadonlySet<FlashItemStatus> = new Set<FlashItemStatus>(['starting', 'running', 'cancelling']);

/** True while the item occupies its port. */
export function holdsPort(item: Pick<FlashItem, 'status'>): boolean {
  return HOLDS_PORT.has(item.status);
}

/** True while the item has not ended (queued or holding its port). */
export function isItemPending(item: Pick<FlashItem, 'status'>): boolean {
  return item.status === 'queued' || holdsPort(item);
}

/** The tube's pending item, else its latest finished one (items in the order added). */
export function latestItemOf(items: readonly FlashItem[], uid: string): FlashItem | undefined {
  let last: FlashItem | undefined;
  for (const item of items) {
    if (item.uid !== uid) continue;
    if (isItemPending(item)) return item;
    last = item;
  }
  return last;
}
