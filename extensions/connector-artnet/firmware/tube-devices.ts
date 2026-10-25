/**
 * The tubes a firmware update can reach: every UID in the TODs of a node's
 * ports (node directory), and what they report about their firmware
 * (DEVICE_INFO model + software version id, SOFTWARE_VERSION_LABEL).
 */
import type { ArtNetBackend } from '../bridge/backend';
import type { NodeDirectory } from '../bridge/node-directory';
import type { NodeId, PortRef, RdmDeviceInfo, RdmUid } from '../bridge/protocol-model';
import { portLabel } from '../bridge/protocol-model';
import { RDM_PID } from '../bridge/rdm-constants';
import { describeRdmError } from '../rdm/parameter-form/rdm-errors';
import type { TubeReading } from './firmware-eligibility';

/** One RDM device on a port of a node. */
export interface NodeTube {
  nodeId: NodeId;
  port: PortRef;
  /** `Port 3` / `Port 1.2`. */
  portLabel: string;
  uid: RdmUid;
}

/** What `listNodeTubes` needs of the node directory. */
export type TubeDirectory = Pick<NodeDirectory, 'getNode' | 'todOf'>;

/**
 * Devices in the TODs of the node's ports, by port then UID; only `uids`
 * when given. Ports without a TOD (or TodNak) contribute nothing.
 */
export function listNodeTubes(directory: TubeDirectory, nodeId: NodeId, uids?: readonly RdmUid[]): NodeTube[] {
  const node = directory.getNode(nodeId);
  if (!node) return [];
  const only = uids ? new Set(uids) : null;
  const ports = node.ports.map(p => p.port);
  const tubes: NodeTube[] = [];
  for (const port of ports) {
    const tod = directory.todOf(nodeId, port);
    if (!tod?.available) continue;
    const label = portLabel(port, ports);
    for (const uid of tod.uids) {
      if (!only || only.has(uid)) tubes.push({ nodeId, port: { bind: port.bind, index: port.index }, portLabel: label, uid });
    }
  }
  return tubes;
}

/**
 * Reads DEVICE_INFO and SOFTWARE_VERSION_LABEL of a tube. A failed
 * DEVICE_INFO gives an `error` reading (the tube may wait in its
 * bootloader); a missing label is not an error.
 */
export async function readTubeFirmware(backend: ArtNetBackend, tube: Pick<NodeTube, 'nodeId' | 'port' | 'uid'>): Promise<TubeReading> {
  const address = { nodeId: tube.nodeId, port: { bind: tube.port.bind, index: tube.port.index }, uid: tube.uid };
  let info: RdmDeviceInfo;
  try {
    const answer = await backend.request('rdmGet', { ...address, pid: RDM_PID.DEVICE_INFO });
    if (!answer.value || typeof answer.value !== 'object' || !('softwareVersionId' in answer.value)) {
      return { state: 'error', message: 'The device sent no DEVICE_INFO' };
    }
    info = answer.value as RdmDeviceInfo;
  }
  catch (err) {
    return { state: 'error', message: describeRdmError(err) };
  }
  let label: string | null = null;
  try {
    const answer = await backend.request('rdmGet', { ...address, pid: RDM_PID.SOFTWARE_VERSION_LABEL });
    label = typeof answer.value === 'string' ? answer.value : null;
  }
  catch { /* optional PID */ }
  return { state: 'ok', deviceModelId: info.deviceModelId, softwareVersionId: info.softwareVersionId, softwareVersionLabel: label };
}
