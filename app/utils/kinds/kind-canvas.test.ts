/**
 * Kind fixtures → canvas payload (plan P5.2): world transform of body,
 * handles and emitters, AABB placement and edit-mode flags.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { defineFixtureKind } from '@pixelmapper/extension-api';
import { registerExtension, resetRegistry } from '~/utils/extensions/registry';
import { createKindFixture, getKind } from './kind-host';
import { hasEditHandles, kindCanvasFields } from './kind-canvas';

const seg = defineFixtureKind<{ len: number }>({
  id: 'segment', version: '1.0.0', label: 'Segment', icon: 'minus', description: 'Test kind: a segment with two LEDs.',
  configSchema: [], defaults: () => ({ len: 100 }),
  build: ({ len }) => ({
    channels: [],
    beams: [{ id: 'b', pos: { x: 0, y: 0 }, emitters: [{ x: -len / 2, y: 0 }, { x: len / 2, y: 0 }], emitterRadius: 3 }],
    body: [
      { type: 'polyline', points: [{ x: -len / 2, y: 0 }, { x: len / 2, y: 0 }], width: 4, style: { stroke: '#ff0000' } },
      { type: 'rect', rect: { x: -5, y: -5, w: 10, h: 10 }, style: {} },
    ],
    handles: [{ id: 'a', pos: { x: -len / 2, y: 0 }, role: 'anchor' }, { id: 'v', pos: { x: len / 2, y: 0 }, role: 'vertex' }],
    bounds: { x: -len / 2, y: -5, w: len, h: 10 },
  }),
  library: { category: 'Other' },
});

beforeEach(() => {
  resetRegistry();
  registerExtension({ id: 'test-seg', version: '1.0.0', apiVersion: '^1.0.0', displayName: 'Seg', description: 'Test kind ext.', contributes: { fixtureKinds: [seg as never] } });
});

describe('kindCanvasFields', () => {
  it('transforms geometry to world pixels with rotation', () => {
    const f = createKindFixture(getKind('segment')!.def, { id: 's', position: { x: 0.5, y: 0.5 } });
    f.rotation = 90;
    const c = kindCanvasFields(f, { editMode: true, focusedHandle: 'v' })!;
    const line = c.body[0] as { points: number[][] };
    expect(line.points[0]![0]).toBeCloseTo(1500);
    expect(line.points[0]![1]).toBeCloseTo(1450);
    // Rects under rotation become polygons.
    expect((c.body[1] as { type: string }).type).toBe('polygon');
    expect(c.handles.map(h => [h.id, Math.round(h.y)])).toEqual([['a', 1450], ['v', 1550]]);
    expect(c.emittersByBeam.get('b')!.emitters.map(e => Math.round(e[1]!))).toEqual([1450, 1550]);
    expect(c.worldX).toBeCloseTo(0.5);
    expect(c.height).toBeCloseTo(50 / 18);
    expect(c.rotation).toBe(0);
    expect(c.focusedHandle).toBe('v');
  });

  it('enters edit mode only with non-anchor handles', () => {
    const f = createKindFixture(getKind('segment')!.def, { id: 's' });
    expect(hasEditHandles(f)).toBe(true);
    f.kind!.compiled!.handles = f.kind!.compiled!.handles.filter(h => h.role === 'anchor');
    expect(hasEditHandles(f)).toBe(false);
  });
});
