// @vitest-environment node
/**
 * Schema 2 → 3 migration (plan M3.8): every mapping row, phase equality for
 * linear/radial, snapshots and replayed payloads.
 */
import { describe, expect, it } from 'vitest';
import { sampleDistribution } from '~/utils/engine/distribution/sample';
import { migrateSnapshot, SCHEMA_VERSION, type ProjectSnapshot } from '~/utils/engine/serialize';
import { distributionFromLegacy, migrateLegacyChanges, migrateModifier, migrateModifiersDeep } from './v3-distribution';

/** The v2 spatial offset (copied from the former preview-pool / phase.rs). */
function legacyOffset(m: { direction: string; originX: number; originY: number; angle: number; fanning: number; reverse: boolean }, x: number, y: number): number {
  if (m.fanning === 0 || m.direction === 'NONE') return 0;
  const dx = x - m.originX;
  const dy = y - m.originY;
  let d = 0;
  if (m.direction === 'LINEAR') d = dx * Math.cos(m.angle) + dy * Math.sin(m.angle);
  if (m.direction === 'RADIAL') d = Math.hypot(dx, dy);
  const offset = d / Math.max(m.fanning, 0.0001);
  return m.reverse ? -offset : offset;
}

/** A v2 instance. */
const v2 = (over: Record<string, unknown> = {}) => ({
  id: 'm1', plugin: 'sha256:abc', signature: 'scalar', targetChannels: ['DIMMER'], blendMode: 'add', strength: 1,
  speed: { mode: 'beat', timeMs: 2000, beatValue: 1, beatOffset: 0 },
  direction: 'LINEAR', originX: 0.3, originY: 0.4, angle: 0.5, fanning: 0.25, reverse: false, params: {},
  ...over,
});

describe('distributionFromLegacy', () => {
  it('NONE and fanning 0 → none', () => {
    expect(distributionFromLegacy({ direction: 'NONE', fanning: 0.3 }).mode).toBe('none');
    expect(distributionFromLegacy({ direction: 'LINEAR', fanning: 0 }).mode).toBe('none');
  });

  it('LINEAR / RADIAL → handle of length fanning along the angle', () => {
    const d = distributionFromLegacy({ direction: 'LINEAR', originX: 0.3, originY: 0.4, angle: Math.PI / 2, fanning: 0.2 });
    expect(d.mode).toBe('linear');
    expect(d.origin).toEqual({ x: 0.3, y: 0.4 });
    expect(d.end.x).toBeCloseTo(0.3);
    expect(d.end.y).toBeCloseTo(0.6);
    expect(distributionFromLegacy({ direction: 'RADIAL', fanning: 0.2 }).mode).toBe('radial');
  });

  it('ANGULAR → conical, SYMMETRICAL → mirrored order line, reverse kept', () => {
    const c = distributionFromLegacy({ direction: 'ANGULAR', originX: 0.5, originY: 0.5, angle: 0, fanning: 0.7, reverse: true });
    expect(c.mode).toBe('conical');
    expect(c.end.x).toBeCloseTo(0.6);
    expect(c.reverse).toBe(true);
    const s = distributionFromLegacy({ direction: 'SYMMETRICAL', originX: 0.5, originY: 0.5, angle: 0, fanning: 0.2 });
    expect(s.mode).toBe('order');
    expect(s.order.mirror).toBe(true);
    expect(s.order.line?.a).toEqual({ x: 0.5, y: 0.5 });
    expect(s.order.line?.b.x).toBeCloseTo(0.7);
  });

  it.each(['LINEAR', 'RADIAL'])('%s renders identically (phase offset on a grid)', (direction) => {
    for (const reverse of [false, true]) {
      const old = { direction, originX: 0.3, originY: 0.4, angle: 0.7, fanning: 0.25, reverse };
      const d = distributionFromLegacy(old);
      for (let i = 0; i < 64; i++) {
        const x = (i % 8) / 7;
        const y = Math.floor(i / 8) / 7;
        const spatial = sampleDistribution(d, 0, { x, y, fixtureRank: -1, head: 0, headCount: 1 }).spatial;
        // phase = t − offset (v2) vs t − spatial (v3); reverse maps s → 1 − s (one full cycle apart).
        const v3Offset = reverse ? spatial - 1 : spatial;
        expect(v3Offset).toBeCloseTo(legacyOffset(old, x, y), 5);
      }
    }
  });
});

describe('deep migration', () => {
  it('migrates instances and drops the legacy fields; idempotent', () => {
    const m = migrateModifier(v2());
    expect(m).not.toHaveProperty('fanning');
    expect(m).not.toHaveProperty('direction');
    expect((m as unknown as { distribution: { mode: string } }).distribution.mode).toBe('linear');
    expect(migrateModifier(m)).toBe(m);
  });

  it('finds instances anywhere (presets, payloads) and keeps other objects', () => {
    const payload = { before: [v2()], after: [v2({ id: 'm2', direction: 'RADIAL' })], note: { direction: 'LINEAR' } };
    const out = migrateModifiersDeep(payload);
    expect((out.after[0] as unknown as { distribution: { mode: string } }).distribution.mode).toBe('radial');
    expect(out.note).toEqual({ direction: 'LINEAR' });
    const clean = { a: [1, 2], b: { c: 'x' } };
    expect(migrateModifiersDeep(clean)).toBe(clean);
  });

  it('migrates v2 snapshots to the current schema', () => {
    const snap = {
      schemaVersion: 2, sceneNodes: [], globalBases: {}, modifiers: [v2()],
      savedPresets: [{ id: 'p', categories: [{ modifiers: [v2({ direction: 'NONE' })] }] }],
      pinnedModifiers: [{ id: 'pin', name: 'x', snapshot: v2() }],
    } as unknown as ProjectSnapshot;
    const out = migrateSnapshot(snap);
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    expect(JSON.stringify(out)).not.toContain('fanning');
    expect(() => migrateSnapshot({ ...snap, schemaVersion: 1 })).toThrow();
  });

  it('converts persisted scrub changes against the current distribution', () => {
    const current = distributionFromLegacy({ direction: 'LINEAR', originX: 0.2, originY: 0.5, angle: 0, fanning: 0.3 });
    const out = migrateLegacyChanges(current, { originX: 0.6, originY: 0.5 }) as { distribution: { origin: { x: number }; end: { x: number }; mode: string } };
    expect(out.distribution.mode).toBe('linear');
    expect(out.distribution.origin.x).toBeCloseTo(0.6);
    expect(out.distribution.end.x).toBeCloseTo(0.9);
    expect(migrateLegacyChanges(current, { strength: 0.5 })).toEqual({ strength: 0.5 });
  });
});
