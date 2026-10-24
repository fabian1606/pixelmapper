/**
 * Shared add path (plan M4.1) and the persisted fixture source (M4.3):
 * ids, appended or explicit addresses, cascade placement, selection, and
 * `source` surviving snapshots and AddFixtures payloads.
 */
import { describe, expect, it } from 'vitest';
import { Fixture } from './core/fixture';
import type { SceneNode } from './core/group';
import { createAddFixturesCommand, placeNewFixtures, selectionWithAdded } from './add-fixtures';
import { deserializeFixture, serializeFixture } from './serialize';

/** A plain RGB fixture (4 channels). */
const rgb = (id: string, startAddress = 1) => {
  const f = Fixture.createRGBFixture(id);
  f.startAddress = startAddress;
  return f;
};

describe('placeNewFixtures', () => {
  it('appends after the highest used address and cascades from the centre (add dialog behavior)', () => {
    const existing = [rgb('a', 1), rgb('b', 20)];
    const added = [rgb('x'), rgb('y'), rgb('z')];
    placeNewFixtures(added, existing);
    expect(added.map(f => f.startAddress)).toEqual([24, 28, 32]);
    expect(added.map(f => f.fixturePosition)).toEqual([{ x: 0.5, y: 0.5 }, { x: 0.52, y: 0.52 }, { x: 0.54, y: 0.54 }]);
    expect(new Set(added.map(f => f.id)).size).toBe(3);
    expect(added.every(f => /^ofl-\d+$/.test(String(f.id)))).toBe(true);
  });

  it('keeps explicit start addresses and appends the rest after them', () => {
    const added = [rgb('x'), rgb('y'), rgb('z')];
    placeNewFixtures(added, [rgb('a', 1)], { startAddresses: [600, undefined, 10] });
    expect(added.map(f => f.startAddress)).toEqual([600, 604, 10]);
  });

  it('starts the next universe when a fixture would cross a boundary', () => {
    const added = [rgb('x')];
    placeNewFixtures(added, [rgb('a', 507)]); // 507..510 used → 511..514 would cross
    expect(added[0]!.startAddress).toBe(513);
  });
});

describe('createAddFixturesCommand / selectionWithAdded', () => {
  it('adds all fixtures in one command and extends the selection', () => {
    const nodes: SceneNode[] = [rgb('a', 1)];
    const added = [rgb('x'), rgb('y')];
    const cmd = createAddFixturesCommand(nodes, added, nodes as Fixture[]);
    cmd.execute();
    expect(nodes).toHaveLength(3);
    cmd.undo();
    expect(nodes).toHaveLength(1);
    expect([...selectionWithAdded(new Set(['a']), added)]).toEqual(['a', ...added.map(f => f.id)]);
  });
});

describe('fixture source persistence', () => {
  it('round-trips through serializeFixture / deserializeFixture', () => {
    const f = rgb('s1');
    f.source = { key: 'custom/custom-1', modeIndex: 2 };
    const copy = deserializeFixture(JSON.parse(JSON.stringify(serializeFixture(f))));
    expect(copy.source).toEqual({ key: 'custom/custom-1', modeIndex: 2 });
    expect(deserializeFixture(serializeFixture(rgb('s2'))).source).toBeUndefined();
  });
});
