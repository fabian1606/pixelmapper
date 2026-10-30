/**
 * Distribution rig of the validation harness (ABI v1.1/v1.2 fields).
 *
 * Mirrors `rs-engine/core/src/distribution.rs` + the sample filling in
 * `engine.rs` for the synthetic layout, so plugins driven by `Frame.timePhase`,
 * `Frame.rankCount`/`spread`/handle and `Sample.spatial`/`rank`/`distGroup`
 * see realistic values. One rig distribution is produced per mode/scope the
 * manifest offers (`distribution.modes` / `scopes`, default: all).
 */
import type { DistributionMode, DistributionScope } from '@pixelmapper/extension-api';
import { CTX, SAMPLE, SAMPLE_FIELDS } from './runtime';
import type { ContentPluginManifest } from './types';

/** Ranks used for grouping gradient modes (engine `QUANTIZED_RANKS`). */
const QUANTIZED_RANKS = 16;
/** Group count of the rig's "every N" grouping (when grouping is required). */
const RIG_GROUPS = 4;
/** Modes offered when the manifest does not restrict them. */
const ALL_MODES: DistributionMode[] = ['none', 'linear', 'radial', 'conical', 'order'];
/** Scopes offered when the manifest does not restrict them. */
const ALL_SCOPES: DistributionScope[] = ['across', 'within'];

/** One distribution the rig renders with. */
export interface RigDistribution {
  /** Label used in error messages (e.g. `order`, `within+order`). */
  name: string;
  scope: DistributionScope;
  mode: DistributionMode;
  /** Gradient handle in normalized world coordinates. */
  origin: [number, number];
  end: [number, number];
  /** Scope within: offset fixtures by their order rank. */
  withinOrder: boolean;
  /** "Every N" group count (0 = no grouping). */
  groups: number;
}

/** Frame-level values of a distribution (ctx slots 9–15). */
export interface RigDistributionFrame {
  rankCount: number;
  distGroupCount: number;
  spread: number;
  origin: [number, number];
  end: [number, number];
}

/** The distributions to validate with, derived from the manifest's `distribution` block. */
export function rigDistributions(manifest: ContentPluginManifest): RigDistribution[] {
  const d = manifest.distribution;
  const modes = d?.modes?.length ? d.modes : ALL_MODES;
  const scopes = d?.scopes?.length ? d.scopes : ALL_SCOPES;
  // Pattern-like plugins always run grouped; otherwise the rig skips grouping.
  const groups = d?.grouping === 'required' ? RIG_GROUPS : 0;
  const out: RigDistribution[] = [];
  const base = { withinOrder: false, groups };
  if (scopes.includes('across')) {
    for (const mode of modes) {
      // Linear sweeps left → right; radial/conical start at the room center.
      const origin: [number, number] = mode === 'linear' ? [0, 0.5] : [0.5, 0.5];
      out.push({ ...base, name: mode, scope: 'across', mode, origin, end: [1, 0.5] });
    }
  }
  if (scopes.includes('within')) {
    out.push({ ...base, name: 'within', scope: 'within', mode: 'none', origin: [0, 0.5], end: [1, 0.5] });
    if (d?.withinOffset !== false) {
      out.push({ ...base, name: 'within+order', scope: 'within', mode: 'none', origin: [0, 0.5], end: [1, 0.5], withinOrder: true });
    }
  }
  return out;
}

/** Spatial position of a point for the gradient modes (engine `gradient_spatial`). */
function gradientSpatial(dist: RigDistribution, x: number, y: number): number {
  const ex = dist.end[0] - dist.origin[0];
  const ey = dist.end[1] - dist.origin[1];
  const len = Math.max(Math.hypot(ex, ey), 1e-4);
  const px = x - dist.origin[0];
  const py = y - dist.origin[1];
  switch (dist.mode) {
    case 'linear': return (px * ex + py * ey) / (len * len);
    case 'radial': return Math.hypot(px, py) / len;
    case 'conical': {
      const a = (Math.atan2(py, px) - Math.atan2(ey, ex)) / (Math.PI * 2);
      return a - Math.floor(a);
    }
    default: return 0;
  }
}

/**
 * Writes `spatial`, `rank` and `distGroup` of every sample for `dist` and
 * returns the frame-level values. The rig's order ranks are the fixture
 * indices (`groupIndex`), `rankCount` = fixture count.
 */
export function applyDistribution(dist: RigDistribution, samples: Float32Array, count: number, fixtures: number): RigDistributionFrame {
  const gradient = dist.mode === 'linear' || dist.mode === 'radial' || dist.mode === 'conical';
  let maxHeads = 1;
  for (let i = 0; i < count; i++) {
    const o = i * SAMPLE_FIELDS;
    const fixture = samples[o + SAMPLE.groupIndex]!;
    const head = samples[o + SAMPLE.headIndex]!;
    const heads = Math.max(1, samples[o + SAMPLE.headCount]!);
    maxHeads = Math.max(maxHeads, heads);
    let spatial = 0;
    let rank = -1;
    let rankCount = 0;
    if (dist.scope === 'within') {
      rank = head;
      rankCount = heads;
      spatial = dist.withinOrder ? (fixture + head / heads) / fixtures : head / heads;
    }
    else if (dist.mode === 'order') {
      rank = fixture;
      rankCount = fixtures;
      spatial = rank / rankCount;
    }
    else if (gradient) {
      spatial = gradientSpatial(dist, samples[o + SAMPLE.x]!, samples[o + SAMPLE.y]!);
    }
    let group = -1;
    if (dist.groups > 0) {
      // Gradient modes group a quantized spatial position.
      if (dist.scope === 'across' && gradient) {
        rank = Math.min(Math.floor(Math.min(Math.max(spatial, 0), 1) * QUANTIZED_RANKS), QUANTIZED_RANKS - 1);
        rankCount = QUANTIZED_RANKS;
      }
      if (rank >= 0 && rankCount > 0) {
        group = rank % dist.groups;
        spatial = group / dist.groups;
      }
    }
    samples[o + SAMPLE.spatial] = spatial;
    samples[o + SAMPLE.rank] = rank;
    samples[o + SAMPLE.distGroup] = group;
  }
  // Frame counts (engine `frame_counts`) and spread kind (`spread_kind`).
  const rankCount = dist.scope === 'within' ? maxHeads
    : dist.mode === 'order' ? fixtures
      : gradient && dist.groups > 0 ? QUANTIZED_RANKS : 0;
  const spread = dist.scope === 'within' ? 3 : dist.mode === 'none' ? 0 : dist.mode === 'order' ? 2 : 1;
  return { rankCount, distGroupCount: dist.groups > 0 && rankCount > 0 ? dist.groups : 0, spread, origin: dist.origin, end: dist.end };
}

/** Writes the frame-level distribution slots into `ctx`. */
export function writeDistributionFrame(ctx: Float32Array, frame: RigDistributionFrame): void {
  ctx[CTX.rankCount] = frame.rankCount;
  ctx[CTX.distGroupCount] = frame.distGroupCount;
  ctx[CTX.spread] = frame.spread;
  ctx[CTX.handleOriginX] = frame.origin[0];
  ctx[CTX.handleOriginY] = frame.origin[1];
  ctx[CTX.handleEndX] = frame.end[0];
  ctx[CTX.handleEndY] = frame.end[1];
}
