/**
 * Extension API 1.3 — fixture patching (plan M4.1–M4.8), tested through the
 * host: `commands.addFixtures` / `setStartAddress` / `setFixtureMode` /
 * `batch`, `findFreeAddressSpan`, `listFixtures`, `onBeforeFixtureChange`,
 * `onFixturePatchChange`, `findFixtureDefinitionByRdm` and `FixtureView.source`.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  findFixtureDefinitionByRdm,
  findFreeAddressSpan,
  getFixture,
  listFixtures,
  onBeforeFixtureChange,
  onFixturePatchChange,
  saveCustomFixtureDefinition,
  type Command,
  type CoreCommandFactory,
  type FixturePatchChange,
  type SerializableCommand,
} from '@pixelmapper/extension-api';
import { useEngineStore } from '~/stores/engine-store';
import { useHistory } from '~/components/engine/composables/use-history';
import { commandFromPayload } from '~/components/engine/commands/serializable-command';
import { Fixture } from '~/utils/engine/core/fixture';
import type { SceneNode } from '~/utils/engine/core/group';
import type { OflFixture } from '~/utils/ofl/types';
import { saveCustomFixture, customFixtureKey, getCustomFixtures } from '~/utils/fixture-definitions/custom-fixtures';
import { useFreshCustomFixtureLibrary } from '~/utils/fixture-definitions/custom-fixtures.test-support';
import { setDefinitionFetcher } from '~/utils/fixture-definitions/resolve-definition';
import { setRdmLookupFetcher } from '~/utils/fixture-definitions/rdm-lookup';
import xbar500 from '~/utils/fixture-definitions/__fixtures__/xbar500-custom.json';
import { answerConfirm, currentConfirm } from '~/composables/use-confirm-dialog';
import { createCoreCommandFactory } from './core-command-factory';
import { installSharedGlobals } from './shared-globals';
import { resetRegistry } from './registry';
import { clearFixtureChangeGuards, requestFixtureChanges } from './fixture-change-guard';
import { rebaseFixturePatchObservation, runAsExtension } from './fixture-patch-observer';
import { patchStateAt, patchStateOf } from './fixture-patch-state';

/** The XBAR500 tube definition with an RDM manufacturer ID (0x7FF0). */
const XBAR: OflFixture = { ...(xbar500 as unknown as OflFixture), pixelmapper: { rdmManufacturerId: 0x7ff0 } };

/** A tiny OFL definition served by the stubbed `/api/fixtures` routes. */
const OFL_RGB: OflFixture = {
  $schema: 'x',
  name: 'RGB Par',
  categories: ['Color Changer'],
  meta: { authors: ['test'], createDate: '2026-01-01', lastModifyDate: '2026-01-01' },
  availableChannels: {
    Red: { capability: { type: 'ColorIntensity', color: 'Red' } },
    Green: { capability: { type: 'ColorIntensity', color: 'Green' } },
    Blue: { capability: { type: 'ColorIntensity', color: 'Blue' } },
  },
  modes: [{ name: '3ch', channels: ['Red', 'Green', 'Blue'] }],
} as unknown as OflFixture;

let commands: CoreCommandFactory;
let xbarKey: string;
const history = useHistory();

/** Runs a command like `ctx.run` of extension `test-ext`. */
function run(command: Command): void {
  runAsExtension('test-ext', () => history.execute(command));
}

/** Waits for microtask-delivered observations. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/** The store's live root nodes. */
const scene = () => useEngineStore().sceneNodes as SceneNode[];

beforeAll(() => {
  // The engine store spawns a worker in the browser; not needed here.
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
  vi.stubGlobal('useSupabaseClient', () => ({}));
});

beforeEach(async () => {
  setActivePinia(createPinia());
  resetRegistry();
  installSharedGlobals();
  localStorage.clear();
  await useFreshCustomFixtureLibrary();
  xbarKey = customFixtureKey((await saveCustomFixture(XBAR))!);
  commands = createCoreCommandFactory('test-ext');
  setDefinitionFetcher(async (url) => {
    if (url === '/api/fixtures/acme/rgb-par') return OFL_RGB;
    if (url.startsWith('/api/fixtures?mode=manufacturers')) return [{ key: 'acme', name: 'ACME Lighting', fixtureCount: 1 }];
    throw new Error(`404 ${url}`);
  });
  setRdmLookupFetcher(async () => ({ keys: [] }));
});

