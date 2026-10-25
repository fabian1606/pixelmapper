/**
 * The Pixelmapper Node's RDM `PORTn_ENABLED` (pids.toml 0x8101–0x8104) for
 * the port mode “off” (plan M7.3): Art-Net cannot switch output ports off
 * (ArtInput only affects inputs, contract §5), so the Ports section reads
 * these PIDs, writes them, and follows queued messages. The value shown is
 * always the node's answer (D5): a write is followed by a GET. They are also
 * re-read every 45 s while shown: the node has one queue of queued messages
 * for all controllers, so another Pixelmapper may consume the message of a
 * change at the node's display.
 */
import { computed, onScopeDispose, reactive, watch } from 'vue';
import type { ArtNetBackend } from '../bridge/backend';
import type { PortRef } from '../bridge/protocol-model';
import type { RdmResult } from '../bridge/protocol-messages';
import { RDM_SETTINGS_REREAD_MS } from '../rdm/parameter-form/use-rdm-parameter-form';
import type { NodeDescription } from './use-node-context';
import { NODE_PORT_COUNT, nodePortNumber, nodePortPids, type PortEnableState } from './port-rules';

/** Decodes a bool PID answer (`value` when the bridge decoded it, else the first data byte). */
export function decodeEnabled(answer: Pick<RdmResult, 'data' | 'value'>): boolean | null {
  if (typeof answer.value === 'boolean') return answer.value;
  if (typeof answer.value === 'number') return answer.value !== 0;
  if (answer.data.length < 2) return null;
  const byte = Number.parseInt(answer.data.slice(0, 2), 16);
  return Number.isNaN(byte) ? null : byte !== 0;
}

/** `PORTn_ENABLED` of every port of the node (see file comment); `rereadMs` 0 = no periodic re-read. */
export function usePortEnabled(backend: ArtNetBackend, desc: NodeDescription, rereadMs: number = RDM_SETTINGS_REREAD_MS) {
  /** Last reported value by port number 1–4; missing = not read. */
  const values = reactive<Record<number, boolean | null>>({});

  /** Port numbers whose PID the node lists. */
  const supported = computed(() => {
    const d = desc.description.value;
    if (!d || !desc.pixelmapperNode.value) return new Set<number>();
    const listed = new Set(d.supportedParameters);
    const ports = new Set<number>();
    for (let n = 1; n <= NODE_PORT_COUNT; n++) if (listed.has(nodePortPids(n).enabled)) ports.add(n);
    return ports;
  });

  /** State of one port for the mode rules. */
  function stateOf(port: PortRef): PortEnableState {
    const n = nodePortNumber(port);
    if (n === null || !supported.value.has(n)) return { supported: false, enabled: null };
    return { supported: true, enabled: values[n] ?? null };
  }

  /** Reads one port's value from the node. */
  async function read(n: number): Promise<void> {
    const address = desc.address.value;
    if (!address) return;
    const answer = await backend.request('rdmGet', { ...address, pid: nodePortPids(n).enabled });
    values[n] = decodeEnabled(answer);
  }

  /** Reads every supported port (failures are logged; the value stays unknown). */
  async function refresh(): Promise<void> {
    await Promise.all([...supported.value].map(n => read(n).catch((err) => {
      console.warn(`[artnet] reading PORT${n}_ENABLED failed:`, err);
    })));
  }

  /**
   * Writes a port's value, then reads it back (the node's answer is shown,
   * not the request). Rejects with the bridge error of the SET.
   */
  async function write(port: PortRef, enabled: boolean): Promise<void> {
    const n = nodePortNumber(port);
    const address = desc.address.value;
    if (n === null || !address || !supported.value.has(n)) throw new Error('The node cannot switch this port off');
    try {
      await backend.request('rdmSet', { ...address, pid: nodePortPids(n).enabled, data: enabled ? '01' : '00' });
    }
    finally {
      await read(n).catch(err => console.warn(`[artnet] re-reading PORT${n}_ENABLED failed:`, err));
    }
  }

  // New description (node, firmware) → read again.
  watch([desc.description, supported], () => { void refresh(); }, { immediate: true });

  // A change at the node's display arrives as a queued message (contract §6.3).
  const off = backend.on('rdmQueued', (event) => {
    const address = desc.address.value;
    if (!address || event.uid !== address.uid || (event.subDevice ?? 0) !== 0) return;
    for (const n of supported.value) {
      if (nodePortPids(n).enabled === event.pid) values[n] = decodeEnabled(event);
    }
  });
  onScopeDispose(off);

  // Periodic re-read (see file comment), only while the bridge is connected.
  if (rereadMs > 0) {
    const timer = setInterval(() => {
      if (backend.state.value.kind === 'connected' && supported.value.size) void refresh();
    }, rereadMs);
    onScopeDispose(() => clearInterval(timer));
  }

  return { stateOf, write, refresh };
}

/** What `usePortEnabled` returns. */
export type PortEnabledHandle = ReturnType<typeof usePortEnabled>;
