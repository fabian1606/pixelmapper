/**
 * What the tubes of the update dialog report about their firmware (DEVICE_INFO
 * model + version, SOFTWARE_VERSION_LABEL), read a few at a time.
 *
 * Tubes are read when they appear and after a reconnect — but only once
 * the bridge's job list is known (`ready`), so tubes that are being updated
 * (they run their bootloader) are never read. A finished job reports the
 * new version, which replaces the reading without another request.
 */
import { computed, onScopeDispose, shallowReactive, shallowRef, watch, type Ref } from 'vue';
import type { RdmUid } from '../bridge/protocol-model';
import { describeRdmError } from '../rdm/parameter-form/rdm-errors';
import { runLimited } from '../rdm/parameter-form/use-rdm-parameter-form';
import type { TubeReading } from './firmware-eligibility';
import { isItemPending, latestItemOf, type FlashItem } from './flash-item';
import type { NodeTube } from './tube-devices';

/** Inputs of `useTubeReadings`. */
export interface TubeReadingsOptions {
  /** The tubes to read. */
  tubes: Readonly<Ref<readonly NodeTube[]>>;
  /** Updates of these tubes (pending ones are not read; finished ones give the new version). */
  items: Readonly<Ref<readonly FlashItem[]>>;
  /** Bridge connected. */
  connected: Readonly<Ref<boolean>>;
  /** Connected and the bridge's job list is known: automatic reads may run. */
  ready: Readonly<Ref<boolean>>;
  /** Reads one tube. */
  readTube: (tube: NodeTube) => Promise<TubeReading>;
  /** Tubes read at once. */
  concurrency: number;
  /** Read automatically. */
  autoRead: boolean;
}

/** Readings per UID (see file comment). Call inside a component's `setup` or an effect scope. */
export function useTubeReadings(options: TubeReadingsOptions) {
  const readings = shallowReactive(new Map<RdmUid, TubeReading>());
  const reads = shallowRef(0);
  const readingTubes = computed(() => reads.value > 0);
  let disposed = false;
  onScopeDispose(() => { disposed = true; });

  /** The reading of a tube; not read yet = being read, or waiting for the bridge. */
  function readingOf(uid: RdmUid): TubeReading {
    return readings.get(uid) ?? (options.connected.value ? { state: 'loading' } : { state: 'error', message: 'The Art-Net bridge is not connected' });
  }

  /**
   * Reads the tubes: new ones, plus failed ones with `retryErrors`, plus all
   * with `force` — never tubes that are being updated.
   */
  async function readTubes(mode: { force?: boolean; retryErrors?: boolean } = {}): Promise<void> {
    if (!options.connected.value) return;
    const list = options.tubes.value.filter((t) => {
      const item = latestItemOf(options.items.value, t.uid);
      if (item && isItemPending(item)) return false;
      const r = readings.get(t.uid);
      return mode.force ? r?.state !== 'loading' : !r || (mode.retryErrors === true && r.state === 'error');
    });
    if (!list.length) return;
    for (const t of list) readings.set(t.uid, { state: 'loading' });
    reads.value++;
    try {
      await runLimited(list, options.concurrency, async (t) => {
        let reading: TubeReading;
        try {
          reading = await options.readTube(t);
        }
        catch (err) {
          reading = { state: 'error', message: describeRdmError(err) };
        }
        if (!disposed) readings.set(t.uid, reading);
      });
    }
    finally {
      reads.value--;
    }
  }

  // A finished job reports the new version: take it instead of reading again.
  const applied = new Set<string>();
  watch(options.items, (items) => {
    for (const item of items) {
      const job = item.job;
      if (item.status !== 'done' || !job?.result || applied.has(job.jobId)) continue;
      applied.add(job.jobId);
      const before = readings.get(item.uid);
      readings.set(item.uid, {
        state: 'ok',
        deviceModelId: before?.state === 'ok' ? before.deviceModelId : job.image.modelId,
        softwareVersionId: job.result.softwareVersionId,
        softwareVersionLabel: job.result.softwareVersionLabel,
      });
    }
  }, { immediate: true });

  if (options.autoRead) {
    watch(() => options.tubes.value.map(t => t.uid).join(','), () => { if (options.ready.value) void readTubes(); });
    watch(options.ready, (now) => { if (now) void readTubes({ retryErrors: true }); }, { immediate: true });
  }

  return { readingOf, readingTubes, readTubes };
}
