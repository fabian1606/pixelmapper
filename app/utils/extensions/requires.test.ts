/**
 * Project dependency bookkeeping (plan P5.5, ADR §5.8 rules) and the
 * SetExtensionData command.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  addRequirements, commandOwner, extensionDataOwners, recomputeRequirements, requirementsOfCommand, versionRange,
  type RequiresSources,
} from './requires';
import { SetExtensionDataCommand, readExtensionData } from '~/components/engine/commands/set-extension-data-command';
import { useEngineStore } from '~/stores/engine-store';

/** Extensions: strips (required kind), pads (kind not required), notes (data only). */
const src: RequiresSources = {
  extensionVersion: id => ({ strips: '1.4.2', pads: '2.0.0', notes: '0.3.0' } as Record<string, string>)[id],
  kindOwner: kindId => ({
    'strip-kind': { extensionId: 'strips', required: true },
    'pad-kind': { extensionId: 'pads', required: false },
  } as Record<string, { extensionId: string; required: boolean }>)[kindId],
};

describe('requires rules', () => {
  it('ranges are ^major.minor', () => {
    expect(versionRange('1.4.2')).toBe('^1.4');
  });

  it('namespaced commands of registered extensions add their owner', () => {
    expect(commandOwner('notes/set', src)).toBe('notes');
    expect(commandOwner('unknown/set', src)).toBeUndefined();
    expect(commandOwner('MoveFixture', src)).toBeUndefined();
    expect(requirementsOfCommand('notes/set', {}, src, () => undefined)).toEqual(['notes']);
  });

  it('kind commands add the kind owner unless requiredWhenUsed is false', () => {
    const kindOf = (id: string | number) => (id === 'f1' ? 'strip-kind' : 'pad-kind');
    expect(requirementsOfCommand('SetFixtureKindConfig', { fixtureId: 'f1' }, src, kindOf)).toEqual(['strips']);
    expect(requirementsOfCommand('SetFixtureKindConfig', { fixtureId: 'f2' }, src, kindOf)).toEqual([]);
    const nodes = [{ _type: 'group', children: [{ _type: 'fixture', kind: { id: 'strip-kind' } }] }, { _type: 'fixture' }];
    expect(requirementsOfCommand('AddFixtures', { nodes }, src, kindOf)).toEqual(['strips']);
  });

  it('recomputes from state and reports removed extensions', () => {
    const current = addRequirements([], ['strips', 'notes'], src);
    expect(current).toEqual([{ id: 'strips', version: '^1.4' }, { id: 'notes', version: '^0.3' }]);

    const keep = recomputeRequirements(current, { fixtureKinds: ['strip-kind', undefined], extensionDataOwners: ['notes'] }, src);
    expect(keep.removed).toEqual([]);

    const drop = recomputeRequirements(current, { fixtureKinds: ['pad-kind'], extensionDataOwners: [] }, src);
    expect(drop.next).toEqual([]);
    expect(drop.removed).toEqual(['strips', 'notes']);
  });

  it('collects data owners, ignoring empty maps', () => {
    expect([...extensionDataOwners([{ a: { k: 1 }, b: {} }, undefined, { c: { x: true } }])]).toEqual(['a', 'c']);
  });
});

describe('SetExtensionData', () => {
  beforeAll(() => {
    // The engine store spawns a worker in the browser; not needed here.
    vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
    vi.stubGlobal('useSupabaseClient', () => ({}));
  });
  beforeEach(() => setActivePinia(createPinia()));

  it('writes, undoes and deletes project data (empty maps disappear)', () => {
    const store = useEngineStore();
    const cmd = new SetExtensionDataCommand({ owner: 'project', extensionId: 'notes', key: 'text', after: 'hello' });
    cmd.execute();
    expect(readExtensionData('project', undefined, 'notes', 'text')).toBe('hello');
    expect(store.projectExtension.extensionData).toEqual({ notes: { text: 'hello' } });
    cmd.undo();
    expect(store.projectExtension.extensionData).toBeUndefined();
  });
});
