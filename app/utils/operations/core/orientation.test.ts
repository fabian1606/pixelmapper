/**
 * Orientation fields (WP-K): measured head direction for 0/90/180/270°,
 * `fixtures.rotate` alignTo, and the fields in digest / find / get.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useEngineStore } from '~/stores/engine-store';
import { Beam } from '~/utils/engine/core/beam';
import { Fixture } from '~/utils/engine/core/fixture';
import { runQuery } from '~/utils/agents/host-inspect';
import { eventLog } from '~/utils/observability/event-log';
import { applyOperations } from '../apply';
import { createOperationRegistry, registerCoreOperations } from '../index';
import { readApi } from '../read-api';
import { resetOperationState, stubOperationGlobals } from '../test-utils';
import { fixtureOrientation, orientationFromPoints, rotationToAlign, runsLabel } from './orientation';

/** A 4-pixel RGB bar whose heads run along its local +x axis. */
export function makeBar(id: string, x: number, y: number, rotation = 0, pixels = 4): Fixture {
  const f = new Fixture(id, [], 1);
  f.name = id;
  f.fixturePosition = { x, y };
  f.fixtureSize = { x: pixels, y: 1 };
  f.rotation = rotation;
  f.beams = Array.from({ length: pixels }, (_, i) => new Beam(`b${i}`, (i + 0.5) / pixels - 0.5, 0));
  f.channels = f.beams.flatMap((b, i) => (['RED', 'GREEN', 'BLUE'] as const).map((type, c) => ({
    type, addressOffset: i * 3 + c, role: 'COLOR' as const, colorValue: '#ffffff', defaultValue: 0, beamId: b.id,
  }))) as Fixture['channels'];
  return f;
}

beforeAll(stubOperationGlobals);
beforeEach(resetOperationState);

describe('runsLabel', () => {
  it('names the 8 compass directions (y down)', () => {
    expect(runsLabel(1, 0)).toBe('left→right');
    expect(runsLabel(0, 1)).toBe('top→bottom');
    expect(runsLabel(-1, 0)).toBe('right→left');
    expect(runsLabel(0, -1)).toBe('bottom→top');
    expect(runsLabel(1, 1)).toBe('top-left→bottom-right');
    expect(runsLabel(-1, -1)).toBe('bottom-right→top-left');
  });

  it('has no direction for coincident heads', () => {
    expect(orientationFromPoints([{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }])).toBeNull();
  });
});

describe('fixtureOrientation', () => {
  it.each([
    [0, 'left→right', { dx: 1, dy: 0 }],
    [90, 'top→bottom', { dx: 0, dy: 1 }],
    [180, 'right→left', { dx: -1, dy: 0 }],
    [270, 'bottom→top', { dx: 0, dy: -1 }],
  ])('rotation %i° → heads run %s', (rotation, runs, axis) => {
    const o = fixtureOrientation(makeBar('bar', 0.5, 0.5, rotation))!;
    expect(o.runs).toBe(runs);
    expect(o.axis).toEqual(axis);
    // Head 0 sits on the opposite side of the center from the last head.
    expect(Math.sign(o.firstHead.x - 0.5) + 0).toBe(-Math.sign(axis.dx) + 0);
    expect(Math.sign(o.firstHead.y - 0.5) + 0).toBe(-Math.sign(axis.dy) + 0);
  });

  it('is absent for single-head fixtures', () => {
    expect(fixtureOrientation(Fixture.createRGBFixture('rgb'))).toBeNull();
  });
});

describe('rotationToAlign', () => {
  it('aligns to x / y in both directions', () => {
    const bar = makeBar('bar', 0.5, 0.5, 37);
    expect(rotationToAlign(bar, 'x')).toBe(0);
    expect(rotationToAlign(bar, 'y')).toBe(90);
    expect(rotationToAlign(bar, 'x', true)).toBe(180);
    expect(rotationToAlign(bar, 'y', true)).toBe(270);
    expect(rotationToAlign(bar, { dx: 1, dy: 1 })).toBe(45);
  });

  it('accounts for fixtures whose pixels run along local y', () => {
    const bar = makeBar('vbar', 0.5, 0.5, 0);
    for (const b of bar.beams) [b.localX, b.localY] = [0, b.localX];
    expect(fixtureOrientation(bar)!.runs).toBe('top→bottom');
    expect(rotationToAlign(bar, 'x')).toBe(270);
  });
});

describe('operations', () => {
  const registry = registerCoreOperations(createOperationRegistry());

  /** Seeds two bars and a single-head fixture. */
  function seed() {
    const store = useEngineStore();
    store.sceneNodes = [makeBar('front', 0.5, 0.2), makeBar('side', 0.1, 0.5, 90), Fixture.createRGBFixture('spot')];
  }

  it('reports rotation + orientation in digest, find and get', async () => {
    seed();
    const deps = { registry, read: readApi, events: eventLog };
    const [digest, find, get] = await Promise.all([
      runQuery(deps, 'project.digest', {}),
      runQuery(deps, 'fixtures.find', {}),
      runQuery(deps, 'fixtures.get', { ids: ['side'] }),
    ]) as [
      { fixtures: Array<{ id: string; rotation: number; orientation?: { runs: string } }> },
      { fixtures: Array<{ id: string; orientation?: { runs: string } }> },
      { fixtures: Array<{ orientation: { runs: string; firstHead: { y: number }; lastHead: { y: number } } }> },
    ];
    expect(digest.fixtures.find(f => f.id === 'side')).toMatchObject({ rotation: 90, orientation: { runs: 'top→bottom' } });
    expect(digest.fixtures.find(f => f.id === 'spot')!.orientation).toBeUndefined();
    expect(find.fixtures.find(f => f.id === 'front')!.orientation!.runs).toBe('left→right');
    expect(get.fixtures[0]!.orientation.firstHead.y).toBeLessThan(get.fixtures[0]!.orientation.lastHead.y);
  });

  it('fixtures.rotate alignTo turns bars along an edge', async () => {
    seed();
    const res = await applyOperations({ label: 'Align', ops: [{ op: 'fixtures.rotate', input: { rotations: [
      { fixtureId: 'front', alignTo: 'y', direction: 'reverse' },
      { fixtureId: 'side', alignTo: 'x' },
    ] } }] }, { actor: 'user', registry, read: readApi });
    expect(res.committed).toBe(true);
    expect(readApi.fixture('front')!.rotation).toBe(270);
    expect(readApi.fixture('side')!.rotation).toBe(0);
    expect(res.findings.map(f => f.message)).toEqual(expect.arrayContaining([
      'fixture front: rotation 270°, heads run bottom→top',
      'fixture side: rotation 0°, heads run left→right',
    ]));
  });

  it('fixtures.rotate rejects alignTo on single-head fixtures and ambiguous entries', async () => {
    seed();
    const deps = { actor: 'user' as const, registry, read: readApi };
    const single = await applyOperations({ ops: [{ op: 'fixtures.rotate', input: { rotations: [{ fixtureId: 'spot', alignTo: 'x' }] } }] }, deps);
    expect(single.committed).toBe(false);
    const both = await applyOperations({ ops: [{ op: 'fixtures.rotate', input: { rotations: [{ fixtureId: 'front', rotation: 10, alignTo: 'x' }] } }] }, deps);
    expect(both.committed).toBe(false);
  });
});
