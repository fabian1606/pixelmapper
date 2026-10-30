import type { EntityId } from './types';

/**
 * Value helpers for the 3-way merge: plain-object detection, deep equality
 * and deep cloning of JSON-like data.
 *
 * Semantics follow JSON: an object key whose value is `undefined` is treated
 * exactly like a missing key, so `{ a: undefined }` equals `{}`.
 */

// ── Type guards ──────────────────────────────────────────────────────────────

/** Plain object (`{}` literal or null-prototype), not an array/Date/class instance. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** True for values usable as entity ids (non-empty string or finite number). */
export function isEntityId(value: unknown): value is EntityId {
  return (typeof value === 'string' && value.length > 0)
    || (typeof value === 'number' && Number.isFinite(value));
}

// ── Equality ─────────────────────────────────────────────────────────────────

/** Keys of an object whose values are not `undefined`. */
export function definedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter(k => obj[k] !== undefined);
}

/**
 * Structural equality for JSON-like values. `NaN` equals `NaN`; `undefined`
 * object entries are ignored; arrays compare element-wise in order.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // NaN is the only value not equal to itself.
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = definedKeys(a);
    const keysB = definedKeys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

// ── Cloning ──────────────────────────────────────────────────────────────────

/**
 * Deep clone of JSON-like data so merge results never alias their inputs.
 * Works on Vue proxies too (unlike `structuredClone`). `undefined` object
 * entries are dropped; non-plain objects are returned as-is (they are not
 * expected in persisted project data).
 */
export function deepClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => deepClone(item)) as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const v = value[key];
      if (v !== undefined) out[key] = deepClone(v);
    }
    return out as T;
  }
  return value;
}
