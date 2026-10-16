/**
 * Slot id matching (ADR §5.3).
 *
 * A slot id is `<path>:<position>` where `<path>` is the `/`-joined ids of the
 * enclosing layout primitives. Contributions address slots by exact id or
 * glob: `*` matches exactly one path segment, `**` any number (including
 * zero). The position part is matched literally (or `*` for any position).
 *
 * Resolution is memoized per slot id and invalidated whenever the registry
 * changes, so rendering a slot is a map lookup after the first time.
 */
import { shallowReactive } from 'vue';
import type { SlotContribution } from '@pixelmapper/extension-api';
import { getContributions, registryVersion, type OwnedContribution } from './registry';

/** Splits `a/b:pos` into `{ path: ['a','b'], position: 'pos' }`. */
export function parseSlotId(id: string): { path: string[]; position: string } {
  const colon = id.lastIndexOf(':');
  if (colon < 0) return { path: id.split('/').filter(Boolean), position: '' };
  return { path: id.slice(0, colon).split('/').filter(Boolean), position: id.slice(colon + 1) };
}

/** Escapes a literal for use in a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compiled-pattern cache (patterns are few and reused). */
const patternCache = new Map<string, RegExp>();

/**
 * Compiles a slot glob into a RegExp. The RegExp is matched against
 * `'/' + slotId`, so every segment (including the first) carries its own
 * leading `/`: `**` → `(?:/seg)*`, `*` → `/seg`, literal → `/literal`.
 */
export function compileSlotGlob(pattern: string): RegExp {
  const cached = patternCache.get(pattern);
  if (cached) return cached;

  const { path, position } = parseSlotId(pattern);
  let re = '^';
  for (const seg of path) {
    if (seg === '**') re += '(?:/[^/:]+)*';
    else if (seg === '*') re += '/[^/:]+';
    else re += `/${escapeRe(seg)}`;
  }
  re += position === '*' ? ':[^/:]+$' : `:${escapeRe(position)}$`;

  const compiled = new RegExp(re);
  patternCache.set(pattern, compiled);
  return compiled;
}

/** True when `slotId` is addressed by `pattern`. */
export function matchesSlot(pattern: string, slotId: string): boolean {
  return compileSlotGlob(pattern).test(`/${slotId}`);
}

/**
 * Sort order: higher `priority` first, then extension id, then declaration
 * order (stable sort keeps it).
 */
export function compareContributions(
  a: OwnedContribution<'slots'>,
  b: OwnedContribution<'slots'>,
): number {
  const pa = a.contribution.priority ?? 0;
  const pb = b.contribution.priority ?? 0;
  if (pa !== pb) return pb - pa;
  return a.extensionId.localeCompare(b.extensionId);
}

/** Resolves and orders contributions for one slot id from a list. */
export function resolveSlot(
  slotId: string,
  all: readonly OwnedContribution<'slots'>[],
): OwnedContribution<'slots'>[] {
  return all.filter(c => matchesSlot(c.contribution.slot, slotId)).sort(compareContributions);
}

// ── Memoized index ──────────────────────────────

let indexVersion = -1;
let allSlots: OwnedContribution<'slots'>[] = [];
const index = new Map<string, OwnedContribution<'slots'>[]>();

/**
 * Contributions for a slot id, memoized. Reading `registryVersion` makes
 * callers inside a `computed` re-evaluate when extensions change.
 */
export function getSlotContributions(slotId: string): OwnedContribution<'slots'>[] {
  const version = registryVersion.value;
  if (version !== indexVersion) {
    indexVersion = version;
    allSlots = getContributions('slots');
    index.clear();
  }
  let hit = index.get(slotId);
  if (!hit) {
    hit = resolveSlot(slotId, allSlots);
    index.set(slotId, hit);
  }
  return hit;
}

/** Every slot id rendered so far in this session (dev catalog, plan P7.3). */
export const renderedSlotIds = new Set<string>();

/**
 * Slot ids rendered so far with the scope names available there (dev and
 * tests only). Feeds the `/dev/slots` catalog and `docs/ai/index.json`.
 */
export const renderedSlots = shallowReactive(new Map<string, string[]>());

/** Records a rendered slot (merging scope names). */
export function recordRenderedSlot(id: string, scopeNames: string[]): void {
  renderedSlotIds.add(id);
  const prev = renderedSlots.get(id);
  if (prev && scopeNames.every(n => prev.includes(n))) return;
  renderedSlots.set(id, [...new Set([...(prev ?? []), ...scopeNames])].sort());
}

/** Re-export for consumers that only need the contribution type. */
export type { SlotContribution };
