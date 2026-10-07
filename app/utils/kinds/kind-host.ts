/**
 * Fixture-kind host (plan P5.1, ADR §5.6, D15).
 *
 * Kinds are extension contributions that compile a config into the canonical
 * fixture model. This module looks kinds up in the extension registry, builds
 * them into `Fixture` instances (channels, beams, compiled body/handles) and
 * converts between kind-relative and world coordinates.
 *
 * Coordinates: everything a kind returns is in world pixels **relative to the
 * fixture origin** (`fixturePosition`); the core applies position and
 * rotation, so moving/rotating a kind fixture needs no kind code.
 */
import { reactive, toRaw } from 'vue';
import type { FixtureKindDefinition, Json, KindBuildContext, KindBuildResult, Vec2 } from '@pixelmapper/extension-api';
import { Fixture } from '~/utils/engine/core/fixture';
import { Beam } from '~/utils/engine/core/beam';
import type { Channel } from '~/utils/engine/core/channel';
import { FIXTURE_RADIUS, STAGE_SIZE_METERS, WORLD_HEIGHT, WORLD_WIDTH } from '~/utils/engine/constants';
import { getContributions } from '~/utils/extensions/registry';

// ── Registry ─────────────────────────────────────

/** A registered kind with its owning extension. */
export interface RegisteredKind {
  extensionId: string;
  def: FixtureKindDefinition<Json>;
}

/** All registered kinds. */
export function listKinds(): RegisteredKind[] {
  return getContributions('fixtureKinds').map(c => ({ extensionId: c.extensionId, def: c.contribution as FixtureKindDefinition<Json> }));
}

/** A kind by id (undefined when its extension is not installed). */
export function getKind(id: string): RegisteredKind | undefined {
  return listKinds().find(k => k.def.id === id);
}

// ── Build ────────────────────────────────────────

/** World pixels per meter (3000 px world / 12 m stage). */
export const PIXELS_PER_METER = WORLD_WIDTH / STAGE_SIZE_METERS;

/** Context for pure kind functions. */
export function kindContext(fixtureId: string | number): KindBuildContext {
  return { pixelsPerMeter: PIXELS_PER_METER, worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT, fixtureId: String(fixtureId) };
}

/** JSON deep copy (configs are plain JSON; works on reactive proxies). */
export function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(toRaw(v))) as T;
}

/** A static single-step chaser config. */
function staticChaser(value: number): Channel['chaserConfig'] {
  return reactive({
    stepValues: [value],
    stepsCount: 1,
    activeEditStep: 0,
    isPlaying: false,
    stepDuration: { mode: 'beat' as const, timeMs: 1000, beatValue: 1, beatOffset: 0 },
    fadeDuration: { mode: 'beat' as const, timeMs: 0, beatValue: 0, beatOffset: 0 },
  });
}

/**
 * Applies a build result to a fixture: channels (programmed values and
 * ranges of channels with the same offset + type survive rebuilds), beams,
 * size from bounds, and the compiled cache.
 */
export function applyKindBuild(fixture: Fixture, result: KindBuildResult): void {
  const previous = new Map(fixture.channels.map(c => [`${c.addressOffset}:${c.type}`, c]));
  fixture.channels = result.channels.map((def): Channel => {
    const old = previous.get(`${def.addressOffset}:${def.type}`);
    return {
      type: def.type,
      addressOffset: def.addressOffset,
      resolution: def.resolution ?? 1,
      fineAddressOffsets: def.fineAddressOffsets,
      role: def.role,
      colorValue: def.colorValue,
      defaultValue: def.defaultValue,
      oflChannelName: def.name,
      beamId: def.beamId,
      rangeMin: old?.rangeMin,
      rangeMax: old?.rangeMax,
      chaserConfig: old?.chaserConfig ?? staticChaser(def.defaultValue),
    };
  });

  // Size: half extents of the bounds in FIXTURE_RADIUS units (min 8 px so thin shapes stay clickable).
  const { bounds } = result;
  fixture.fixtureSize = {
    x: Math.max(bounds.w / 2, 8) / FIXTURE_RADIUS,
    y: Math.max(bounds.h / 2, 8) / FIXTURE_RADIUS,
  };
  const fw = fixture.fixtureSize.x * FIXTURE_RADIUS * 2;
  const fh = fixture.fixtureSize.y * FIXTURE_RADIUS * 2;

  fixture.beams = result.beams.map((b) => {
    // localX/Y keep the normalized convention for generic consumers.
    const beam = new Beam(b.id, b.pos.x / fw, b.pos.y / fh, 0);
    beam.offsetPx = { x: b.pos.x, y: b.pos.y };
    if (b.emitters) beam.emitters = b.emitters.map(e => ({ x: e.x, y: e.y }));
    if (b.emitterRadius !== undefined) beam.emitterRadius = b.emitterRadius;
    return beam;
  });
  if (fixture.beams.length === 0) fixture.beams = [new Beam('beam-0', 0, 0)];

  if (fixture.kind) fixture.kind.compiled = cloneJson(result);
  fixture.invalidatePhotometry();
}

