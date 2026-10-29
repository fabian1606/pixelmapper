/**
 * Device flows against the fake bridge (plan M6.5–M6.7): Pixelmapper →
 * device sync (address, mode → personality, undo/redo; not own or remote
 * changes), device → Mismatch (panel SET, periodic re-read) with *Take from
 * device* / *Write to device*, the universe guard (confirm, unlink, re-link)
 * and Offline.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getFixture, type FixtureId } from '@pixelmapper/extension-api';
import { useHistory } from '~/components/engine/composables/use-history';
import { commandFromPayload } from '~/components/engine/commands/serializable-command';
import { useEngineStore } from '~/stores/engine-store';
import { requestFixtureChanges } from '~/utils/extensions/fixture-change-guard';
import { patchStateAt } from '~/utils/extensions/fixture-patch-state';
import { answerConfirm, currentConfirm } from '~/composables/use-confirm-dialog';
import { RDM_PID } from '../bridge/rdm-constants';
import { addDevices } from './add-devices';
import { readLink } from './link';
import { takeFromDevice, writeToDevice } from './patch-sync';
import { createHarness, stubEngineGlobals, type Harness } from './testing/harness.test-support';

const A = '7FF0:00000001';
const B = '7FF0:00000002';

let h: Harness;
const history = useHistory();

beforeAll(stubEngineGlobals);
afterEach(async () => h.dispose());

/** Harness with tube A (U1.1, 12 ch) and B (U1.13) added and linked. */
async function linkedTubes(): Promise<{ a: FixtureId; b: FixtureId }> {
  h = await createHarness((t) => {
    t.add(A, 1, { dmxStartAddress: 1 });
    t.add(B, 1, { dmxStartAddress: 13 });
  });
  await addDevices(h.runtime, [A, B]);
  await h.settle();
  return { a: h.runtime.fixturesOfUid(A)[0]!.fixtureId, b: h.runtime.fixturesOfUid(B)[0]!.fixtureId };
}

/** RDM SETs sent since `from`, as [uid, pid, value]. */
const setsSince = (from: number) => h.tubes.sets.slice(from).map(s => [s.uid, s.pid, s.value]);

describe('Pixelmapper → device (M6.5)', () => {
  it('sends address and mode changes made in the app, also on undo/redo', async () => {
    const { a } = await linkedTubes();
    expect(h.statusOf(a)).toBe('connected');
    const n = h.tubes.sets.length;

    h.runAsUser(h.runtime.api.commands.setStartAddress({ fixtureId: a, startAddress: 40 }));
    await h.settle();
    expect(setsSince(n)).toEqual([[A, RDM_PID.DMX_START_ADDRESS, 40]]);
    expect(h.runtime.store.get(A)?.info?.dmxStartAddress).toBe(40); // re-read: the device's answer

    h.runAsUser(await h.runtime.api.commands.setFixtureMode({ fixtureId: a, modeIndex: 3 }));
    await h.settle();
    expect(setsSince(n + 1)).toEqual([[A, RDM_PID.DMX_PERSONALITY, 4], [A, RDM_PID.DMX_START_ADDRESS, 40]]);
    expect(h.tubes.devices.get(A)!.info).toMatchObject({ currentPersonality: 4, dmxFootprint: 13 });
    expect(h.statusOf(a)).toBe('connected');

    history.undo(); // mode back
    history.undo(); // address back
    await h.settle();
    expect(h.tubes.devices.get(A)!.info).toMatchObject({ currentPersonality: 1, dmxStartAddress: 1 });
    history.redo();
    await h.settle();
    expect(h.tubes.devices.get(A)!.info.dmxStartAddress).toBe(40);
  });

  it('does not send collaborators’ changes or its own', async () => {
    const { a } = await linkedTubes();
    const n = h.tubes.sets.length;
    const remote = commandFromPayload('UpdateDmx', { fixtureId: a, beforeAddress: 1, afterAddress: 60 }, useEngineStore().getReplayContext())!;
    history.executeRemote(remote);
    h.runtime.api.run(h.runtime.api.commands.setStartAddress({ fixtureId: a, startAddress: 70 }));
    await h.settle();
    expect(setsSince(n)).toEqual([]);
    expect(h.statusOf(a)).toBe('mismatch'); // the device still reports 1
  });
});