afterEach(() => {
  clearFixtureChangeGuards();
  setDefinitionFetcher(null);
  setRdmLookupFetcher(null);
});

describe('commands.addFixtures (M4.1)', () => {
  it('adds several fixtures as one undo step and returns their ids', async () => {
    const add = await commands.addFixtures([
      { definition: xbarKey, modeIndex: 0, startAddress: 1 },
      { definition: xbarKey, modeIndex: 1, startAddress: 100, name: 'Tube B' },
      { definition: xbarKey, modeIndex: 3 },
    ]);
    expect(add.fixtureIds).toHaveLength(3);
    expect(add.commandType).toBe('AddFixtures');

    run(add);
    const store = useEngineStore();
    const fixtures = add.fixtureIds.map(id => store.flatFixtures.find(f => f.id === id)!);
    expect(fixtures.map(f => f.channels.length)).toEqual([12, 3, 13]);
    expect(fixtures.map(f => f.startAddress)).toEqual([1, 100, 103]); // the third is appended after the others
    expect(fixtures[1]!.name).toBe('Tube B');
    expect(fixtures.map(f => f.source)).toEqual([
      { key: xbarKey, modeIndex: 0 }, { key: xbarKey, modeIndex: 1 }, { key: xbarKey, modeIndex: 3 },
    ]);
    // Same placement as the add dialog: centre + diagonal cascade; selected.
    expect(fixtures.map(f => f.fixturePosition)).toEqual([{ x: 0.5, y: 0.5 }, { x: 0.52, y: 0.52 }, { x: 0.54, y: 0.54 }]);
    expect([...store.selectedIds]).toEqual(add.fixtureIds);
    expect(getFixture(add.fixtureIds[0]!)?.source).toEqual({ key: xbarKey, modeIndex: 0 });

    history.undo();
    expect(scene()).toHaveLength(0);
    history.redo();
    expect(scene()).toHaveLength(3);
  });

  it('loads OFL definitions (oflKey, manufacturer name) and adds kinds', async () => {
    const add = await commands.addFixtures([{ definition: 'acme/rgb-par' }]);
    run(add);
    const f = useEngineStore().flatFixtures.find(x => x.id === add.fixtureIds[0])!;
    expect(f.oflKey).toBe('acme/rgb-par');
    expect(f.manufacturer).toBe('ACME Lighting');
    expect(f.source).toEqual({ key: 'acme/rgb-par', modeIndex: 0 });
  });

  it('rejects unknown definitions, modes, ambiguous items and bad addresses', async () => {
    await expect(commands.addFixtures([])).rejects.toThrow('at least one item');
    await expect(commands.addFixtures([{ definition: 'custom/missing' }])).rejects.toThrow('not found');
    await expect(commands.addFixtures([{ definition: 'acme/unknown' }])).rejects.toThrow('not found');
    await expect(commands.addFixtures([{ definition: xbarKey, modeIndex: 9 }])).rejects.toThrow('no mode 9');
    await expect(commands.addFixtures([{ definition: xbarKey, kind: { id: 'k' } }])).rejects.toThrow('exactly one');
    await expect(commands.addFixtures([{ kind: { id: 'not-installed' } }])).rejects.toThrow('not installed');
    await expect(commands.addFixtures([{ definition: xbarKey, startAddress: 0 }])).rejects.toThrow('startAddress');
  });
});

describe('commands.batch (M4.4)', () => {
  it('adds fixtures and writes their extension data as one undo step', async () => {
    const add = await commands.addFixtures([{ definition: xbarKey, startAddress: 1 }, { definition: xbarKey, startAddress: 13 }]);
    const batch = commands.batch([
      add,
      ...add.fixtureIds.map((id, i) => commands.setExtensionData({ owner: 'fixture', ownerId: id, key: 'link', value: { uid: `uid-${i}` } })),
    ], 'Add all');
    const pastBefore = history.canUndo.value;
    run(batch);
    expect(batch.description).toBe('Add all');
    expect(getFixture(add.fixtureIds[1]!)?.extensionData).toEqual({ 'test-ext': { link: { uid: 'uid-1' } } });

    history.undo();
    expect(scene()).toHaveLength(0);
    expect(history.canUndo.value).toBe(pastBefore);
    history.redo();
    expect(getFixture(add.fixtureIds[0]!)?.extensionData).toEqual({ 'test-ext': { link: { uid: 'uid-0' } } });

    // Persisted as one 'Composite' change that replays (e.g. for a collaborator).
    const payload = (batch as SerializableCommand).toPayload();
    expect((batch as SerializableCommand).commandType).toBe('Composite');
    history.undo();
    const store = useEngineStore();
    const replayed = commandFromPayload('Composite', payload, store.getReplayContext())!;
    replayed.execute();
    expect(scene()).toHaveLength(2);
    expect(getFixture(add.fixtureIds[1]!)?.extensionData).toEqual({ 'test-ext': { link: { uid: 'uid-1' } } });
  });
});