/**
 * Rebuilds a kind fixture from its config (migrating older config versions).
 * Without the kind's extension the compiled cache is applied instead.
 * Returns false when nothing could be built.
 */
export function rebuildKindFixture(fixture: Fixture): boolean {
  const state = fixture.kind;
  if (!state) return false;
  const kind = getKind(state.id);
  if (!kind) {
    if (state.compiled && fixture.channels.length === 0) applyKindBuild(fixture, state.compiled);
    return !!state.compiled;
  }
  if (state.version !== kind.def.version) {
    state.config = kind.def.migrate ? kind.def.migrate(cloneJson(state.config) as Json, state.version) : state.config;
    state.version = kind.def.version;
  }
  try {
    applyKindBuild(fixture, kind.def.build(cloneJson(state.config) as Json, kindContext(fixture.id)));
    return true;
  }
  catch (err) {
    console.error(`[kinds] ${state.id} build failed for fixture ${String(fixture.id)}:`, err);
    return false;
  }
}

/** Creates a fixture of a kind at a normalized position. */
export function createKindFixture(
  def: FixtureKindDefinition<Json>,
  opts: { id: string | number; config?: Json; position?: Vec2; name?: string },
): Fixture {
  const fixture = new Fixture(opts.id, [], 1);
  fixture.name = opts.name ?? def.label;
  fixture.manufacturer = 'Custom';
  fixture.fixtureType = def.label;
  fixture.fixturePosition = { x: opts.position?.x ?? 0.5, y: opts.position?.y ?? 0.5 };
  fixture.kind = { id: def.id, version: def.version, config: cloneJson(opts.config ?? def.defaults()) };
  applyKindBuild(fixture, def.build(cloneJson(fixture.kind.config) as Json, kindContext(fixture.id)));
  return fixture;
}

// ── Coordinates ──────────────────────────────────

/** Fixture origin in world pixels. */
function origin(f: Fixture): Vec2 {
  return { x: f.fixturePosition.x * WORLD_WIDTH, y: f.fixturePosition.y * WORLD_HEIGHT };
}

/** Kind-relative point → world pixels (applies position + rotation). */
export function kindToWorld(f: Fixture, p: Vec2): Vec2 {
  const o = origin(f);
  const a = (f.rotation ?? 0) * (Math.PI / 180);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: o.x + p.x * c - p.y * s, y: o.y + p.x * s + p.y * c };
}

/** World pixels → kind-relative point (inverse of `kindToWorld`). */
export function worldToKind(f: Fixture, p: Vec2): Vec2 {
  const o = origin(f);
  const a = -(f.rotation ?? 0) * (Math.PI / 180);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

/** World-pixel AABB of a kind fixture's bounds (rotated corners). */
export function kindWorldAabb(f: Fixture): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const b = f.kind?.compiled?.bounds;
  if (!b) return null;
  const corners = [
    { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y },
    { x: b.x, y: b.y + b.h }, { x: b.x + b.w, y: b.y + b.h },
  ].map(p => kindToWorld(f, p));
  return {
    minX: Math.min(...corners.map(p => p.x)),
    minY: Math.min(...corners.map(p => p.y)),
    maxX: Math.max(...corners.map(p => p.x)),
    maxY: Math.max(...corners.map(p => p.y)),
  };
}

/**
 * World-pixel position of a beam: kind beams via `offsetPx`; classic beams
 * via the normalized local offset scaled by the fixture size and rotated.
 */
export function beamWorldPx(f: Fixture, beam: Beam): Vec2 {
  if (beam.offsetPx) return kindToWorld(f, beam.offsetPx);
  const o = origin(f);
  const a = (f.rotation ?? 0) * (Math.PI / 180);
  const px = beam.localX * f.fixtureSize.x * FIXTURE_RADIUS * 2;
  const py = beam.localY * f.fixtureSize.y * FIXTURE_RADIUS * 2;
  return { x: o.x + px * Math.cos(a) - py * Math.sin(a), y: o.y + px * Math.sin(a) + py * Math.cos(a) };
}
