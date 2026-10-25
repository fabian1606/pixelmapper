/**
 * Node suggestions on the Connectors page (plan M5.2): discovered nodes that
 * have no connector yet and were not dismissed. Dismissals are stored per
 * user (`getUserKey`, API 1.4) and device, like connector setups.
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { getUserKey } from '@pixelmapper/extension-api';
import type { NodeState } from '../bridge/protocol-model';

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

/** Loaded lists by storage key (one per user seen in this session). */
const lists = new Map<string, Ref<ReadonlySet<string>>>();

/** Key of the current user (API 1.4, reactive); `'local'` without a host (tests). */
function userKey(): string {
  try {
    return getUserKey();
  }
  catch {
    return 'local';
  }
}

/** Storage key of the current user. */
function storageKey(): string {
  return DISMISSED_PREFIX + userKey();
}

/** The list stored under `key`, loaded on first use. */
function listFor(key: string): Ref<ReadonlySet<string>> {
  let list = lists.get(key);
  if (list) return list;
  let initial = new Set<string>();
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (Array.isArray(parsed)) initial = new Set(parsed.filter((x): x is string => typeof x === 'string'));
  }
  catch { /* malformed or no storage: empty list */ }
  list = ref<ReadonlySet<string>>(initial);
  lists.set(key, list);
  return list;
}

/** Replaces and stores the current user's list. */
function save(next: Set<string>) {
  const key = storageKey();
  listFor(key).value = next;
  try {
    localStorage.setItem(key, JSON.stringify([...next]));
  }
  catch (err) {
    console.warn('[artnet] cannot store dismissed nodes:', err);
  }
}

/**
 * Dismissed node ids of the current user, with dismiss/restore. The list
 * follows a sign-in or user switch (the user key is reactive).
 */
export function useDismissedNodes() {
  const dismissed: ComputedRef<ReadonlySet<string>> = computed(() => listFor(storageKey()).value);
  return {
    dismissed,
    /** Hides the suggestion for a node. */
    dismiss(nodeId: string) {
      save(new Set([...listFor(storageKey()).value, nodeId]));
    },
    /** Shows the suggestions for these nodes again. */
    restore(nodeIds: Iterable<string>) {
      const next = new Set(listFor(storageKey()).value);
      for (const id of nodeIds) next.delete(id);
      save(next);
    },
  };
}

/** Forgets the loaded lists (tests). */
export function resetDismissedNodesForTests(): void {
  lists.clear();
}
