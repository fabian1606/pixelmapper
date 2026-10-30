/**
 * fixtures.arrange: layouts (grid, line, circle, distribute, align), order,
 * orient / rotation, verify, undo; plus the pure layout geometry.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useHistory } from '~/components/engine/composables/use-history';
import { useEngineStore } from '~/stores/engine-store';
import { Beam } from '~/utils/engine/core/beam';
import type { Fixture } from '~/utils/engine/core/fixture';
import { applyOperations } from '../apply';
import { readApi } from '../read-api';
import { createOperationRegistry } from '../registry';
import { resetOperationState, seedScene, stateFingerprint, stubOperationGlobals } from '../test-utils';
import { gridShape, layoutTargets } from './arrange-layout';
import { localHeadAxis } from './fixtures-arrange';
import { registerCoreOperations } from './index';

const IDS = Array.from({ length: 10 }, (_, i) => `b${i}`);

beforeAll(stubOperationGlobals);
beforeEach(() => {
  resetOperationState();
  // Scattered bars (reverse x so "position" order differs from id order) plus a group.
  seedScene(IDS.map((id, i) => ({ id, x: 0.9 - i * 0.08, y: 0.1 + (i % 3) * 0.2 })), [{ id: 'g-all', name: 'All', fixtureIds: IDS.slice(0, 4) }]);
});

/** Runs one arrange op. */
function arrange(input: unknown, dryRun = false) {
  return applyOperations({ label: 'Arrange', dryRun, ops: [{ op: 'fixtures.arrange', input }] }, { registry: registerCoreOperations(createOperationRegistry()), actor: 'agent:test' });
}

/** Current position of a fixture. */
const pos = (id: string) => readApi.fixture(id)!;