describe('Device → Pixelmapper (M6.5, M6.7)', () => {
  it('shows Mismatch after a panel SET; Take from device follows without writing back', async () => {
    const { a } = await linkedTubes();
    h.tubes.changeFromPanel(A, { dmxStartAddress: 200, currentPersonality: 2, dmxFootprint: 3 });
    await h.settle();
    expect(h.statusOf(a)).toBe('mismatch');
    expect(getFixture(a)!.localAddress).toBe(1); // never auto-overwritten

    const n = h.tubes.sets.length;
    await takeFromDevice(h.runtime, a);
    await h.settle();
    expect(getFixture(a)).toMatchObject({ localAddress: 200, source: { modeIndex: 1 } });
    expect(getFixture(a)!.channels).toHaveLength(3);
    expect(setsSince(n)).toEqual([]);
    expect(history.lastDescription.value).toBe('Take patch from device');
    expect(h.statusOf(a)).toBe('connected');
  });

  it('Write to device sends the fixture’s mode and address', async () => {
    const { a } = await linkedTubes();
    h.tubes.changeFromPanel(A, { dmxStartAddress: 300, currentPersonality: 3, dmxFootprint: 4 });
    await h.settle();
    const n = h.tubes.sets.length;
    await writeToDevice(h.runtime, a);
    expect(setsSince(n)).toEqual([[A, RDM_PID.DMX_PERSONALITY, 1], [A, RDM_PID.DMX_START_ADDRESS, 1]]);
    expect(h.statusOf(a)).toBe('connected');
  });
});

describe('Universe guard (M6.6)', () => {
  it('asks before a universe change, unlinks on “Change anyway” and re-links when moved back', async () => {
    const { a } = await linkedTubes();
    const asked = requestFixtureChanges([{ fixtureId: a, before: patchStateAt(1, 12, 0), after: patchStateAt(513, 12, 0) }]);
    await h.settle();
    expect(currentConfirm.value?.message).toBe('This fixture is bound to a physical node port (PM Node port 1). Change anyway?');
    expect(currentConfirm.value?.confirmLabel).toBe('Change anyway');
    answerConfirm(true);
    expect(await asked).toBe(true);

    // The core UI then moves it (no initiator): the link becomes `unlinked`, nothing is sent.
    const n = h.tubes.sets.length;
    h.runAsUser(h.runtime.api.commands.setStartAddress({ fixtureId: a, startAddress: 513 }));
    await h.settle();
    expect(readLink(getFixture(a)!.extensionData as never)?.state).toBe('unlinked');
    expect(h.statusOf(a)).toBe('unlinked');
    h.runAsUser(h.runtime.api.commands.setStartAddress({ fixtureId: a, startAddress: 520 }));
    await h.settle();
    expect(setsSince(n)).toEqual([]);

    // Back into the port's universe: linked again (UID kept), no write — Mismatch shows the difference.
    h.runAsUser(h.runtime.api.commands.setStartAddress({ fixtureId: a, startAddress: 5 }));
    await h.settle();
    expect(readLink(getFixture(a)!.extensionData as never)).toMatchObject({ uid: A, state: 'linked' });
    expect(setsSince(n)).toEqual([]);
    expect(h.statusOf(a)).toBe('mismatch');
  });

  it('does not ask for address changes inside the port universe', async () => {
    const { a } = await linkedTubes();
    expect(await requestFixtureChanges([{ fixtureId: a, before: patchStateAt(1, 12, 0), after: patchStateAt(30, 12, 0) }])).toBe(true);
    expect(currentConfirm.value).toBeNull();
  });
});

describe('Runtime activation', () => {
  it('runs the device features only while an artnet connector exists', async () => {
    const { a } = await linkedTubes();
    await h.connector.disconnect(); // connector removed
    await h.settle();
    expect(h.runtime.store.get(A)?.present).toBe(false);
    const n = h.tubes.sets.length;
    h.runAsUser(h.runtime.api.commands.setStartAddress({ fixtureId: a, startAddress: 30 }));
    await h.settle();
    expect(setsSince(n)).toEqual([]);

    await h.connector.connect(); // added again
    await h.settle();
    expect(h.runtime.store.get(A)?.present).toBe(true);
    expect(h.statusOf(a)).toBe('mismatch'); // the device kept 1 while nobody could tell it
  });
});

describe('Offline (M6.7)', () => {
  it('is Offline when the device is unplugged, the node is gone or the bridge is lost', async () => {
    const { a, b } = await linkedTubes();
    h.tubes.unplug(B);
    await h.settle();
    expect([h.statusOf(a), h.statusOf(b)]).toEqual(['connected', 'offline']);

    h.tubes.devices.get(A)!.failWith = 'timeout';
    await h.runtime.store.readInfo(A);
    expect(h.statusOf(a)).toBe('offline');
    h.tubes.devices.get(A)!.failWith = null;
    await h.runtime.store.readInfo(A);
    expect(h.statusOf(a)).toBe('connected');

    h.backend.disconnect();
    await h.settle();
    expect(h.statusOf(a)).toBe('offline');
  });
});
