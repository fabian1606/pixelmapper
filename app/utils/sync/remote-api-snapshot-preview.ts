import { invokeRemote, type RemoteClient } from '~/utils/sync/remote-api-invoke';
import type { RemoteResult } from '~/utils/sync/remote-api-types';

/**
 * Typed wrapper of the `snapshot-preview` edge function (version-history
 * hover preview, migration 014). Same conventions as `remote-api.ts` (never
 * throws, `RemoteResult`). The server sends a compact layout computed in SQL
 * from the snapshot's scene tree — never the snapshot itself.
 *
 * Wire format of one fixture: `[x, y, w, h, r, c, s, b, g]`
 *   x, y  position, normalized 0…1 of the world (3000 × 3000 px)
 *   w, h  size multipliers (the canvas draws ±18 world px × size)
 *   r     rotation in degrees
 *   c     base color `#rrggbb` (single color fixture) or null (multi-color / none)
 *   s     shape: 0 single beam (circle), 1 multi beam (pixel bar), 2 kind (body AABB)
 *   b     beam count (pixel dots of multi-beam fixtures)
 *   g     index of the top-level group in `groups`, -1 = none
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Shape codes of `PreviewFixture.shape`. */
export const PREVIEW_SHAPE = { single: 0, multi: 1, kind: 2 } as const;
export type PreviewShape = typeof PREVIEW_SHAPE[keyof typeof PREVIEW_SHAPE];

/** One fixture of the preview layout (decoded wire tuple). */
export interface PreviewFixture {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees. */
  r: number;
  /** `#rrggbb` or null (multi-color / no color channel → neutral). */
  color: string | null;
  shape: PreviewShape;
  beams: number;
  /** Index into `SnapshotLayout.groups`, -1 = not grouped. */
  group: number;
}

export interface SnapshotLayout {
  fixtures: PreviewFixture[];
  /** Names of the top-level groups (scene order). */
  groups: string[];
  /** All fixtures of the snapshot (can exceed `fixtures.length`). */
  total: number;
  /** True when the server capped the fixture list. */
  truncated: boolean;
}

export interface SnapshotPreview {
  snapshotId: string;
  layout: SnapshotLayout;
}

export interface SnapshotPreviewInput {
  projectId: string;
  snapshotId: string;
}

// ── API ──────────────────────────────────────────────────────────────────────

/** Loads the preview layout of one version-history entry; `signal` cancels it. */
export function getSnapshotPreview(
  client: RemoteClient,
  input: SnapshotPreviewInput,
  signal?: AbortSignal,
): Promise<RemoteResult<SnapshotPreview>> {
  return invokeRemote(
    client,
    'snapshot-preview',
    { projectId: input.projectId, snapshotId: input.snapshotId },
    parseSnapshotPreviewResponse,
    { signal },
  );
}

// ── Parsing ──────────────────────────────────────────────────────────────────

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Validates the response body; null for an unexpected shape. Malformed fixtures are dropped. */
export function parseSnapshotPreviewResponse(data: unknown): SnapshotPreview | null {
  const d = asRecord(data);
  const layout = asRecord(d?.layout);
  if (!d || typeof d.snapshotId !== 'string' || !layout || !Array.isArray(layout.fixtures)) return null;
  const groups = (Array.isArray(layout.groups) ? layout.groups : []).map(groupName);
  const fixtures = layout.fixtures
    .map(raw => parseFixture(raw, groups.length))
    .filter((f): f is PreviewFixture => !!f);
  const total = Number(layout.total);
  return {
    snapshotId: d.snapshotId,
    layout: {
      fixtures,
      groups,
      total: Number.isFinite(total) && total >= fixtures.length ? Math.floor(total) : fixtures.length,
      truncated: layout.truncated === true,
    },
  };
}

/** Decodes one `[x, y, w, h, r, c, s, b, g]` tuple; null without a finite position. */
function parseFixture(raw: unknown, groupCount: number): PreviewFixture | null {
  if (!Array.isArray(raw)) return null;
  const [x, y, w, h, r, c, s, b, g] = raw as unknown[];
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  const shape = s === 1 || s === 2 ? s : 0;
  const group = isFiniteNumber(g) && g >= 0 && g < groupCount ? Math.floor(g) : -1;
  return {
    x,
    y,
    w: positive(w),
    h: positive(h),
    r: isFiniteNumber(r) ? r : 0,
    color: typeof c === 'string' && HEX_COLOR.test(c) ? c.toLowerCase() : null,
    shape,
    beams: isFiniteNumber(b) && b > 0 ? Math.min(Math.floor(b), 256) : 1,
    group,
  };
}

/** Group entry: a name or a tuple starting with the name. */
function groupName(raw: unknown): string {
  const name = Array.isArray(raw) ? raw[0] : raw;
  return typeof name === 'string' ? name : '';
}

/** Size multiplier: positive finite, else 1; clamped to a sane range. */
function positive(value: unknown): number {
  return isFiniteNumber(value) && value > 0 ? Math.min(value, 1000) : 1;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Plain object or null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
