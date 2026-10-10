/**
 * Project schema 2 → 3 (plan M3.8, ADR A20): modifier instances replace
 * `direction/originX/originY/angle/fanning/reverse` with a `distribution`.
 *
 * | Old                      | New                                                        |
 * |--------------------------|------------------------------------------------------------|
 * | NONE or fanning 0        | mode none                                                  |
 * | LINEAR                   | linear; end = origin + fanning·(cos, sin) (= same phase)   |
 * | RADIAL                   | radial; same end                                           |
 * | ANGULAR                  | conical; end along the angle, length 0.1                   |
 * | SYMMETRICAL              | order; line from the origin along the angle, mirrored      |
 * | reverse                  | reverse                                                    |
 *
 * Migration is deep and idempotent: any object that looks like a v2
 * instance (a `plugin` string plus legacy fields, no `distribution`) is
 * rewritten wherever it sits (snapshot, presets, pinned modifiers, command
 * payloads, live-op payloads).
 */
import type { Distribution } from '@pixelmapper/extension-api';
import { createDistribution } from '~/utils/engine/distribution/create';
import { legacyBuiltin, migrateLegacyPlugin } from '~/utils/plugins/builtin-legacy';

/** Fields of a v2 instance that the distribution replaces. */
export const LEGACY_DIRECTION_KEYS = ['direction', 'originX', 'originY', 'angle', 'fanning', 'reverse'] as const;

/** v2 direction fields (all optional). */
export interface LegacyDirectionFields {
  direction?: string;
  originX?: number;
  originY?: number;
  angle?: number;
  fanning?: number;
  reverse?: boolean;
}

/** Converts v2 direction fields into a distribution. */
export function distributionFromLegacy(f: LegacyDirectionFields): Distribution {
  const origin = { x: Number(f.originX ?? 0.5), y: Number(f.originY ?? 0.5) };
  const angle = Number(f.angle ?? 0);
  const fanning = Number(f.fanning ?? 0);
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const along = (len: number) => ({ x: origin.x + dir.x * len, y: origin.y + dir.y * len });
  const reverse = !!f.reverse;
  const direction = f.direction ?? 'NONE';
  if (direction === 'NONE' || fanning === 0) return createDistribution({ mode: 'none', origin, end: along(0.1), reverse });
  switch (direction) {
    case 'LINEAR': return createDistribution({ mode: 'linear', origin, end: along(fanning), reverse });
    case 'RADIAL': return createDistribution({ mode: 'radial', origin, end: along(fanning), reverse });
    case 'ANGULAR': return createDistribution({ mode: 'conical', origin, end: along(0.1), reverse });
    case 'SYMMETRICAL': return createDistribution({
      mode: 'order', origin, end: along(fanning), reverse,
      order: { ranks: {}, line: { a: origin, b: along(Math.max(fanning, 0.01)) }, mirror: true, snap: 0.5 },
    });
    default: return createDistribution({ mode: 'none', origin, end: along(0.1), reverse });
  }
}

/** True for a plain object. */
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** True when `v` looks like a v2 modifier instance. */
export function isLegacyModifier(v: unknown): v is Record<string, unknown> & LegacyDirectionFields {
  return isObject(v) && typeof v.plugin === 'string' && !('distribution' in v)
    && LEGACY_DIRECTION_KEYS.some(k => k in v);
}

/**
 * Migrates one instance (other objects are returned unchanged): v2 direction
 * fields → distribution, and former built-in hashes → the current built-in
 * with migrated params (plan M6.5).
 */
export function migrateModifier<T>(m: T): T {
  let out: unknown = m;
  if (isLegacyModifier(out)) {
    const next: Record<string, unknown> = { ...out, distribution: distributionFromLegacy(out) };
    for (const k of LEGACY_DIRECTION_KEYS) delete next[k];
    out = next;
  }
  if (isObject(out) && typeof out.plugin === 'string' && legacyBuiltin(out.plugin)) {
    out = migrateLegacyPlugin(out as unknown as Parameters<typeof migrateLegacyPlugin>[0]);
  }
  return out as T;
}

/** Recursively migrates every v2 instance inside `value` (returns a new value when changed). */
export function migrateModifiersDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const m = migrateModifiersDeep(v);
      if (m !== v) changed = true;
      return m;
    });
    return (changed ? out : value) as T;
  }
  if (!isObject(value)) return value;
  const self = migrateModifier(value);
  let changed = self !== value;
  const out: Record<string, unknown> = { ...self };
  for (const [k, v] of Object.entries(self)) {
    if (k === 'distribution') continue;
    const m = migrateModifiersDeep(v);
    if (m !== v) {
      out[k] = m;
      changed = true;
    }
  }
  return (changed ? out : value) as T;
}

/**
 * Converts a partial v2 change set (e.g. a persisted `modifier.update`
 * scrub) against the instance's current distribution.
 */
export function migrateLegacyChanges(current: Distribution, changes: Record<string, unknown>): Record<string, unknown> {
  if (!LEGACY_DIRECTION_KEYS.some(k => k in changes)) return changes;
  const dx = current.end.x - current.origin.x;
  const dy = current.end.y - current.origin.y;
  const mode = current.mode;
  const fields: LegacyDirectionFields = {
    direction: ({ linear: 'LINEAR', radial: 'RADIAL', conical: 'ANGULAR' } as Record<string, string>)[mode] ?? 'LINEAR',
    originX: current.origin.x,
    originY: current.origin.y,
    angle: Math.atan2(dy, dx),
    fanning: Math.hypot(dx, dy),
    reverse: current.reverse,
    ...(changes as LegacyDirectionFields),
  };
  const out: Record<string, unknown> = { ...changes, distribution: { ...current, ...pickHandle(distributionFromLegacy(fields)) } };
  for (const k of LEGACY_DIRECTION_KEYS) delete out[k];
  return out;
}

/** The handle-related fields of a distribution (mode, origin, end, reverse). */
function pickHandle(d: Distribution): Pick<Distribution, 'mode' | 'origin' | 'end' | 'reverse'> {
  return { mode: d.mode, origin: d.origin, end: d.end, reverse: d.reverse };
}
