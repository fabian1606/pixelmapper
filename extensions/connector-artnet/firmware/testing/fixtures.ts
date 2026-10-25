/**
 * Test data of the firmware update tests: image trailers, jobs and a fake
 * bridge with a Pixelmapper Node, tubes on its ports and scripted
 * `imageInfo` / `flash` / `flashCancel` / `flashJobs`. Not used at runtime.
 */
import { BridgeCommandError } from '../../bridge/backend';
import { NodeDirectory } from '../../bridge/node-directory';
import type { FirmwareImageInfo, FlashJob, PortRef, RdmDeviceInfo } from '../../bridge/protocol-model';
import { RDM_PID } from '../../bridge/rdm-constants';
import { FakeArtNetBackend } from '../../bridge/testing/fake-backend';
import { makeNode, makeTod } from '../../bridge/testing/fixtures';
import { FirmwareUpdateManager } from '../firmware-update-manager';

/** Node id (= UID) of the default Pixelmapper Node. */
export const NODE_ID = '7FF0:8A1B2C3D';
/** Tubes: T1 + T2 on port 1, T3 on port 2. */
export const T1 = '7FF0:74B65101';
export const T2 = '7FF0:74B65102';
export const T3 = '7FF0:74B65103';
/** A device of another manufacturer on port 2. */
export const FOREIGN = '1234:00000001';

/** Port at BindIndex `bind`. */
export const port = (bind: number): PortRef => ({ bind, index: 0 });

/** Intel HEX text of the fake image (content does not matter to the fake bridge). */
export const HEX = ':020000040000FA\n:00000001FF\n';

/** Trailer of an XBAR500 image, version 1.2.0 by default. */
export function makeImage(overrides: Partial<FirmwareImageInfo> = {}): FirmwareImageInfo {
  return { format: 1, manufacturerId: 0x7ff0, modelId: 0x0001, versionId: 0x010200, version: '1.2.0', length: 6016, ...overrides };
}

/** A job of tube T1 on port 1 in phase `entering`. */
export function makeJob(overrides: Partial<FlashJob> = {}): FlashJob {
  return {
    jobId: 'f1', nodeId: NODE_ID, port: port(1), uid: T1, phase: 'entering', pagesDone: 0, pagesTotal: 94, rewrites: 0,
    inBootloader: false, image: makeImage(), error: null, result: null, ...overrides,
  };
}

/** What a fake tube answers. */
export interface FakeTube {
  model: number;
  version: number;
  label: string | null;
  /** DEVICE_INFO times out (offline or in the bootloader). */
  silent?: boolean;
}

/** DEVICE_INFO of a fake tube. */
function deviceInfo(t: FakeTube): RdmDeviceInfo {
  return {
    rdmProtocolVersion: 0x0100, deviceModelId: t.model, productCategory: 0x0101, softwareVersionId: t.version, dmxFootprint: 12,
    currentPersonality: 1, personalityCount: 4, dmxStartAddress: 1, subDeviceCount: 0, sensorCount: 0,
  };
}

/** A connected fake bridge with the node, its TODs, tubes and firmware commands. */
export class FakeFirmwareBridge {
  readonly backend = new FakeArtNetBackend();
  readonly directory: NodeDirectory;
  /** Tubes by UID: T1 0.5.0, T2 1.2.0, T3 0.5.0, FOREIGN another manufacturer. */
  readonly tubes = new Map<string, FakeTube>([
    [T1, { model: 1, version: 0x000500, label: '0.5.0' }],
    [T2, { model: 1, version: 0x010200, label: '1.2.0' }],
    [T3, { model: 1, version: 0x000500, label: '0.5.0' }],
    [FOREIGN, { model: 0x42, version: 0x01, label: null }],
  ]);
  /** Image answered by `imageInfo`. */
  image = makeImage();
  /** Jobs the bridge knows (`flashJobs`). */
  jobs: FlashJob[] = [];
  /** `flash` pre-check errors by UID. */
  readonly flashErrors = new Map<string, BridgeCommandError>();
  private nextJob = 1;

  constructor() {
    this.backend.start();
    // Known to the bridge before the directory reads its `nodes` snapshot.
    this.backend.emit(
      { type: 'node', node: makeNode() },
      { type: 'tod', ...makeTod(NODE_ID, 1, [T1, T2]) },
      { type: 'tod', ...makeTod(NODE_ID, 2, [T3, FOREIGN]) },
    );
    this.directory = new NodeDirectory(this.backend);
    this.backend.handle('rdmGet', ({ uid, pid }) => {
      const tube = this.tubes.get(uid);
      if (!tube || tube.silent) throw new BridgeCommandError('timeout', 'no answer');
      if (pid === RDM_PID.DEVICE_INFO) return { data: '', value: deviceInfo(tube) };
      if (pid === RDM_PID.SOFTWARE_VERSION_LABEL && tube.label !== null) return { data: '', value: tube.label };
      throw new BridgeCommandError('nack', 'NACK', { nackReason: 0, nackName: 'UNKNOWN_PID' });
    });
    this.backend.handle('imageInfo', ({ hex }) => {
      if (!hex.startsWith(':')) throw new BridgeCommandError('invalidImage', 'line 1: missing start code');
      return this.image;
    });
    this.backend.handle('flash', ({ nodeId, port: p, uid }) => {
      const error = this.flashErrors.get(uid);
      if (error) throw error;
      const job = makeJob({ jobId: `f${this.nextJob++}`, nodeId, port: { ...p }, uid, image: this.image });
      this.jobs.push(job);
      return { job };
    });
    this.backend.handle('flashCancel', ({ jobId }) => {
      if (!this.jobs.some(j => j.jobId === jobId)) throw new BridgeCommandError('unknownJob', 'unknown job');
      return {};
    });
    this.backend.handle('flashJobs', () => ({ jobs: this.jobs }));
  }

  /** Sends a progress event and remembers the job state for `flashJobs`. */
  progress(jobId: string, patch: Partial<FlashJob>): FlashJob {
    const i = this.jobs.findIndex(j => j.jobId === jobId);
    if (i < 0) throw new Error(`unknown job ${jobId}`);
    const job = { ...this.jobs[i]!, ...patch };
    this.jobs[i] = job;
    this.backend.emit({ type: 'flashProgress', job });
    return job;
  }

  /** The job of a tube (latest). */
  jobOf(uid: string): FlashJob | undefined {
    return [...this.jobs].reverse().find(j => j.uid === uid);
  }

  /** Arguments of the requests of one type. */
  requestsOf<T = Record<string, unknown>>(type: string): T[] {
    return this.backend.requests.filter(r => r.type === type).map(r => r.args as T);
  }

  /** A fresh manager on this bridge (dispose it after the test). */
  manager(): FirmwareUpdateManager {
    return new FirmwareUpdateManager(this.backend);
  }

  /** Stops listening. */
  dispose(): void {
    this.directory.dispose();
  }
}
