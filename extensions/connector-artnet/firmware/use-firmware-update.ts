/**
 * State of the firmware update dialog (plan M7.4): the chosen `.hex` file
 * (`useFirmwareImage`), the node's tubes with what they report
 * (`useTubeReadings`), their eligibility and selection, and their updates
 * in the app-wide `FirmwareUpdateManager`.
 *
 * Call inside a component's `setup` (or an effect scope).
 */
import { computed, shallowReactive, toValue, type MaybeRefOrGetter } from 'vue';
import type { ArtNetBackend } from '../bridge/backend';
import type { NodeId, PortRef, RdmUid } from '../bridge/protocol-model';
import { getArtNetBackend, getNodeDirectory } from '../bridge/shared';
import { checkFirmwareEligibility, type FirmwareEligibility, type TubeReading } from './firmware-eligibility';
import { getFirmwareUpdateManager, type FirmwareUpdateManager } from './firmware-update-manager';
import { formatFirmwareVersion } from './firmware-version';
import { isItemPending, latestItemOf, type FlashItem } from './flash-item';
import { listNodeTubes, readTubeFirmware, type NodeTube, type TubeDirectory, type TubeReader } from './tube-devices';
import { useFirmwareImage } from './use-firmware-image';
import { useTubeReadings } from './use-tube-readings';

/** One row of the dialog: a tube with its firmware state. */
export interface FirmwareCandidate {
  nodeId: NodeId;
  /** Null for a requested UID that is not in the node's TODs. */
  port: PortRef | null;
  portLabel: string | null;
  uid: RdmUid;
  /** False when the UID is not in any TOD of the node (offline). */
  present: boolean;
  reading: TubeReading;
  /** Installed version (`M.m.p`), null while unknown. */
  currentVersion: string | null;
  /** SOFTWARE_VERSION_LABEL, if the tube reports one. */
  currentLabel: string | null;
  /** Version of the chosen image. */
  targetVersion: string | null;
  /** Null until an image is chosen. */
  eligibility: FirmwareEligibility | null;
  /** The tube's pending or latest update. */
  item: FlashItem | null;
  /** An update is queued or running. */
  pending: boolean;
  /** The checkbox can be used. */
  selectable: boolean;
  selected: boolean;
}

/** Inputs of `useFirmwareUpdate`. */
export interface UseFirmwareUpdateOptions {
  nodeId: MaybeRefOrGetter<NodeId>;
  /** Only these tubes (inspector: one UID); default every tube of the node. */
  uids?: MaybeRefOrGetter<readonly RdmUid[] | undefined>;
  /** Default: the app-wide bridge connection. */
  backend?: ArtNetBackend;
  /** Default: the app-wide node directory. */
  directory?: TubeDirectory;
  /** Default: the manager of `backend`. */
  manager?: FirmwareUpdateManager;
  /** How a tube is read; default DEVICE_INFO + SOFTWARE_VERSION_LABEL via `rdmGet`. */
  readTube?: TubeReader;
  /** Tubes read at once (default 4). */
  concurrency?: number;
  /** Read tubes automatically (default true). */
  autoRead?: boolean;
}

/** Result of `start`. */
export interface FirmwareStartResult {
  /** Tubes queued. */
  started: number;
  /** Selected downgrades waiting for `start({ confirmDowngrade: true })`. */
  needsConfirmation: FirmwareCandidate[];
}