describe('layout geometry', () => {
  it('computes grid shapes', () => {
    expect(gridShape(10, 2)).toEqual({ rows: 2, cols: 5 });
    expect(gridShape(11, 2)).toEqual({ rows: 2, cols: 6 });
    expect(gridShape(10, undefined, 4)).toEqual({ rows: 3, cols: 4 });
    expect(gridShape(9)).toEqual({ rows: 3, cols: 3 });
  });

  it('centers a shorter last grid row with the same spacing', () => {
    const items = Array.from({ length: 11 }, (_, i) => ({ id: i, x: 0, y: 0 }));
    const t = layoutTargets(items, { type: 'grid', rows: 2, bounds: { minX: 0.1, minY: 0.1, maxX: 0.6, maxY: 0.2 } });
    expect(t.slice(0, 6).map(p => p.x)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    expect(t.slice(6).map(p => p.x)).toEqual([0.15, 0.25, 0.35, 0.45, 0.55]);
    expect(new Set(t.slice(6).map(p => p.y))).toEqual(new Set([0.2]));
  });

  it('spaces a full circle without a duplicate end point, tangent clockwise', () => {
    const items = Array.from({ length: 4 }, (_, i) => ({ id: i, x: 0, y: 0 }));
    const t = layoutTargets(items, { type: 'circle', center: { x: 0.5, y: 0.5 }, radius: 0.2 });
    expect(t.map(p => [p.x, p.y])).toEqual([[0.7, 0.5], [0.5, 0.7], [0.3, 0.5], [0.5, 0.3]]);
    expect(t[0]!.along).toBe(90);
  });
});

describe('fixtures.arrange', () => {
  it('arranges 10 fixtures in two rows of five in one op; undo restores', async () => {
    const before = stateFingerprint();
    const result = await arrange({ fixtureIds: IDS, layout: { type: 'grid', rows: 2, bounds: { minX: 0.2, minY: 0.8, maxX: 0.6, maxY: 0.9 } } });
    expect(result.findings.filter(f => f.level === 'error')).toEqual([]);
    expect(result.committed).toBe(true);
    const placed = IDS.map(pos);
    expect(placed.filter(p => p.y === 0.8)).toHaveLength(5);
    expect(placed.filter(p => p.y === 0.9)).toHaveLength(5);
    expect(new Set(placed.map(p => p.x))).toEqual(new Set([0.2, 0.3, 0.4, 0.5, 0.6]));
    useHistory().undo();
    expect(stateFingerprint()).toBe(before);
  });

  it('fills in current spatial order by default and in list order with order "given"', async () => {
    await arrange({ fixtureIds: IDS.slice(0, 3), layout: { type: 'line', from: { x: 0.1, y: 0.5 }, to: { x: 0.3, y: 0.5 } } });
    // b0 was rightmost, so it stays rightmost.
    expect([pos('b2').x, pos('b1').x, pos('b0').x]).toEqual([0.1, 0.2, 0.3]);
    await arrange({ fixtureIds: IDS.slice(0, 3), order: 'given', layout: { type: 'line', from: { x: 0.1, y: 0.5 }, to: { x: 0.3, y: 0.5 } } });
    expect([pos('b0').x, pos('b1').x, pos('b2').x]).toEqual([0.1, 0.2, 0.3]);
  });

  it('resolves groupIds', async () => {
    const result = await arrange({ groupIds: ['g-all'], layout: { type: 'align', edge: 'top', value: 0.05 } });
    expect(result.committed).toBe(true);
    expect(IDS.slice(0, 4).map(id => pos(id).y)).toEqual([0.05, 0.05, 0.05, 0.05]);
    expect(pos('b5').y).not.toBe(0.05);
  });

  it('distributes along x within the current extent, keeping y', async () => {
    const ys = IDS.slice(0, 3).map(id => pos(id).y);
    await arrange({ fixtureIds: IDS.slice(0, 3), layout: { type: 'distribute', axis: 'x' } });
    const xs = IDS.slice(0, 3).map(id => pos(id).x).sort();
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!);
    expect(IDS.slice(0, 3).map(id => pos(id).y)).toEqual(ys);
  });

  it('rotates along a circle using the head axis', async () => {
    // b0 gets heads along local +y (axis 90°): "along" must subtract it.
    const f = (useEngineStore().flatFixtures as Fixture[]).find(x => x.id === 'b0')!;
    f.beams = [new Beam('h0', 0, -0.4), new Beam('h1', 0, 0.4)];
    expect(localHeadAxis(f)).toBe(90);
    const result = await arrange({ fixtureIds: IDS.slice(0, 4), order: 'given', layout: { type: 'circle', center: { x: 0.5, y: 0.5 }, radius: 0.3 }, orient: 'along' });
    expect(result.committed).toBe(true);
    // b0 at 0° → tangent 90°, minus its 90° head axis = 0°; b1 at 90° → tangent 180°.
    expect(pos('b0').rotation).toBe(0);
    expect(pos('b1').rotation).toBe(180);
    useHistory().undo();
    expect(pos('b1').rotation).toBe(0);
  });

  it('orients across and sets an absolute rotation', async () => {
    await arrange({ fixtureIds: IDS.slice(0, 2), layout: { type: 'line', from: { x: 0.1, y: 0.1 }, to: { x: 0.1, y: 0.9 } }, orient: 'across' });
    expect(pos('b0').rotation).toBe(180);
    await arrange({ fixtureIds: IDS.slice(0, 2), layout: { type: 'align', edge: 'left' }, rotation: -90 });
    expect(pos('b0').rotation).toBe(270);
  });

  it('fails without changes when the shape leaves the 0–1 world', async () => {
    const before = stateFingerprint();
    const result = await arrange({ fixtureIds: IDS, layout: { type: 'circle', center: { x: 0.9, y: 0.5 }, radius: 0.3 } });
    expect(result.committed).toBe(false);
    expect(result.findings[0]!.message).toContain('outside the 0–1 world');
    expect(stateFingerprint()).toBe(before);
  });

  it('reports stacked fixtures as an error on a shape and as a warning on align', async () => {
    const line = await arrange({ fixtureIds: IDS.slice(0, 2), layout: { type: 'line', from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.5 } } });
    expect(line.committed).toBe(false);
    expect(line.findings.some(f => f.code === 'arrange-overlap' && f.level === 'error')).toBe(true);
    // b0 and b3 share y = 0.1, so aligning both left stacks them.
    const align = await arrange({ fixtureIds: ['b0', 'b3'], layout: { type: 'align', edge: 'left' } });
    expect(align.committed).toBe(true);
    expect(align.findings.some(f => f.code === 'arrange-overlap' && f.level === 'warning')).toBe(true);
  });

  it('rejects inputs without targets, too small grids and rotation + orient', async () => {
    expect((await arrange({ layout: { type: 'align', edge: 'top' } })).findings[0]!.message).toContain('pass fixtureIds and/or groupIds');
    expect((await arrange({ fixtureIds: IDS, layout: { type: 'grid', rows: 2, cols: 2 } })).findings[0]!.message).toContain('room for 4 fixtures');
    expect((await arrange({ fixtureIds: IDS, layout: { type: 'grid' }, orient: 'along', rotation: 10 })).committed).toBe(false);
  });
});
