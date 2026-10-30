/**
 * `useFirmwareUpdate` + `FirmwareUpdateManager` against `FakeArtNetBackend`
 * (plan M7.4): tubes from the node's TODs with their versions, image
 * preview, per-port runs driven by `flashProgress`, failures, downgrade
 * confirmation, cancel, re-attach to running jobs after a reload, and the
 * bridge going away.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectScope, type EffectScope } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { BridgeCommandError } from '../bridge/backend';
import { RDM_PID } from '../bridge/rdm-constants';
import type { FirmwareUpdateManager } from './firmware-update-manager';
import { FOREIGN, FakeFirmwareBridge, HEX, NODE_ID, T1, T2, T3, makeJob, port } from './testing/fixtures';
import type { FirmwareFile } from './use-firmware-image';
import { useFirmwareUpdate, type UseFirmwareUpdateOptions } from './use-firmware-update';

let bridge: FakeFirmwareBridge;
let manager: FirmwareUpdateManager;
let scope: EffectScope;

beforeEach(async () => {
  bridge = new FakeFirmwareBridge();
  await flushPromises();
});

afterEach(() => {
  scope?.stop();
  manager?.dispose();
  bridge.dispose();
});

/** Runs the composable for the node (the manager is created first, like after a reload). */
async function use(options: Partial<UseFirmwareUpdateOptions> = {}) {
  manager = bridge.manager();
  scope = effectScope();
  const fw = scope.run(() => useFirmwareUpdate({ nodeId: NODE_ID, backend: bridge.backend, directory: bridge.directory, manager, ...options }))!;
  await flushPromises();
  return fw;
}

/** A `.hex` file. */
const file = (text = HEX, name = 'tube_fw-1.2.0.hex'): FirmwareFile => ({ name, size: text.length, text: async () => text });

/** The row of a tube. */
const row = (fw: Awaited<ReturnType<typeof use>>, uid: string) => fw.candidates.value.find(c => c.uid === uid)!;

