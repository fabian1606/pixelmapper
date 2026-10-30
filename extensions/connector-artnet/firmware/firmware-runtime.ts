/**
 * Tube firmware updates as part of the extension's runtime (plan M7.4).
 *
 * Installed by the manifest's `activate`, but the app-wide
 * `FirmwareUpdateManager` is only created once something needs Art-Net
 * (`retainArtNetDiscovery` — the Connectors page, a node connector, the
 * inspector's RDM section). From then on it re-attaches to the bridge's
 * running jobs after every (re)connect (`flashJobs`), also after a reload,
 * while users who never use Art-Net cause no bridge traffic at all.
 *
 * It also ties the updates to the device store (M6): reads of a tube are
 * held while its port is busy with the update, and a finished update
 * refreshes the tube's description (`describe(uid, true)`: new firmware
 * version, labels, parameters), so badges, the device list and the
 * inspector show the new state without waiting for the periodic re-read.
 */
import { effectScope, watch } from 'vue';
import type { ArtNetBackend } from '../bridge/backend';
import type { RdmUid } from '../bridge/protocol-model';
import { artNetDiscoveryDemand, getArtNetBackend } from '../bridge/shared';
import { getDeviceRuntime } from '../devices/device-runtime';
import type { DeviceStore } from '../devices/device-store';
import { getFirmwareUpdateManager, type FirmwareUpdateManager } from './firmware-update-manager';
import { holdsPort, type FlashItem } from './flash-item';

/** Injectable dependencies (tests). */
export interface FirmwareRuntimeDeps {
  /** Default: the app-wide backend (looked up when first needed). */
  backend?: () => ArtNetBackend;
  /** Default: the store of the app's device runtime, when there is one. */
  store?: () => DeviceStore | null;
  /** Default: `artNetDiscoveryDemand() > 0` (reactive). */
  active?: () => boolean;
}

/**
 * Follows the manager's items: holds reads of tubes whose update holds the
 * port, releases them when the update ends and refreshes each tube once
 * whose update this window saw running. Returns the stop function.
 */
export function linkFirmwareToDevices(manager: FirmwareUpdateManager, store: () => DeviceStore | null): () => void {
  /** Release functions of the held tubes, by UID. */
  const held = new Map<RdmUid, () => void>();
  /** Items seen holding their port (only their end triggers a refresh). */
  const running = new Set<number>();

  /** Applies one snapshot of the items. */
  function apply(items: readonly FlashItem[]) {
    const s = store();
    const busy = new Set<RdmUid>();
    for (const item of items) {
      if (!holdsPort(item)) continue;
      busy.add(item.uid);
      running.add(item.key);
      if (s && !held.has(item.uid)) held.set(item.uid, s.holdReads(item.uid));
    }
    // Holds of tubes whose update ended (or that left the list).
    for (const [uid, release] of held) {
      if (busy.has(uid)) continue;
      release();
      held.delete(uid);
    }
    for (const item of items) {
      if (!running.has(item.key) || holdsPort(item) || item.status === 'queued') continue;
      running.delete(item.key);
      if (!s || busy.has(item.uid)) continue;
      // New firmware: everything may have changed (version, labels, parameters).
      if (item.status === 'done') void s.describe(item.uid, true);
      // Failed/cancelled: the tube may wait in its bootloader — one DEVICE_INFO shows it.
      else void s.readInfo(item.uid);
    }
  }

  const stop = watch(() => manager.items.value, apply, { immediate: true });
  return () => {
    stop();
    for (const release of held.values()) release();
    held.clear();
  };
}

/** Starts the firmware runtime (see file comment); returns the disposer. */
export function installFirmwareRuntime(deps: FirmwareRuntimeDeps = {}): () => void {
  const scope = effectScope(true);
  const active = deps.active ?? (() => artNetDiscoveryDemand() > 0);
  const store = deps.store ?? (() => getDeviceRuntime()?.store ?? null);
  let manager: FirmwareUpdateManager | null = null;
  let unlink: (() => void) | null = null;
  scope.run(() => {
    watch(active, (now) => {
      // Created once, on the first demand; it pauses itself while the bridge is down.
      if (!now || manager) return;
      manager = getFirmwareUpdateManager((deps.backend ?? getArtNetBackend)());
      unlink = linkFirmwareToDevices(manager, store);
    }, { immediate: true });
  });
  return () => {
    scope.stop();
    unlink?.();
    unlink = null;
  };
}
