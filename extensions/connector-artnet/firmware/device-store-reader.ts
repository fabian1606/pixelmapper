/**
 * Tube readings for the firmware dialog from the RDM device store (plan
 * M7.4 on top of M6): the store already knows every tube's DEVICE_INFO and
 * SOFTWARE_VERSION_LABEL and keeps them fresh (re-read every 45 s, on TOD
 * changes, after SETs and after an update), so opening the dialog sends no
 * extra `rdmGet`s. A forced re-read (`fresh`) or a tube the store has no
 * answer for costs one DEVICE_INFO through the store, which updates the
 * badges and the device list as well. Tubes the store does not track (no
 * device runtime, another node) are read directly.
 */
import type { ArtNetBackend } from '../bridge/backend';
import type { RdmDeviceDescription, RdmDeviceInfo } from '../bridge/protocol-model';
import type { DeviceStore } from '../devices/device-store';
import type { TubeReading } from './firmware-eligibility';
import { readTubeFirmware, type TubeReader } from './tube-devices';

/**
 * The reading of a DEVICE_INFO answer; the label comes from the
 * description only while it describes the same software version.
 */
export function readingFromDevice(info: RdmDeviceInfo, description: RdmDeviceDescription | null): TubeReading {
  const label = description && description.deviceInfo.softwareVersionId === info.softwareVersionId ? description.softwareVersionLabel : null;
  return { state: 'ok', deviceModelId: info.deviceModelId, softwareVersionId: info.softwareVersionId, softwareVersionLabel: label };
}

/** A `TubeReader` backed by `store` (see file comment); null store = always read directly. */
export function deviceStoreTubeReader(store: DeviceStore | null, backend: ArtNetBackend): TubeReader {
  return async (tube, options = {}) => {
    const entry = store?.get(tube.uid);
    if (!store || !entry || entry.nodeId !== tube.nodeId) return readTubeFirmware(backend, tube);
    let info = entry.info;
    if (options.fresh || !info || entry.noAnswer) {
      info = await store.readInfo(tube.uid);
      if (!info) return { state: 'error', message: store.get(tube.uid)?.error ?? 'The device does not answer' };
    }
    return readingFromDevice(info, store.get(tube.uid)?.description ?? null);
  };
}
