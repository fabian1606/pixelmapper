/**
 * Node suggestions on the Connectors page (plan M5.2): discovered nodes that
 * have no connector yet and were not dismissed. Dismissals are stored per
 * user and device (like connector setups).
 */
import { ref, type Ref } from 'vue';
import type { NodeState } from '../bridge/protocol-model';
import { hostUserKey } from '../host-connectors';

/** Identity of a configured node connector. */
export interface TakenNode {
  nodeId: string | null;
  ip: string | null;
}

/** True for a node Pixelmapper can output to (not a controller, has an output-capable port). */
export function isOutputNode(node: NodeState): boolean {
  return node.style !== 'controller' && node.ports.some(p => p.canOutput);
}

/** Output nodes without a connector (by id, or by IP for connectors still waiting for their node). */
export function unconnectedNodes(nodes: Iterable<NodeState>, taken: Iterable<TakenNode>): NodeState[] {
  const ids = new Set<string>();
  const ips = new Set<string>();
  for (const t of taken) {
    if (t.nodeId) ids.add(t.nodeId);
    else if (t.ip) ips.add(t.ip);
  }
  return [...nodes].filter(n => isOutputNode(n) && !ids.has(n.nodeId) && !ips.has(n.ip));
}

/** Suggestions: unconnected output nodes that were not dismissed, by name then IP. */
export function suggestNodes(nodes: Iterable<NodeState>, taken: Iterable<TakenNode>, dismissed: ReadonlySet<string>): NodeState[] {
  return unconnectedNodes(nodes, taken)
    .filter(n => !dismissed.has(n.nodeId))
    .sort((a, b) => a.shortName.localeCompare(b.shortName) || a.ip.localeCompare(b.ip, undefined, { numeric: true }));
}

// ── Dismissed nodes ────────────────────────────

/** localStorage key prefix; the user key is appended. */
const DISMISSED_PREFIX = 'pm:artnet:dismissed-nodes:';

const dismissed: Ref<ReadonlySet<string>> = ref(new Set<string>());
let loadedKey: string | null = null;

/** Storage key of the current user. */
function storageKey(): string {
  return DISMISSED_PREFIX + hostUserKey();
}

/** Loads the current user's list when the user changed. */
function ensureLoaded() {
  const key = storageKey();
  if (key === loadedKey) return;
  loadedKey = key;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]');
    dismissed.value = new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  }
  catch {
    dismissed.value = new Set();
  }
}

/** Replaces and stores the list. */
function save(next: Set<string>) {
  dismissed.value = next;
  try {
    localStorage.setItem(storageKey(), JSON.stringify([...next]));
  }
  catch (err) {
    console.warn('[artnet] cannot store dismissed nodes:', err);
  }
}

/** Dismissed node ids of the current user, with dismiss/restore. */
export function useDismissedNodes() {
  ensureLoaded();
  return {
    dismissed: dismissed as Readonly<Ref<ReadonlySet<string>>>,
    /** Hides the suggestion for a node. */
    dismiss(nodeId: string) {
      ensureLoaded();
      save(new Set([...dismissed.value, nodeId]));
    },
    /** Shows the suggestions for these nodes again. */
    restore(nodeIds: Iterable<string>) {
      ensureLoaded();
      const next = new Set(dismissed.value);
      for (const id of nodeIds) next.delete(id);
      save(next);
    },
  };
}

/** Forgets the in-memory list (tests). */
export function resetDismissedNodesForTests(): void {
  loadedKey = null;
  dismissed.value = new Set();
}
