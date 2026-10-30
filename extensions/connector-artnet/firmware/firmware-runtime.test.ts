/**
 * Firmware runtime (plan M7.4): the update manager is created only once
 * Art-Net is in use (then it re-attaches to the bridge's jobs), reads of a
 * tube are held while its update runs, and a finished update refreshes the
 * tube in the device store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { flushPromises } from '@vue/test-utils';
import type { DeviceStore } from '../devices/device-store';
import type { FirmwareUpdateManager } from './firmware-update-manager';
import { installFirmwareRuntime, linkFirmwareToDevices } from './firmware-runtime';
import { FakeFirmwareBridge, HEX, NODE_ID, T1, T3, makeJob, port } from './testing/fixtures';

let bridge: FakeFirmwareBridge;
let manager: FirmwareUpdateManager | null;
/** Device store stub: records holds and refreshes. */
let store: { holdReads: ReturnType<typeof vi.fn>; describe: ReturnType<typeof vi.fn>; readInfo: ReturnType<typeof vi.fn>; released: string[] };

beforeEach(async () => {
  bridge = new FakeFirmwareBridge();
  manager = null;
  const released: string[] = [];
  store = {
    released,
    holdReads: vi.fn((uid: string) => () => { released.push(uid); }),
    describe: vi.fn(async () => null),
    readInfo: vi.fn(async () => null),
  };
  await flushPromises();
});

afterEach(() => {
  manager?.dispose();
  bridge.dispose();
});

/** The store stub as the runtime sees it. */
const asStore = () => store as unknown as DeviceStore;

describe('linkFirmwareToDevices', () => {
  it('holds a tube while its update runs and refreshes it once when done', async () => {
    manager = bridge.manager();
    await flushPromises();
    const stop = linkFirmwareToDevices(manager, asStore);
    manager.enqueue([{ nodeId: NODE_ID, port: port(1), uid: T1, allowDowngrade: false, image: null }], HEX);
    await flushPromises();
    expect(store.holdReads).toHaveBeenCalledTimes(1);
    expect(store.holdReads).toHaveBeenCalledWith(T1);

    const jobId = bridge.jobOf(T1)!.jobId;
    bridge.progress(jobId, { phase: 'writing', pagesDone: 10 });
    await flushPromises();
    expect(store.holdReads).toHaveBeenCalledTimes(1); // still the same hold

    bridge.progress(jobId, { phase: 'done', result: { softwareVersionId: 0x010200, softwareVersionLabel: '1.2.0' } });
    await flushPromises();
    expect(store.released).toEqual([T1]);
    expect(store.describe).toHaveBeenCalledWith(T1, true);
    expect(store.describe).toHaveBeenCalledTimes(1);

    // Another change of the items does not refresh again.
    manager.enqueue([{ nodeId: NODE_ID, port: port(2), uid: T3, allowDowngrade: false, image: null }], HEX);
    await flushPromises();
    expect(store.describe).toHaveBeenCalledTimes(1);

    // A failed update: the tube may wait in its bootloader — one DEVICE_INFO re-read.
    bridge.progress(bridge.jobOf(T3)!.jobId, { phase: 'failed', error: { code: 'timeout', message: 'no answer' } });
    await flushPromises();
    expect(store.released).toEqual([T1, T3]);
    expect(store.readInfo).toHaveBeenCalledWith(T3);
    stop();
  });

  it('does not refresh tubes whose update ended before this window saw it', async () => {
    bridge.jobs = [makeJob({ phase: 'done', result: { softwareVersionId: 0x010200, softwareVersionLabel: '1.2.0' } })];
    manager = bridge.manager();
    await flushPromises();
    expect(manager.items.value).toHaveLength(1);
    const stop = linkFirmwareToDevices(manager, asStore);
    await flushPromises();
    expect(store.holdReads).not.toHaveBeenCalled();
    expect(store.describe).not.toHaveBeenCalled();
    stop();
  });

  it('releases its holds when stopped', async () => {
    manager = bridge.manager();
    await flushPromises();
    const stop = linkFirmwareToDevices(manager, asStore);
    manager.enqueue([{ nodeId: NODE_ID, port: port(1), uid: T1, allowDowngrade: false, image: null }], HEX);
    await flushPromises();
    stop();
    expect(store.released).toEqual([T1]);
  });
});

describe('installFirmwareRuntime', () => {
  it('creates the manager (and asks for the bridge jobs) only once Art-Net is in use', async () => {
    const active = ref(false);
    const dispose = installFirmwareRuntime({ backend: () => bridge.backend, active: () => active.value, store: asStore });
    await flushPromises();
    expect(bridge.requestsOf('flashJobs')).toHaveLength(0);

    active.value = true;
    await flushPromises();
    expect(bridge.requestsOf('flashJobs')).toHaveLength(1); // re-attached to the bridge's jobs

    // Demand gone and back: the same manager stays.
    active.value = false;
    await flushPromises();
    active.value = true;
    await flushPromises();
    expect(bridge.requestsOf('flashJobs')).toHaveLength(1);
    dispose();
  });
});