describe('commands.setStartAddress / setFixtureMode (M4.3)', () => {
  /** Adds one tube in mode 0 at address 1 and returns it. */
  async function addTube(): Promise<Fixture> {
    const add = await commands.addFixtures([{ definition: xbarKey, startAddress: 1 }]);
    run(add);
    return useEngineStore().flatFixtures.find(f => f.id === add.fixtureIds[0])! as Fixture;
  }

  it('sets the start address (and universe) undoably', async () => {
    const tube = await addTube();
    run(commands.setStartAddress({ fixtureId: tube.id, startAddress: 513 + 20 }));
    expect(getFixture(tube.id)).toMatchObject({ startAddress: 533, universe: 2, localAddress: 21 });
    history.undo();
    expect(tube.startAddress).toBe(1);
    expect(() => commands.setStartAddress({ fixtureId: tube.id, startAddress: 1.5 })).toThrow('startAddress');
  });

  it('switches the mode and keeps id, name, position, address and extension data', async () => {
    const tube = await addTube();
    run(commands.setExtensionData({ owner: 'fixture', ownerId: tube.id, key: 'link', value: 'uid-1' }));
    run(commands.move({ moves: [{ fixtureId: tube.id, position: { x: 0.1, y: 0.2 } }] }));
    run(commands.setStartAddress({ fixtureId: tube.id, startAddress: 40 }));
    tube.name = 'Tube 7';
    // Programmed value of "Red 1" carries over to the new mode.
    tube.channels[0]!.chaserConfig!.stepValues[0] = 200;

    const cmd = await commands.setFixtureMode({ fixtureId: tube.id, modeIndex: 3 });
    run(cmd);
    const view = getFixture(tube.id)!;
    expect(view.channels).toHaveLength(13);
    expect(view).toMatchObject({ id: tube.id, name: 'Tube 7', startAddress: 40, position: { x: 0.1, y: 0.2 } });
    expect(view.source).toEqual({ key: xbarKey, modeIndex: 3 });
    expect(view.extensionData).toEqual({ 'test-ext': { link: 'uid-1' } });
    expect(tube.channels[0]!.chaserConfig!.stepValues[0]).toBe(200);
    expect(scene()[0]).toBe(tube); // same instance, swapped in place

    history.undo();
    expect(tube.channels).toHaveLength(12);
    expect(tube.source).toEqual({ key: xbarKey, modeIndex: 0 });

    // Replays from its payload (reload / collaborators).
    const payload = (cmd as SerializableCommand).toPayload();
    commandFromPayload('SetFixtureMode', JSON.parse(JSON.stringify(payload)), useEngineStore().getReplayContext())!.execute();
    expect(tube.channels).toHaveLength(13);
    expect(tube.source).toEqual({ key: xbarKey, modeIndex: 3 });
  });

  it('rejects fixtures without a definition and unknown modes', async () => {
    const plain = Fixture.createRGBFixture('plain-1');
    scene().push(plain);
    await expect(commands.setFixtureMode({ fixtureId: 'plain-1', modeIndex: 1 })).rejects.toThrow('no known definition');
    const tube = await addTube();
    await expect(commands.setFixtureMode({ fixtureId: tube.id, modeIndex: 7 })).rejects.toThrow('no mode 7');
  });
});

describe('findFreeAddressSpan / listFixtures (M4.2)', () => {
  it('searches over the project fixtures', async () => {
    run(await commands.addFixtures([{ definition: xbarKey, startAddress: 1 }, { definition: xbarKey, startAddress: 25 }]));
    const fixtures = listFixtures();
    expect(fixtures.map(f => [f.startAddress, f.channelCount])).toEqual([[1, 12], [25, 12]]);
    expect(findFreeAddressSpan(fixtures, 12, 1)).toBe(13);
    expect(findFreeAddressSpan(fixtures, 13, 1)).toBe(37);
    expect(findFreeAddressSpan(fixtures, 12, 1, { ignore: [fixtures[0]!.id] })).toBe(1);
    expect(findFreeAddressSpan(fixtures, 500, 1, { universe: 1 })).toBeNull();
  });
});

