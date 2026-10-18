// ── snapshot-preview: request parsing + layout normalization ────────────────
//
// Pure functions (no Deno/Supabase imports), unit-tested with
// `bun test supabase/functions/_shared`. Used by `snapshot-preview`
// (version-history hover previews, migration 014).

import { isUuid, type Parsed } from './validate.ts';

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum fixtures the RPC may return (its p_limit clamp). */
export const PREVIEW_MAX_FIXTURES = 1000;

/** Maximum top-level groups the RPC returns. */
export const PREVIEW_MAX_GROUPS = 100;

/** Maximum length of a group name. */
export const PREVIEW_GROUP_NAME_MAX = 60;

/** Maximum beam count per fixture. */
export const PREVIEW_MAX_BEAMS = 256;

/** Shape codes of a fixture tuple. */
export const PREVIEW_SHAPE = { single: 0, multi: 1, kind: 2 } as const;

const COLOR_RE = /^#[0-9a-f]{6}$/i;

// ── Request ──────────────────────────────────────────────────────────────────

export interface SnapshotPreviewRequest {
  projectId: string;
  snapshotId: string;
}

/** `{ projectId, snapshotId }` — both UUIDs (lower-cased). */
export function parseSnapshotPreview(body: Record<string, unknown> | null): Parsed<SnapshotPreviewRequest> {
  const projectId = body?.projectId;
  const snapshotId = body?.snapshotId;
  if (typeof projectId !== 'string' || typeof snapshotId !== 'string' || !projectId || !snapshotId) {
    return { ok: false, error: 'projectId and snapshotId required' };
  }
  if (!isUuid(projectId)) return { ok: false, error: 'projectId must be a UUID' };
  if (!isUuid(snapshotId)) return { ok: false, error: 'snapshotId must be a UUID' };
  return { ok: true, value: { projectId: projectId.toLowerCase(), snapshotId: snapshotId.toLowerCase() } };
}

// ── Layout ───────────────────────────────────────────────────────────────────

/**
 * One fixture: `[x, y, w, h, r, c, s, b, g]`.
 * x/y normalized centre (0…1 of the 3000 px world), w/h size multipliers of
 * FIXTURE_RADIUS (18 px), r rotation in degrees, c base colour `#rrggbb` or
 * null, s shape (0 single-beam circle, 1 multi-beam rect, 2 kind AABB rect),
 * b beam count, g index into `groups` (-1 = no group).
 */
export type PreviewFixture = [number, number, number, number, number, string | null, number, number, number];

/** One top-level group: `[name]`. */
export type PreviewGroup = [string];

export interface PreviewLayout {
  fixtures: PreviewFixture[];
  groups: PreviewGroup[];
  /** All drawable fixtures of the snapshot (≥ fixtures.length). */
  total: number;
  /** True when `fixtures` was capped. */
  truncated: boolean;
}

export interface SnapshotPreviewResponse {
  snapshotId: string;
  layout: PreviewLayout;
}

/** Clamps a number into [min, max]. */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Finite number or the fallback. */
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Normalizes one group entry; malformed entries keep their slot (indices stay aligned). */
function normalizeGroup(raw: unknown): PreviewGroup {
  const name = Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0] : '';
  return [name.slice(0, PREVIEW_GROUP_NAME_MAX)];
}

/**
 * Normalizes one fixture tuple; `null` when x/y are not finite numbers.
 * Clamps x/y to 0…1, w/h to 0.01…100, beams to 0…256, wraps r into
 * (-360, 360), drops invalid colours / shapes / group indices.
 */
function normalizeFixture(raw: unknown, groupCount: number): PreviewFixture | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const [x, y, w, h, r, c, s, b, g] = raw;
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return null;
  const shape = s === PREVIEW_SHAPE.multi || s === PREVIEW_SHAPE.kind ? s : PREVIEW_SHAPE.single;
  const group = Number.isInteger(g) && (g as number) >= 0 && (g as number) < groupCount ? g as number : -1;
  return [
    clamp(x, 0, 1),
    clamp(y, 0, 1),
    clamp(num(w, 1), 0.01, 100),
    clamp(num(h, 1), 0.01, 100),
    Math.round(num(r, 0)) % 360,
    typeof c === 'string' && COLOR_RE.test(c) ? c.toLowerCase() : null,
    shape,
    Math.round(clamp(num(b, 0), 0, PREVIEW_MAX_BEAMS)),
    group,
  ];
}

/**
 * Defensive mapping of the `snapshot_preview_layout` result: drops malformed
 * fixture tuples, clamps values, caps fixtures (1000) and groups (100).
 * `null` when the result is not an object (= snapshot not found).
 */
export function normalizeLayout(raw: unknown): PreviewLayout | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const groups = (Array.isArray(obj.groups) ? obj.groups : [])
    .slice(0, PREVIEW_MAX_GROUPS)
    .map(normalizeGroup);
  const fixtures = (Array.isArray(obj.fixtures) ? obj.fixtures : [])
    .slice(0, PREVIEW_MAX_FIXTURES)
    .map(f => normalizeFixture(f, groups.length))
    .filter((f): f is PreviewFixture => f !== null);
  const total = Math.max(Math.trunc(num(obj.total, 0)), fixtures.length);
  return { fixtures, groups, total, truncated: obj.truncated === true || total > fixtures.length };
}
