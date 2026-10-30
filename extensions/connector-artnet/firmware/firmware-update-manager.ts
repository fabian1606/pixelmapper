/**
 * App-wide state of tube firmware updates: one `FlashScheduler` per
 * backend, fed by `flashProgress` and `flashJobs`, exposed reactively.
 *
 * It lives outside components, so a batch keeps running when its dialog
 * closes, and the inspector's button and the node's dialog show the same
 * jobs. While the bridge is not connected nothing new is started; after
 * every (re)connect the bridge's job list is read first (re-attach after a
 * reload, jobs that ended while disconnected), then the queue continues.
 */
import { effectScope, shallowRef, watch, type EffectScope, type ShallowRef } from 'vue';
import { BridgeCommandError, type ArtNetBackend } from '../bridge/backend';
import type { RdmUid } from '../bridge/protocol-model';
import { getArtNetBackend } from '../bridge/shared';
import { latestItemOf, type FlashItem, type FlashRequest } from './flash-item';
import { FlashScheduler } from './flash-scheduler';

/** Reactive firmware update state of one backend (see file comment). */
export class FirmwareUpdateManager {
  /** Every update known to this window, in the order added (reactive snapshot). */
  readonly items: ShallowRef<readonly FlashItem[]> = shallowRef([]);
  /**
   * True once the bridge's job list was read since the last connect (also
   * when reading it failed for a reason other than the connection).
   */
  readonly synced: ShallowRef<boolean> = shallowRef(false);

  private readonly scheduler: FlashScheduler;
  private readonly scope: EffectScope = effectScope(true);
  private readonly off: () => void;

  constructor(private readonly backend: ArtNetBackend) {
    this.scheduler = new FlashScheduler({
      runner: {
        start: async ({ nodeId, port, uid, hex, allowDowngrade }) => (await backend.request('flash', { nodeId, port, uid, hex, allowDowngrade })).job,
        cancel: async (jobId) => { await backend.request('flashCancel', { jobId }); },
      },
      paused: true,
      onChange: () => { this.items.value = this.scheduler.items(); },
      onLost: () => { void this.refreshJobs(); },
    });
    this.off = backend.on('flashProgress', e => this.scheduler.handleProgress(e.job));
    this.scope.run(() => {
      watch(() => backend.state.value.kind, (kind) => {
        if (kind === 'connected') void this.refreshJobs();
        else {
          this.synced.value = false;
          this.scheduler.pause();
        }
      }, { immediate: true });
    });
  }

  /** The tube's pending update, else its latest finished one. */
  latest(uid: RdmUid): FlashItem | undefined {
    return latestItemOf(this.items.value, uid);
  }

  /** Queues updates of these tubes with the image `hex` (see `FlashScheduler.enqueue`). */
  enqueue(requests: readonly FlashRequest[], hex: string): FlashItem[] {
    return this.scheduler.enqueue(requests, hex);
  }

  /** Cancels the pending updates `filter` accepts (all by default). */
  cancel(filter?: (item: FlashItem) => boolean): Promise<void> {
    return this.scheduler.cancel(filter);
  }

  /** Reads `flashJobs`, applies it and lets the queue continue. */
  async refreshJobs(): Promise<void> {
    try {
      const { jobs } = await this.backend.request('flashJobs', {});
      this.scheduler.sync(jobs);
      this.synced.value = true;
    }
    catch (err) {
      // Without a connection the watcher resumes after the next connect.
      if (err instanceof BridgeCommandError && (err.code === 'notConnected' || err.code === 'disconnected')) return;
      console.warn('[artnet] reading firmware jobs failed:', err);
      this.synced.value = true;
    }
    if (this.backend.state.value.kind === 'connected') this.scheduler.resume();
  }

  /** Stops listening (tests, backend replaced). */
  dispose(): void {
    this.off();
    this.scope.stop();
    this.scheduler.pause();
  }
}

/** Managers by backend (one per app-wide backend). */
const managers = new WeakMap<ArtNetBackend, FirmwareUpdateManager>();

/** The shared manager of `backend` (default: the app-wide bridge connection). */
export function getFirmwareUpdateManager(backend: ArtNetBackend = getArtNetBackend()): FirmwareUpdateManager {
  let manager = managers.get(backend);
  if (!manager) managers.set(backend, manager = new FirmwareUpdateManager(backend));
  return manager;
}
