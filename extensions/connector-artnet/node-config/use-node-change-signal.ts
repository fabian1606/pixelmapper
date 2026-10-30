/**
 * “The node changed” signal for the node configuration's RDM-only
 * settings (bridge contract rev 2, `rdmQueued`): the node keeps one queue
 * of queued messages for all controllers, so a change at its display can
 * be fetched by another controller and never reach this window. The
 * contract asks clients to re-read the node's settings PIDs on `node`
 * events that change the node, besides every 30–60 s.
 *
 * `node` events are not a heartbeat (the bridge sends them only on
 * changes, and a new node arrives as several events, one per BindIndex
 * page), so the signal compares a signature of what can reflect a settings
 * change — names, ports, addresses, status, firmware, IP — and leaves out
 * what moves on its own (`lastSeen`, the NodeReport counter, data-flow
 * flags). Changes within `debounceMs` count once.
 */
import { onScopeDispose, ref, watch, type Ref } from 'vue';
import type { NodeState } from '../bridge/protocol-model';

/** Default time that coalesces a burst of node events (e.g. the BindIndex pages of a restart). */
export const NODE_CHANGE_DEBOUNCE_MS = 1000;

/** NodeReport without its poll counter: `#0001 [0123] OK` → `#0001 [] OK`. */
export function stripReportCounter(report: string): string {
  return report.replace(/\[\d+\]/, '[]');
}

/**
 * What of a node can reflect a settings change, as a comparable string:
 * everything except `lastSeen`, the NodeReport counter and the ports'
 * data-flow flags (data, merging, discovery running, input errors).
 */
export function nodeSettingsSignature(node: NodeState): string {
  const { lastSeen: _lastSeen, nodeReport, ports, ...rest } = node;
  return JSON.stringify({
    ...rest,
    nodeReport: stripReportCounter(nodeReport),
    ports: ports.map(({ output, input, ...port }) => ({
      ...port,
      output: { ...output, data: undefined, merging: undefined, discoveryRunning: undefined },
      input: { ...input, data: undefined, errors: undefined },
    })),
  });
}

/**
 * Counter that goes up (debounced) whenever the node's settings signature
 * changes, and when the node answers again after it was away (it may have
 * restarted with other settings). The first state seen is the baseline and
 * does not count: whoever shows the settings reads them then anyway. Use
 * it as a watch source to re-read.
 */
export function useNodeChangeSignal(node: () => NodeState | null, debounceMs: number = NODE_CHANGE_DEBOUNCE_MS): Ref<number> {
  const tick = ref(0);
  /** A state was seen before (the baseline exists). */
  let seen = false;
  /** Signature of the last state; null while the node is away. */
  let last: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** Counts one change after the burst settled. */
  function bump() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      tick.value++;
    }, debounceMs);
  }

  watch(() => {
    const n = node();
    return n ? nodeSettingsSignature(n) : null;
  }, (signature) => {
    if (signature === null) {
      last = null; // away: its return counts as a change
      return;
    }
    if (seen && signature !== last) bump();
    seen = true;
    last = signature;
  }, { immediate: true, flush: 'sync' });

  onScopeDispose(() => {
    if (timer) clearTimeout(timer);
  });
  return tick;
}
