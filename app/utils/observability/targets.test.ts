// @vitest-environment node
/**
 * Observe target selectors: the shared `modifiers.add` vocabulary
 * (`fixtureIds`, `groupIds`, `signature`, `channelTypes`) resolves like
 * `ids`, and unknown keys are rejected instead of observing everything.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetOperationState, seedScene, stubOperationGlobals } from '~/utils/operations/test-utils';
import { resolveTargets } from './targets';
import { observe } from './index';

describe('observe targets', () => {
  beforeAll(() => stubOperationGlobals());
  beforeEach(() => resetOperationState());

  /** Three DRGB fixtures, f0 and f1 in group g. */
  function sources() {
    const fixtures = seedScene([{ id: 'f0' }, { id: 'f1' }, { id: 'f2' }]);
    return { fixtures, groups: [{ id: 'g', name: 'G', fixtureIds: ['f0', 'f1'] }] as never[], selection: [] };
  }

  it('accepts fixtureIds as an alias of ids', () => {
    const r = resolveTargets({ fixtureIds: ['f2'] }, sources());
    expect(r.fixtures.map(f => f.id)).toEqual(['f2']);
  });

  it('fixtureIds null means all fixtures; channelTypes narrows', () => {
    const src = sources();
    expect(resolveTargets({ fixtureIds: null }, src).fixtures).toHaveLength(3);
    expect(resolveTargets({ channelTypes: ['DIMMER'] }, src).fixtures).toHaveLength(3);
    expect(resolveTargets({ channelTypes: ['PAN'] }, src).fixtures).toHaveLength(0);
    expect(resolveTargets({ groupIds: ['g'], channelTypes: ['RED'] }, src).fixtures.map(f => f.id)).toEqual(['f0', 'f1']);
  });

  it('rejects unknown target keys with a clear error', async () => {
    sources();
    const report = await observe({ targets: { fixtureId: ['f0'] } as never, mode: 'live' });
    expect(report.findings?.[0]?.code).toBe('invalid-input');
    expect(report.findings?.[0]?.message).toContain('unknown target key "fixtureId"');
    expect(report.findings?.[0]?.message).toContain('fixtureIds');
  });
});
