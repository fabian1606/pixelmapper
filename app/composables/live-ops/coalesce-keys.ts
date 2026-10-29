/**
 * Per-target coalescing keys for persistent live-ops (ADR 0004 D8).
 *
 * A live-op with `merge: 'replace'` is coalesced by its dedupKey in the
 * persist queue AND in the WAL: a newer entry with the same key replaces the
 * pending older one. The key must therefore identify exactly what the payload
 * overwrites — otherwise edits on two different targets within one settle
 * window collapse into one and the first is never persisted.
 *
 * Keys are built from sorted target lists so the same set of targets always
 * maps to the same key regardless of payload order.
 */

/** Stable, order-independent join of target ids. */
function targetSet(ids: Array<string | number>): string {
  return [...new Set(ids.map(String))].sort().join(',');
}

/**
 * `modifier.update` is a PARTIAL patch: it only supersedes an earlier patch of
 * the same modifier touching the same fields (and param fields).
 */
export function modifierUpdateKey(p: {
  effectId: string;
  changes?: Record<string, unknown>;
  paramChanges?: Record<string, unknown>;
}): string {
  const fields = targetSet(Object.keys(p.changes ?? {}));
  const params = targetSet(Object.keys(p.paramChanges ?? {}));
  return `modifier.update:${p.effectId}:${fields}:${params}`;
}

/** `fixture.drag` overwrites the positions of exactly the listed fixtures. */
export function fixtureDragKey(p: { fixtures: Array<{ id: string | number }> }): string {
  return `fixture.drag:${targetSet((p.fixtures ?? []).map(f => f.id))}`;
}

/** `channel.update` overwrites exactly the listed (fixture, channel) pairs. */
export function channelUpdateKey(p: { channels: Array<{ fixtureId: string | number; channelIndex: number }> }): string {
  return `channel.update:${targetSet((p.channels ?? []).map(c => `${c.fixtureId}#${c.channelIndex}`))}`;
}

/** `color.override` overwrites the override of one preset. */
export function colorOverrideKey(p: { key: string }): string {
  return `color.override:${p.key}`;
}