describe('useFirmwareUpdate', () => {
  it('lists the tubes of every port with their installed version', async () => {
    const fw = await use();
    expect(fw.candidates.value.map(c => [c.uid, c.portLabel, c.currentVersion])).toEqual([
      [T1, 'Port 1', '0.5.0'],
      [T2, 'Port 1', '1.2.0'],
      [FOREIGN, 'Port 2', '0.0.1'],
      [T3, 'Port 2', '0.5.0'],
    ]);
    expect(row(fw, T1).currentLabel).toBe('0.5.0');
    expect(row(fw, T1).eligibility).toBeNull(); // no image yet
    const gets = bridge.requestsOf<{ uid: string; pid: number }>('rdmGet');
    expect(gets.filter(g => g.pid === RDM_PID.DEVICE_INFO).map(g => g.uid).sort()).toEqual([FOREIGN, T1, T2, T3].sort());
    expect(gets[0]).toMatchObject({ nodeId: NODE_ID, port: port(1), uid: T1 });
  });

  it('previews the image and offers matching tubes', async () => {
    const fw = await use();
    await fw.chooseFile(file());
    expect(bridge.requestsOf('imageInfo')).toEqual([{ hex: HEX }]);
    expect(fw.fileName.value).toBe('tube_fw-1.2.0.hex');
    expect(fw.image.value?.version).toBe('1.2.0');
    expect(fw.candidates.value.map(c => [c.uid, c.eligibility?.kind, c.selectable, c.selected])).toEqual([
      [T1, 'update', true, true],
      [T2, 'upToDate', true, false],
      [FOREIGN, 'mismatch', false, false],
      [T3, 'update', true, true],
    ]);
    expect(row(fw, T1).targetVersion).toBe('1.2.0');
  });

  it('reports invalid and oversized files', async () => {
    const fw = await use();
    await fw.chooseFile(file('garbage'));
    expect(fw.imageError.value).toBe('The file is not a valid tube firmware image: line 1: missing start code');
    expect(fw.image.value).toBeNull();
    await fw.chooseFile({ name: 'big.hex', size: 5 * 1024 * 1024, text: async () => HEX });
    expect(fw.imageError.value).toBe('The file is too large for a tube firmware image');
  });

  it('updates one tube per port, ports in parallel, and takes the new version from the job', async () => {
    const fw = await use();
    await fw.chooseFile(file());
    fw.setSelected(T2, true); // reinstall the same version too
    expect(fw.start()).toEqual({ started: 3, needsConfirmation: [] });
    await flushPromises();
    expect(bridge.requestsOf('flash')).toEqual([
      { nodeId: NODE_ID, port: port(1), uid: T1, hex: HEX, allowDowngrade: false },
      { nodeId: NODE_ID, port: port(2), uid: T3, hex: HEX, allowDowngrade: false },
    ]);
    expect(row(fw, T2).item?.status).toBe('queued');
    expect(row(fw, T1).selectable).toBe(false); // pending

    bridge.progress(bridge.jobOf(T1)!.jobId, { phase: 'writing', pagesDone: 47 });
    expect(row(fw, T1).item?.job?.pagesDone).toBe(47);
    bridge.progress(bridge.jobOf(T1)!.jobId, { phase: 'done', result: { softwareVersionId: 0x010200, softwareVersionLabel: '1.2.0' } });
    await flushPromises();
    expect(bridge.requestsOf<{ uid: string }>('flash').map(f => f.uid)).toEqual([T1, T3, T2]);
    expect(row(fw, T1).item?.status).toBe('done');
    expect(row(fw, T1).currentVersion).toBe('1.2.0');
    expect(row(fw, T1).eligibility?.kind).toBe('upToDate');
    expect(fw.summary.value).toMatchObject({ done: 1, pending: 2 });
  });

  it('continues with the next tube when one fails', async () => {
    const fw = await use();
    await fw.chooseFile(file());
    fw.setSelected(T2, true);
    fw.start();
    await flushPromises();
    bridge.progress(bridge.jobOf(T1)!.jobId, { phase: 'failed', inBootloader: true, error: { code: 'nack', message: 'BOOT_WRITE_PAGE NACK HARDWARE_FAULT' } });
    await flushPromises();
    expect(row(fw, T1).item).toMatchObject({ status: 'failed', errorDetail: 'BOOT_WRITE_PAGE NACK HARDWARE_FAULT' });
    expect(row(fw, T1).selectable).toBe(true); // can be tried again
    expect(bridge.requestsOf<{ uid: string }>('flash').map(f => f.uid)).toEqual([T1, T3, T2]);
    expect(fw.summary.value).toMatchObject({ failed: 1, pending: 2 });
  });

  it('asks before a downgrade and then passes allowDowngrade', async () => {
    bridge.tubes.get(T1)!.version = 0x010300;
    const fw = await use();
    await fw.chooseFile(file());
    expect(row(fw, T1).eligibility?.kind).toBe('downgrade');
    expect(row(fw, T1).selected).toBe(false);
    fw.setSelected(T1, true);
    const asked = fw.start();
    expect(asked.started).toBe(0);
    expect(asked.needsConfirmation.map(c => c.uid)).toEqual([T1]);
    expect(bridge.requestsOf('flash')).toEqual([]);
    expect(fw.start({ confirmDowngrade: true }).started).toBe(2);
    await flushPromises();
    expect(bridge.requestsOf<{ uid: string; allowDowngrade: boolean }>('flash').map(f => [f.uid, f.allowDowngrade])).toEqual([[T1, true], [T3, false]]);
  });

  it('cancels running and queued updates of the node', async () => {
    const fw = await use();
    await fw.chooseFile(file());
    fw.setSelected(T2, true);
    fw.start();
    await flushPromises();
    await fw.cancel();
    expect(bridge.requestsOf<{ jobId: string }>('flashCancel').map(c => c.jobId).sort()).toEqual([bridge.jobOf(T1)!.jobId, bridge.jobOf(T3)!.jobId].sort());
    expect(row(fw, T2).item?.status).toBe('cancelled');
    expect(row(fw, T1).item?.status).toBe('cancelling');
    bridge.progress(bridge.jobOf(T1)!.jobId, { phase: 'cancelled', inBootloader: true });
    bridge.progress(bridge.jobOf(T3)!.jobId, { phase: 'cancelled', inBootloader: false });
    expect(fw.running.value).toBe(false);
    expect(bridge.requestsOf('flash')).toHaveLength(2); // T2 never started
  });

  it('re-attaches to jobs that run in the bridge (after a reload)', async () => {
    bridge.jobs.push(makeJob({ jobId: 'old', uid: T3, port: port(2), phase: 'done', result: { softwareVersionId: 0x010200, softwareVersionLabel: '1.2.0' } }));
    bridge.jobs.push(makeJob({ jobId: 'r1', uid: T1, phase: 'writing', pagesDone: 30 }));
    const fw = await use();
    expect(row(fw, T1)).toMatchObject({ pending: true, item: { ours: false, status: 'running' } });
    expect(row(fw, T3).item).toMatchObject({ status: 'done', ours: false });
    expect(row(fw, T3).currentVersion).toBe('1.2.0'); // from the finished job
    expect(fw.running.value).toBe(true);
    // A tube in its bootloader is not read.
    expect(bridge.requestsOf<{ uid: string }>('rdmGet').some(g => g.uid === T1)).toBe(false);
    bridge.progress('r1', { phase: 'verifying', pagesDone: 94 });
    expect(row(fw, T1).item?.job?.phase).toBe('verifying');
    // A new run waits for the attached job's port.
    await fw.chooseFile(file());
    fw.start();
    await flushPromises();
    expect(bridge.requestsOf<{ uid: string }>('flash').map(f => f.uid)).toEqual([]); // T3 is up to date, T1 pending
    fw.setSelected(T2, true);
    fw.start();
    await flushPromises();
    expect(bridge.requestsOf('flash')).toEqual([]);
    bridge.progress('r1', { phase: 'done', result: { softwareVersionId: 0x010200, softwareVersionLabel: null } });
    await flushPromises();
    expect(bridge.requestsOf<{ uid: string }>('flash').map(f => f.uid)).toEqual([T2]);
  });

  it('limits the rows to the requested UIDs', async () => {
    const fw = await use({ uids: [T3, '7FF0:DEADBEEF'] });
    expect(fw.candidates.value.map(c => [c.uid, c.present])).toEqual([[T3, true], ['7FF0:DEADBEEF', false]]);
    await fw.chooseFile(file());
    expect(row(fw, '7FF0:DEADBEEF')).toMatchObject({ selectable: false, eligibility: null });
    fw.start();
    await flushPromises();
    expect(bridge.requestsOf<{ uid: string }>('flash').map(f => f.uid)).toEqual([T3]);
  });

  it('waits for the bridge: nothing is read or started while it is away', async () => {
    bridge.backend.disconnect();
    const fw = await use();
    expect(bridge.requestsOf('rdmGet')).toEqual([]);
    expect(fw.connected.value).toBe(false);
    manager.enqueue([{ nodeId: NODE_ID, port: port(1), uid: T1, allowDowngrade: false, image: bridge.image }], HEX);
    expect(bridge.requestsOf('flash')).toEqual([]);
    bridge.backend.connect();
    await flushPromises();
    // The job list is read first, then the queue continues.
    expect(bridge.backend.requests.map(r => r.type).filter(t => t === 'flashJobs' || t === 'flash')).toEqual(['flashJobs', 'flash']);
    expect(row(fw, T1).pending).toBe(true);
    expect(row(fw, T2).currentVersion).toBe('1.2.0');
  });

  it('offers a tube without DEVICE_INFO unticked; the bridge pre-check still guards it', async () => {
    bridge.tubes.get(T3)!.silent = true;
    const fw = await use();
    await fw.chooseFile(file());
    expect(row(fw, T3).eligibility).toMatchObject({ kind: 'unknown', selectable: true });
    expect(row(fw, T3).selected).toBe(false);
    bridge.flashErrors.set(T3, new BridgeCommandError('deviceMismatch', 'BOOT_INFO model 0x0002'));
    fw.setSelected(T3, true);
    fw.start();
    await flushPromises();
    expect(row(fw, T3).item).toMatchObject({ status: 'failed', error: 'The device\'s manufacturer or model does not match the image' });
  });
});