describe('onBeforeFixtureChange (M4.5)', () => {
  /** A request moving fixture `id` from 1 to universe 2. */
  const toUniverse2 = (id: string) => ({ fixtureId: id, before: patchStateAt(1, 12, 0), after: patchStateAt(513, 12, 0) });

  it('allows without guards and for requests without a change', async () => {
    expect(await requestFixtureChanges([toUniverse2('a')])).toBe(true);
    onBeforeFixtureChange(() => ({ action: 'deny' }));
    expect(await requestFixtureChanges([{ fixtureId: 'a', before: patchStateAt(1, 12), after: patchStateAt(1, 12) }])).toBe(true);
  });

  it('denies when any guard denies', async () => {
    const seen: string[] = [];
    onBeforeFixtureChange((c) => { seen.push(String(c.fixtureId)); return { action: 'confirm', message: 'sure?' }; });
    onBeforeFixtureChange(c => (c.before.universe !== c.after.universe ? { action: 'deny', message: 'Bound to a port.' } : undefined));
    expect(await requestFixtureChanges([toUniverse2('a')])).toBe(false);
    expect(seen).toEqual(['a']);
  });

  it('asks the user once for all confirm messages', async () => {
    onBeforeFixtureChange(() => ({ action: 'confirm', message: 'Bound to a physical output port.', confirmLabel: 'Change anyway' }));
    onBeforeFixtureChange(() => { throw new Error('broken guard'); }); // failures count as allow
    const pending = requestFixtureChanges([toUniverse2('a'), toUniverse2('b')]);
    await flush();
    expect(currentConfirm.value).toMatchObject({ message: 'Bound to a physical output port.', confirmLabel: 'Change anyway' });
    answerConfirm(true);
    expect(await pending).toBe(true);

    const cancelled = requestFixtureChanges([toUniverse2('a')]);
    await flush();
    answerConfirm(false);
    expect(await cancelled).toBe(false);
  });

  it('never blocks programmatic commands, and unregisters', async () => {
    run(await commands.addFixtures([{ definition: xbarKey, startAddress: 1 }]));
    const id = listFixtures()[0]!.id;
    const off = onBeforeFixtureChange(() => ({ action: 'deny' }));
    run(commands.setStartAddress({ fixtureId: id, startAddress: 600 }));
    expect(getFixture(id)?.universe).toBe(2);
    history.undo();
    expect(getFixture(id)?.universe).toBe(1);
    off();
    expect(await requestFixtureChanges([toUniverse2(String(id))])).toBe(true);
  });
});

