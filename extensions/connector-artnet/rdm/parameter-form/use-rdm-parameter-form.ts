/**
 * State of the generic RDM parameter form: builds the fields of a device,
 * reads their values through the bridge (a few GETs in flight at a time,
 * per-field loading/error state), writes on commit and re-reads afterwards.
 *
 * Last-writer-wins (plan D5): a field always shows what the device answered
 * — after a write the device is read again, and queued messages
 * (`rdmQueued`, e.g. a change at the node's display) replace the value.
 * Values are also re-read periodically (`rereadMs`): the node keeps one
 * queue of queued messages for all controllers, so with a second
 * Pixelmapper (or another RDM controller) fetching it this form can miss a
 * change.
 */
import { computed, onScopeDispose, reactive, toValue, watch, type MaybeRefOrGetter } from 'vue';
import type { ArtNetBackend } from '../../bridge/backend';
import type { RdmAddress } from '../../bridge/protocol-messages';
import type { RdmDeviceDescription } from '../../bridge/protocol-model';
import { buildParameterFields } from './parameter-fields';
import type { BuildFieldsOptions, RdmFieldValue, RdmParameterField } from './field-types';
import { decodeFieldValue, encodeFieldData, validateFieldValue } from './parameter-codec';
import { describeRdmError } from './rdm-errors';

/** Default interval of the periodic re-read of RDM-only settings (like the device store's 45 s). */
export const RDM_SETTINGS_REREAD_MS = 45_000;

/** Live state of one field. */
export interface RdmFieldState {
  /** Last value the device reported (for write-only fields: the last value sent); null = unknown. */
  value: RdmFieldValue | null;
  /** Value being written (shown until the device answers). */
  pending: RdmFieldValue | null;
  /** A GET is running. */
  loading: boolean;
  /** A SET (and its re-read) is running. */
  writing: boolean;
  /** Last error (English), or null. */
  error: string | null;
}

/** Inputs of `useRdmParameterForm`. */
export interface RdmParameterFormOptions {
  backend: ArtNetBackend;
  address: MaybeRefOrGetter<RdmAddress>;
  description: MaybeRefOrGetter<RdmDeviceDescription>;
  /** Field selection (`exclude` / `only`). */
  build?: MaybeRefOrGetter<BuildFieldsOptions | undefined>;
  /** GETs in flight at once (default 2; the bridge allows ≤ 4 per port). */
  concurrency?: number;
  /** Called after a successful write with the value the device reports afterwards. */
  onWritten?: (field: RdmParameterField, value: RdmFieldValue | null) => void;
  /** Re-read every value this often while connected (ms; 0 / unset = never). */
  rereadMs?: number;
}

/** Runs `worker` over `items` with at most `limit` running at once. */
export async function runLimited<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) await worker(items[next++]!);
  });
  await Promise.all(lanes);
}

/** Identity of an address (re-read only when it really changes). */
function addressKey(a: RdmAddress): string {
  return `${a.nodeId}|${a.port.bind}.${a.port.index}|${a.uid}|${a.subDevice ?? 0}`;
}

