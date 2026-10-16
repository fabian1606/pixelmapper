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
