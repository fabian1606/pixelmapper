/**
 * Target resolution and sample layout of an observation (ADR 0002 §6.1).
 *
 * `resolveTargets` turns an `ObserveTargets` selector into fixtures (in
 * layout order) plus the groups named by it (per-group features);
 * `headSamples` lists the observable heads of those fixtures with their
 * world positions exactly as the layout packet sends them to the engine.
 */
import type { ObserveTargets } from '@pixelmapper/agent-kit';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { GroupInfo } from '~/utils/operations/read-api';
import { fixtureInfo, fixtureSignatures } from '~/utils/operations/read-api';
import { beamWorldPx } from '~/utils/kinds/kind-host';
import { WORLD_HEIGHT, WORLD_WIDTH } from '~/utils/engine/constants';
import type { Signature } from '~/utils/engine/types';
import type { TraceSample } from './types';

// ── Targets ─────────────────────────────────────

/** Resolved observation targets. */
export interface ResolvedTargets {
  /** Targeted fixtures in layout order. */
  fixtures: Fixture[];
  /** Groups named by the selector (per-group features). */
  groups: { id: string | number; name: string; fixtureIds: Array<string | number> }[];
  /** Ids in the selector that matched nothing. */
  unknown: Array<string | number>;
}

/** Project state the resolver needs (injectable for tests). */
export interface TargetSources {
  fixtures: readonly Fixture[];
  groups: readonly GroupInfo[];
  selection: readonly (string | number)[];
}

/** Same id, tolerant of number/string mixups (ids arrive as JSON). */
const sameId = (a: string | number, b: string | number) => String(a) === String(b);

/**
 * Resolves a selector: `'all'`, `'selection'`, fixture/group ids, or a
 * filter object (ids / groupIds / kind / signature / name substring).
 */
export function resolveTargets(targets: ObserveTargets, src: TargetSources): ResolvedTargets {
  const unknown: Array<string | number> = [];
  const groups: ResolvedTargets['groups'] = [];
  const wanted = new Set<string>();
  const addGroup = (g: GroupInfo) => {
    groups.push({ id: g.id, name: g.name, fixtureIds: g.fixtureIds });
    for (const id of g.fixtureIds) wanted.add(String(id));
  };
  /** Adds an id that may name a fixture or a group. */
  const addId = (id: string | number) => {
    if (src.fixtures.some(f => sameId(f.id, id))) wanted.add(String(id));
    else {
      const g = src.groups.find(x => sameId(x.id, id));
      if (g) addGroup(g);
      else unknown.push(id);
    }
  };

  if (targets === 'all') {
    for (const f of src.fixtures) wanted.add(String(f.id));
  }
  else if (targets === 'selection') {
    for (const id of src.selection) wanted.add(String(id));
  }
  else if (Array.isArray(targets)) {
    targets.forEach(addId);
  }
  else {
    const hasSet = !!(targets.ids?.length || targets.groupIds?.length);
    targets.ids?.forEach(addId);
    for (const gid of targets.groupIds ?? []) {
      const g = src.groups.find(x => sameId(x.id, gid));
      if (g) addGroup(g);
      else unknown.push(gid);
    }
    if (!hasSet) for (const f of src.fixtures) wanted.add(String(f.id));
    // Filters narrow the set.
    for (const f of src.fixtures) {
      if (!wanted.has(String(f.id))) continue;
      const info = fixtureInfo(f);
      const ok = (!targets.kind || info.kind === targets.kind || info.oflKey === targets.kind)
        && (!targets.signature || info.signatures.includes(targets.signature as Signature))
        && (!targets.name || f.name.toLowerCase().includes(targets.name.toLowerCase()));
      if (!ok) wanted.delete(String(f.id));
    }
  }

  return { fixtures: src.fixtures.filter(f => wanted.has(String(f.id))), groups, unknown };
}

/**
 * Signature to observe: the requested one, else the most expressive one
 * every fixture offers (rgb → panTilt → scalar).
 */
export function pickSignature(fixtures: readonly Fixture[], requested?: string): Signature {
  if (requested === 'rgb' || requested === 'panTilt' || requested === 'scalar') return requested;
  const all = fixtures.map(fixtureSignatures);
  for (const s of ['rgb', 'panTilt'] as const) if (all.length > 0 && all.every(list => list.includes(s))) return s;
  return 'scalar';
}

// ── Samples ─────────────────────────────────────

/** A head sample plus its layout coordinates (group index in the engine). */
export interface HeadSample extends TraceSample {
  /** Index of the fixture in the full layout (engine group index). */
  layoutIndex: number;
}

/**
 * Heads of `fixtures` with their world positions as in `buildLayoutBin`:
 * a head is a beam that owns channels; fixtures without beam channels have
 * one head at the fixture position. `layout` is the full layout fixture list.
 */
export function headSamples(fixtures: readonly Fixture[], layout: readonly Fixture[], groupIds: (f: Fixture) => Array<string | number>): HeadSample[] {
  const out: HeadSample[] = [];
  for (const f of fixtures) {
    const layoutIndex = layout.findIndex(l => l.id === f.id);
    if (layoutIndex < 0) continue;
    const beamIndex = new Map(f.beams.map((b, i) => [b.id, i]));
    // Engine head count = highest head index of any channel + 1.
    let headCount = 1;
    for (const ch of f.channels) {
      const h = ch.beamId !== undefined ? (beamIndex.get(ch.beamId) ?? 0) : 0;
      headCount = Math.max(headCount, h + 1);
    }
    for (let h = 0; h < headCount; h++) {
      const beam = f.beams[h];
      const ownsChannels = f.channels.some(c => c.beamId !== undefined && c.beamId === beam?.id);
      let x = f.fixturePosition.x;
      let y = f.fixturePosition.y;
      if (beam && ownsChannels) {
        const p = beamWorldPx(f, beam);
        x = p.x / WORLD_WIDTH;
        y = p.y / WORLD_HEIGHT;
      }
      out.push({
        fixtureId: f.id,
        fixtureName: f.name,
        head: h,
        headCount,
        x,
        y,
        z: Number.isFinite(f.positionZ) ? f.positionZ : 0,
        groupIds: groupIds(f),
        layoutIndex,
      });
    }
  }
  return out;
}