/** Form state (see file comment). Call inside a component's `setup`. */
export function useRdmParameterForm(options: RdmParameterFormOptions) {
  const { backend } = options;
  const fields = computed(() => buildParameterFields(toValue(options.description), toValue(options.build)));
  const states = reactive<Record<string, RdmFieldState>>({});
  const connected = computed(() => backend.state.value.kind === 'connected');
  const loading = computed(() => fields.value.some(f => states[f.key]?.loading));

  // Latest request per field: answers of superseded requests are dropped.
  let counter = 0;
  const latest = new Map<string, number>();
  const begin = (f: RdmParameterField) => { latest.set(f.key, ++counter); return counter; };
  const isLatest = (f: RdmParameterField, seq: number) => latest.get(f.key) === seq;

  /** Addressing arguments of a request (only the contract's keys). */
  function target(): RdmAddress {
    const a = toValue(options.address);
    return { nodeId: a.nodeId, port: { bind: a.port.bind, index: a.port.index }, uid: a.uid, ...(a.subDevice !== undefined ? { subDevice: a.subDevice } : {}) };
  }

  /** Reads one field from the device (skipped while it is being written: the write reads it back). */
  async function read(field: RdmParameterField): Promise<void> {
    const st = states[field.key];
    if (!st || !field.readable || st.writing) return;
    const seq = begin(field);
    st.loading = true;
    try {
      const reading = await backend.request('rdmGet', { ...target(), pid: field.pid });
      if (!isLatest(field, seq)) return;
      st.value = decodeFieldValue(field, reading);
      st.error = null;
    }
    catch (err) {
      if (isLatest(field, seq)) st.error = describeRdmError(err);
    }
    finally {
      if (isLatest(field, seq)) st.loading = false;
    }
  }

  /** Reads every readable field again. */
  async function refresh(): Promise<void> {
    await runLimited(fields.value.filter(f => f.readable), options.concurrency ?? 2, read);
  }

  /**
   * Writes a value (rdmSet with hex data), then shows the device's answer:
   * readable fields are read again, also after a refused write.
   * Resolves true when the device accepted the write.
   */
  async function write(field: RdmParameterField, value: RdmFieldValue): Promise<boolean> {
    const st = states[field.key];
    if (!st || !field.writable) return false;
    const problem = validateFieldValue(field, value);
    if (problem) {
      st.error = problem;
      return false;
    }
    const seq = begin(field);
    Object.assign(st, { loading: false, writing: true, pending: value, error: null });
    let accepted = true;
    let error: string | null = null;
    try {
      await backend.request('rdmSet', { ...target(), pid: field.pid, data: encodeFieldData(field, value) });
    }
    catch (err) {
      accepted = false;
      error = describeRdmError(err);
    }
    if (field.readable && isLatest(field, seq)) {
      try {
        const reading = await backend.request('rdmGet', { ...target(), pid: field.pid });
        if (isLatest(field, seq)) st.value = decodeFieldValue(field, reading);
      }
      catch (err) {
        error ??= `Written, but reading it back failed: ${describeRdmError(err)}`;
      }
    }
    if (!isLatest(field, seq)) return accepted;
    // Write-only fields cannot be read back: show what was sent.
    if (!field.readable && accepted && field.kind !== 'action') st.value = value;
    Object.assign(st, { writing: false, pending: null, error });
    if (accepted) options.onWritten?.(field, st.value);
    return accepted;
  }

  /** Sends an action (SET without data). */
  function run(field: RdmParameterField): Promise<boolean> {
    return write(field, '');
  }

  // A new device, a new description or another set of PIDs: fresh state,
  // read everything. Keyed by identity/strings, so re-created option arrays
  // (e.g. an inline `exclude` list) do not trigger a re-read.
  watch([
    () => toValue(options.description),
    () => addressKey(toValue(options.address)),
    () => fields.value.map(f => f.key).join(','),
  ], () => {
    latest.clear();
    for (const key of Object.keys(states)) delete states[key];
    for (const f of fields.value) states[f.key] = { value: null, pending: null, loading: false, writing: false, error: null };
    if (connected.value) void refresh();
  }, { immediate: true });

  // The bridge (re)connected: values may be stale.
  watch(connected, (now, before) => {
    if (now && !before) void refresh();
  });

  // Periodic re-read (see file comment); skipped while a load is still running.
  if (options.rereadMs && options.rereadMs > 0) {
    const timer = setInterval(() => {
      if (connected.value && !loading.value) void refresh();
    }, options.rereadMs);
    onScopeDispose(() => clearInterval(timer));
  }

  // Queued messages carry the GET response of a changed PID (node contract §6.3, §7).
  const off = backend.on('rdmQueued', (event) => {
    const a = target();
    if (event.nodeId !== a.nodeId || event.uid !== a.uid || (event.subDevice ?? 0) !== (a.subDevice ?? 0)) return;
    const field = fields.value.find(f => f.pid === event.pid && f.readable);
    const st = field && states[field.key];
    if (!field || !st || st.writing) return;
    try {
      const value = decodeFieldValue(field, event);
      begin(field);
      Object.assign(st, { value, loading: false, error: null });
    }
    catch (err) {
      console.warn('[artnet] queued RDM message does not match the parameter description:', err);
    }
  });
  onScopeDispose(off);

  return { fields, states, connected, loading, refresh, read, write, run };
}