describe('onFixturePatchChange (M4.6)', () => {
  it('reports local, undo, redo and remote patch changes with origin and initiator', async () => {
    const add = await commands.addFixtures([{ definition: xbarKey, startAddress: 1 }, { definition: xbarKey, startAddress: 13 }]);
    const seen: FixturePatchChange[][] = [];
    const off = onFixturePatchChange(changes => seen.push(changes));

    run(add);
    await flush();
    expect(seen.at(-1)!.map(c => [c.before, c.after?.startAddress, c.origin, c.initiator])).toEqual([
      [null, 1, 'local', 'test-ext'], [null, 13, 'local', 'test-ext'],
    ]);

    const [a] = add.fixtureIds;
    run(commands.setStartAddress({ fixtureId: a!, startAddress: 513 }));
    await flush();
    expect(seen.at(-1)).toEqual([{
      fixtureId: a, before: patchStateAt(1, 12, 0), after: patchStateAt(513, 12, 0), origin: 'local', initiator: 'test-ext',
    }]);

    history.undo();
    await flush();
    expect(seen.at(-1)!.map(c => [c.after?.universe, c.origin, c.initiator])).toEqual([[1, 'undo', undefined]]);
    history.redo();
    await flush();
    expect(seen.at(-1)!.map(c => [c.after?.universe, c.origin])).toEqual([[2, 'redo']]);

    // A collaborator's change arrives through executeRemote.
    const store = useEngineStore();
    const remote = commandFromPayload('UpdateDmx', { fixtureId: a, beforeAddress: 513, afterAddress: 50 }, store.getReplayContext())!;
    history.executeRemote(remote);
    await flush();
    expect(seen.at(-1)!.map(c => [c.after?.startAddress, c.origin])).toEqual([[50, 'remote']]);

    // Mode changes are patch changes too (channel count + mode index).
    run(await commands.setFixtureMode({ fixtureId: a!, modeIndex: 1 }));
    await flush();
    expect(seen.at(-1)!.map(c => [c.before?.modeIndex, c.after?.modeIndex, c.after?.channelCount])).toEqual([[0, 1, 3]]);

    off();
    const count = seen.length;
    run(commands.setStartAddress({ fixtureId: a!, startAddress: 60 }));
    await flush();
    expect(seen).toHaveLength(count);
  });

  it('filters by fixture ids, ignores non-patch commands and project loads', async () => {
    const add = await commands.addFixtures([{ definition: xbarKey, startAddress: 1 }, { definition: xbarKey, startAddress: 13 }]);
    run(add);
    const [a, b] = add.fixtureIds;
    const onlyB: FixturePatchChange[][] = [];
    const dynamic: FixturePatchChange[][] = [];
    let watched: (string | number)[] = [];
    onFixturePatchChange(changes => onlyB.push(changes), { fixtureIds: [b!] });
    onFixturePatchChange(changes => dynamic.push(changes), { fixtureIds: () => watched });

    run(commands.setStartAddress({ fixtureId: a!, startAddress: 100 }));
    run(commands.rename({ nodeId: b!, name: 'B' }));
    await flush();
    expect(onlyB).toHaveLength(0);
    expect(dynamic).toHaveLength(0);

    watched = [a!];
    run(commands.setStartAddress({ fixtureId: a!, startAddress: 200 }));
    await flush();
    expect(dynamic.at(-1)!.map(c => c.after?.startAddress)).toEqual([200]);

    // State replaced outside the history (project load) is the new baseline.
    const fixture = useEngineStore().flatFixtures.find(f => f.id === b)!;
    fixture.startAddress = 300;
    rebaseFixturePatchObservation();
    expect(patchStateOf(fixture as Fixture).startAddress).toBe(300);
    run(commands.rename({ nodeId: a!, name: 'A' }));
    await flush();
    expect(onlyB).toHaveLength(0);
  });
});

describe('findFixtureDefinitionByRdm (M4.8)', () => {
  it('finds a custom fixture with its personality → mode mapping', async () => {
    const match = await findFixtureDefinitionByRdm(0x7ff0, 1);
    expect(match).toMatchObject({ key: xbarKey, source: 'custom', modeByPersonality: { 1: 0, 2: 1, 3: 2, 4: 3 } });
    expect(match!.modes.map(m => m.channelCount)).toEqual([12, 3, 4, 13]);
    expect(await findFixtureDefinitionByRdm(0x7ff0, 2)).toBeNull();
  });
});

describe('saveCustomFixtureDefinition (API 1.4)', () => {
  /** A generated two-mode definition with RDM IDs. */
  const generated = {
    name: 'Acme Bar (RDM)',
    categories: ['Pixel Bar'],
    rdm: { modelId: 9 },
    pixelmapper: { rdmManufacturerId: 0x1234 },
    availableChannels: {
      Dimmer: { capability: { type: 'Intensity' } },
      Red: { capability: { type: 'ColorIntensity', color: 'Red' } },
    },
    modes: [
      { name: '1 ch', rdmPersonalityIndex: 1, channels: ['Dimmer'] },
      { name: '2 ch', rdmPersonalityIndex: 2, channels: ['Dimmer', 'Red'] },
    ],
  };

  it('stores a new custom fixture that the RDM lookup and addFixtures find', async () => {
    const key = await saveCustomFixtureDefinition(generated);
    expect(key).toMatch(/^custom\//);
    const match = await findFixtureDefinitionByRdm(0x1234, 9);
    expect(match).toMatchObject({ key, source: 'custom', modeByPersonality: { 1: 0, 2: 1 } });
    const add = await commands.addFixtures([{ definition: key, modeIndex: 1, startAddress: 1 }]);
    run(add);
    expect(getFixture(add.fixtureIds[0]!)?.channels).toHaveLength(2);
  });

  it('never replaces an existing custom fixture and rejects invalid definitions', async () => {
    const first = await saveCustomFixtureDefinition(generated);
    const second = await saveCustomFixtureDefinition(generated);
    expect(second).not.toBe(first);
    expect(getCustomFixtures().map(c => c.name)).toEqual(expect.arrayContaining(['Acme Bar (RDM)', 'Acme Bar (RDM) (2)']));
    await expect(saveCustomFixtureDefinition({ name: 'x' })).rejects.toThrow('modes');
  });
});