/** Dialog state (see file comment). */
export function useFirmwareUpdate(options: UseFirmwareUpdateOptions) {
  const backend = options.backend ?? getArtNetBackend();
  const directory = options.directory ?? getNodeDirectory();
  const manager = options.manager ?? getFirmwareUpdateManager(backend);

  const connected = computed(() => backend.state.value.kind === 'connected');
  const nodeId = computed(() => toValue(options.nodeId));
  const onlyUids = computed(() => toValue(options.uids));
  /** True when an item belongs to this dialog (node and, if given, UIDs). */
  const inScope = (item: FlashItem) => item.nodeId === nodeId.value && (!onlyUids.value || onlyUids.value.includes(item.uid));

  /** Explicit checkbox choices; unset = the eligibility's default (cleared with every new file). */
  const choices = shallowReactive(new Map<RdmUid, boolean>());
  const { fileName, hex, image, imageError, loadingImage, chooseFile, clearFile } = useFirmwareImage(backend, () => choices.clear());

  const tubes = computed(() => listNodeTubes(directory, nodeId.value, onlyUids.value));
  const items = computed(() => manager.items.value.filter(inScope));
  const { readingOf, readingTubes, readTubes } = useTubeReadings({
    tubes,
    items,
    connected,
    // Reading waits for the bridge's job list, so tubes that are being updated are known first.
    ready: computed(() => connected.value && manager.synced.value),
    readTube: options.readTube ?? (tube => readTubeFirmware(backend, tube)),
    concurrency: options.concurrency ?? 4,
    autoRead: options.autoRead !== false,
  });

  // ── Rows and selection ───────────────────────

  /** Builds the row of a tube (`present` = in a TOD of the node). */
  function candidateOf(tube: Pick<NodeTube, 'uid'> & Partial<NodeTube>, present: boolean): FirmwareCandidate {
    const reading = readingOf(tube.uid);
    const item = latestItemOf(items.value, tube.uid) ?? null;
    const pending = !!item && isItemPending(item);
    const inBootloader = !pending && !!item?.job?.inBootloader;
    const eligibility = image.value && present ? checkFirmwareEligibility(image.value, tube.uid, reading, { inBootloader }) : null;
    const selectable = !!eligibility?.selectable && !pending && connected.value && !!hex.value;
    return {
      nodeId: nodeId.value,
      port: tube.port ?? item?.port ?? null,
      portLabel: tube.portLabel ?? null,
      uid: tube.uid,
      present,
      reading,
      currentVersion: reading.state === 'ok' ? formatFirmwareVersion(reading.softwareVersionId) : null,
      currentLabel: reading.state === 'ok' ? reading.softwareVersionLabel : null,
      targetVersion: image.value?.version ?? null,
      eligibility,
      item,
      pending,
      selectable,
      selected: selectable && (choices.get(tube.uid) ?? eligibility!.preselect),
    };
  }

  /** Every tube of the node (or the requested UIDs), plus tubes with updates that left the TOD. */
  const candidates = computed<FirmwareCandidate[]>(() => {
    const rows = tubes.value.map(t => candidateOf(t, true));
    const shown = new Set(rows.map(r => r.uid));
    for (const uid of [...(onlyUids.value ?? []), ...items.value.map(i => i.uid)]) {
      if (shown.has(uid)) continue;
      shown.add(uid);
      rows.push(candidateOf({ uid }, false));
    }
    return rows;
  });

  const selected = computed(() => candidates.value.filter(c => c.selected));
  const selectedDowngrades = computed(() => selected.value.filter(c => c.eligibility?.downgrade));

  /** Ticks or unticks a tube. */
  function setSelected(uid: RdmUid, on: boolean): void {
    choices.set(uid, on);
  }

  /** Ticks or unticks every selectable tube. */
  function selectAll(on: boolean): void {
    for (const c of candidates.value) if (c.selectable) choices.set(c.uid, on);
  }

  // ── Running ──────────────────────────────────

  const running = computed(() => items.value.some(isItemPending));
  const summary = computed(() => {
    const count = (status: FlashItem['status']) => items.value.filter(i => i.status === status).length;
    return { total: items.value.length, pending: items.value.filter(isItemPending).length, done: count('done'), failed: count('failed'), cancelled: count('cancelled') };
  });

  /**
   * Queues the selected tubes. Selected downgrades are only queued with
   * `confirmDowngrade` (they are passed with `allowDowngrade`).
   */
  function start(opts: { confirmDowngrade?: boolean } = {}): FirmwareStartResult {
    const chosen = selected.value.filter(c => c.port);
    if (!hex.value || !image.value || !chosen.length) return { started: 0, needsConfirmation: [] };
    const downgrades = chosen.filter(c => c.eligibility?.downgrade);
    if (downgrades.length && !opts.confirmDowngrade) return { started: 0, needsConfirmation: downgrades };
    const created = manager.enqueue(chosen.map(c => ({
      nodeId: c.nodeId,
      port: c.port!,
      uid: c.uid,
      allowDowngrade: !!c.eligibility?.downgrade,
      image: image.value,
    })), hex.value);
    for (const c of chosen) choices.delete(c.uid);
    return { started: created.length, needsConfirmation: [] };
  }

  /** Cancels the pending updates of this dialog (or of one tube). */
  function cancel(uid?: RdmUid): Promise<void> {
    return manager.cancel(i => inScope(i) && (!uid || i.uid === uid));
  }

  return {
    connected,
    // image
    fileName, image, imageError, loadingImage, chooseFile, clearFile,
    // tubes
    candidates, readingTubes, readTubes,
    // selection
    selected, selectedDowngrades, setSelected, selectAll,
    // running
    items, running, summary, start, cancel,
  };
}

/** What `useFirmwareUpdate` returns. */
export type FirmwareUpdateState = ReturnType<typeof useFirmwareUpdate>;
