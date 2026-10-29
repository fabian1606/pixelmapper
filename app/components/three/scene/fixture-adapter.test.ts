/**
 * 3D scene model for kind fixtures (plan P5.3): emitters become pixels,
 * body polylines become tubes, flat primitives become shapes, without any
 * kind-specific branches.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { defineFixtureKind } from '@pixelmapper/extension-api';
import { registerExtension, resetRegistry } from '~/utils/extensions/registry';
import { createKindFixture, getKind } from '~/utils/kinds/kind-host';
import { buildSceneModel } from './fixture-adapter';

const demo = defineFixtureKind<Record<string, never>>({
  id: 'demo-body', version: '1.0.0', label: 'Demo', icon: 'circle', description: 'Test kind with every primitive.',
  configSchema: [], defaults: () => ({}),
  build: () => ({
    channels: [{ type: 'RED', role: 'COLOR', addressOffset: 0, colorValue: '#FF0000', defaultValue: 0, beamId: 'b' }],
    beams: [{ id: 'b', pos: { x: 0, y: 0 }, emitters: [{ x: -250, y: 0 }, { x: 250, y: 0 }], emitterRadius: 5 }],
    body: [
      { type: 'polyline', points: [{ x: -250, y: 0 }, { x: 250, y: 0 }], width: 10, style: {} },
      { type: 'circle', center: { x: 0, y: 0 }, radius: 50, style: {} },
      { type: 'rect', rect: { x: -10, y: -10, w: 20, h: 20 }, style: {} },
    ],
    handles: [],
    bounds: { x: -250, y: -50, w: 500, h: 100 },
  }),
  library: { category: 'Other' },
});

beforeEach(() => {
  resetRegistry();
  registerExtension({ id: 'test-demo', version: '1.0.0', apiVersion: '^1.0.0', displayName: 'Demo', description: 'Test kind ext.', contributes: { fixtureKinds: [demo as never] } });
});

describe('buildSceneModel (kind fixtures)', () => {
  it('maps emitters, polylines and flat shapes to meters', () => {
    const f = createKindFixture(getKind('demo-body')!.def, { id: 'k', position: { x: 0.5, y: 0.5 } });
    const model = buildSceneModel([f]);
    // Two emitters, 1 m apart (500 px at 250 px/m), centered on the stage.
    expect(model.pixels.count).toBe(2);
    expect(model.pixels.positions[0]).toBeCloseTo(-1);
    expect(model.pixels.positions[3]).toBeCloseTo(1);
    expect(model.pixels.sizes[0]).toBeCloseTo(10 / 250);
    expect(model.polylines).toHaveLength(1);
    expect(model.polylines[0]!.radius).toBeCloseTo(5 / 250);
    expect(model.shapes.map(s => s.outline.length)).toEqual([32, 4]);
    expect(model.bodies[0]!.compact).toBe(true);
  });

  it('applies the 2D rotation (yaw) like the canvas', () => {
    const f = createKindFixture(getKind('demo-body')!.def, { id: 'k', position: { x: 0.5, y: 0.5 } });
    f.rotation = 90;
    const p = buildSceneModel([f]).pixels.positions;
    expect(p[0]).toBeCloseTo(0);
    expect(p[2]).toBeCloseTo(-1);
  });
});

describe('buildSceneModel (multi-head OFL fixtures)', () => {
  it('gives a lens-bearing LED bar one cone per head at the head positions', async () => {
    const { readFileSync } = await import('node:fs');
    const { createFixtureFromOfl } = await import('~/utils/ofl/fixture-factory');
    // Stairville LED Bar 240/8: 8 pixels, lens 30°, 24-channel per-pixel mode.
    const ofl = JSON.parse(readFileSync('ofl-data/fixtures/stairville/led-bar-240-8.json', 'utf8'));
    const mode = ofl.modes.findIndex((m: { name: string }) => m.name === '24-channel');
    const f = createFixtureFromOfl(ofl, mode);
    const model = buildSceneModel([f]);

    expect(model.beams).toHaveLength(8);
    expect(model.beams.every(b => !b.showHead)).toBe(true);
    // Cones sit on the pixels, not stacked at the fixture center.
    const coneX = model.beams.map(b => b.position.x);
    const pixelX = Array.from(model.pixels.positions).filter((_, i) => i % 3 === 0);
    coneX.forEach((x, i) => expect(x).toBeCloseTo(pixelX[i]!));
    expect(Math.max(...coneX) - Math.min(...coneX)).toBeGreaterThan(0.8);

    // Emitting face: one segment per head on top of the body, spanning the bar.
    expect(model.segments).toHaveLength(8);
    model.segments.forEach((sgm, i) => {
      expect(sgm.position.x).toBeCloseTo(pixelX[i]!);
      expect(sgm.position.y).toBeGreaterThan(model.bodies[0]!.position.y);
    });
    const totalWidth = model.segments.reduce((sum, sgm) => sum + sgm.width, 0);
    expect(totalWidth).toBeGreaterThan(0.9);
  });
});

describe('buildSceneModel (moving heads)', () => {
  /** OFL moving head through factory + project save/load (definition and capabilities dropped). */
  async function loadSpica() {
    const { readFileSync } = await import('node:fs');
    const { createFixtureFromOfl } = await import('~/utils/ofl/fixture-factory');
    const { serializeFixture, deserializeFixture } = await import('~/utils/engine/serialize');
    // 5star Systems Spica 250M: pan 530°, tilt 280°, 427×459×373 mm, 16-bit.
    const ofl = JSON.parse(readFileSync('ofl-data/fixtures/5star-systems/spica-250m.json', 'utf8'));
    const created = createFixtureFromOfl(ofl, 0);
    return { created, reloaded: deserializeFixture(JSON.parse(JSON.stringify(serializeFixture(created)))) };
  }

  it('keeps the OFL motion range and housing size across a project reload', async () => {
    const { created, reloaded } = await loadSpica();
    for (const f of [created, reloaded]) {
      const beam = buildSceneModel([f]).beams[0]!;
      expect(beam.panRange).toEqual([0, 530]);
      expect(beam.tiltRange).toEqual([0, 280]);
      expect(beam.panFineIdx).toBeGreaterThanOrEqual(0);
      expect(beam.movingHead?.height).toBeCloseTo(0.459);
      expect(beam.movingHead?.width).toBeCloseTo(0.427);
    }
  });

  it('builds a model whose head clears the yoke over the full tilt travel', async () => {
    const { created } = await loadSpica();
    const model = buildSceneModel([created]);
    const d = model.beams[0]!.movingHead!;
    // Pointing straight down, the head's back must stay above the crossbar.
    expect(d.tiltAxisY - d.headLength / 2).toBeGreaterThanOrEqual(d.crossbarTop);
    // Pointing up, the lens stays within the housing height.
    expect(d.tiltAxisY + d.headLength / 2).toBeLessThanOrEqual(d.height + 1e-9);
    // Head fits between the arms.
    expect(d.headRadius).toBeLessThan(d.armX - d.armThickness / 2);
    // The base box is the selection body, sitting on the mounting plane.
    const body = model.bodies[0]!;
    expect(body.localOffset?.y).toBeCloseTo(d.baseHeight / 2);
    // The lens shows the color — no static pixel dot at the origin.
    expect(model.pixels.count).toBe(0);
  });
});
