/**
 * Device flows against the fake bridge (plan M6.3, M6.4): Add / Add all as
 * one undo step with mode by personality and the device's address,
 * conflicts by footprint, Assign free address (fixture follows on ACK) and
 * Auto-address in canvas order (one undo step, failures per device).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getFixture, listFixtures } from '@pixelmapper/extension-api';
import { useHistory } from '~/components/engine/composables/use-history';
import { addDevices } from './add-devices';
import { assignFreeAddress, autoAddress, presentDeviceSpans } from './addressing';
import { conflictsOf, deviceSpanOf } from './conflicts';
import { readLink } from './link';
import { createHarness, stubEngineGlobals, type Harness } from './testing/harness.test-support';
import { RDM_PID } from '../bridge/rdm-constants';

const A = '7FF0:00000001';
const B = '7FF0:00000002';
const C = '7FF0:00000003';

let h: Harness;
const history = useHistory();

beforeAll(stubEngineGlobals);
afterEach(async () => h.dispose());

/** The fixture linked to `uid`. */
function fixtureOf(uid: string) {
  const f = h.runtime.fixturesOfUid(uid)[0];
  return f ? getFixture(f.fixtureId) : undefined;
}

describe('Add / Add all (M6.3)', () => {
  it('adds all devices with their address and personality → mode as ONE undo step', async () => {
    h = await createHarness((t) => {
      t.add(A, 1, { dmxStartAddress: 1 }, 'Left');
      t.add(B, 1, { dmxStartAddress: 13, currentPersonality: 2 });
      t.add(C, 2, { dmxStartAddress: 100 });
    });
    const outcomes = await addDevices(h.runtime, [A, B, C]);
    expect(outcomes.map(o => [o.uid, !!o.fixtureId, o.error])).toEqual([[A, true, undefined], [B, true, undefined], [C, true, undefined]]);

    const a = fixtureOf(A)!;
    const b = fixtureOf(B)!;
    const c = fixtureOf(C)!;
    expect([a.name, a.universe, a.localAddress, a.source?.key, a.source?.modeIndex, a.channels.length]).toEqual(['Left', 1, 1, h.xbarKey, 0, 12]);
    expect([b.name, b.localAddress, b.source?.modeIndex, b.channels.length]).toEqual(['XBAR500 LED Tube', 13, 1, 3]);
    expect([c.universe, c.localAddress]).toEqual([2, 100]); // port 2 = U2 (Port-Address 2)
    expect(readLink(a.extensionData as never)).toEqual({ uid: A, nodeId: h.tubes.node.nodeId, port: { bind: 1, index: 0 }, portAddress: 1, state: 'linked' });

    expect(history.lastDescription.value).toBe('Add 3 devices');
    history.undo();
    expect(listFixtures()).toHaveLength(0);
    history.redo();
    expect(h.runtime.linkedFixtures()).toHaveLength(3);

    // Already linked devices are not added twice.
    const again = await addDevices(h.runtime, [A]);
    expect(again[0]!.error).toBe('Already in the project');
  });

  it('reports devices that cannot be added and adds the rest', async () => {
    h = await createHarness((t) => {
      t.add(A, 1);
      t.add(B, 1, { dmxStartAddress: 0xffff, dmxFootprint: 0 });
    });
    h.tubes.unplug(A);
    await h.settle();
    const outcomes = await addDevices(h.runtime, [A, B]);
    expect(outcomes.map(o => o.error)).toEqual(['The device is offline', 'The device uses no DMX channels']);
    expect(listFixtures()).toHaveLength(0);
  });
});

describe('Conflicts (M6.4)', () => {
  it('flags overlaps with project fixtures and other devices by footprint', async () => {
    h = await createHarness((t) => {
      t.add(A, 1, { dmxStartAddress: 1 });
      t.add(B, 1, { dmxStartAddress: 10 }); // 10–21 overlaps A (1–12)
      t.add(C, 1, { dmxStartAddress: 30 });
    });
    await addDevices(h.runtime, [A]);
    const spans = presentDeviceSpans(h.runtime.store);
    const span = (uid: string) => spans.find(s => s.uid === uid)!;
    expect(conflictsOf(span(B), listFixtures(), spans)).toEqual(['device XBAR500 LED Tube (U1.1)', 'XBAR500 LED Tube (U1.1)']);
    // A's own fixture is not a conflict; B's device overlaps it.
    expect(conflictsOf(span(A), listFixtures(), spans)).toEqual(['device XBAR500 LED Tube (U1.10)']);
    expect(conflictsOf(span(C), listFixtures(), spans)).toEqual([]);
    expect(deviceSpanOf(C, 'c', null, h.runtime.store.get(C)!.info)).toBeNull(); // no universe, no span
  });
});

describe('Assign free address (M6.4)', () => {
  it('moves an unlinked device to the first free gap; no fixture step when nothing moves', async () => {
    h = await createHarness((t) => {
      t.add(A, 1, { dmxStartAddress: 1 });
      t.add(B, 1, { dmxStartAddress: 5 });
    });
    await addDevices(h.runtime, [A]);
    // Unlinked B: the first gap after A (1–12) is 13; no fixture involved.
    const description = history.lastDescription.value;
    expect(await assignFreeAddress(h.runtime, B)).toBe(13);
    expect(h.tubes.devices.get(B)!.info.dmxStartAddress).toBe(13);
    expect(history.lastDescription.value).toBe(description);

    // Linked A drifted to 200 on the device: its own fixture does not block 1, so the device goes
    // back to 1 where the fixture already is — no history step.
    h.tubes.devices.get(A)!.info.dmxStartAddress = 200;
    await h.runtime.store.readInfo(A);
    await assignFreeAddress(h.runtime, A);
    expect(h.tubes.devices.get(A)!.info.dmxStartAddress).toBe(1);
    expect(fixtureOf(A)!.localAddress).toBe(1);
    expect(history.lastDescription.value).toBe(description);
  });

  it('lets the linked fixture follow the device and is undoable', async () => {
    h = await createHarness((t) => {
      t.add(A, 1, { dmxStartAddress: 1 });
      t.add(B, 1, { dmxStartAddress: 5 });
    });
    await addDevices(h.runtime, [B]); // B's fixture at 5–16
    const sets = h.tubes.sets.length;
    expect(await assignFreeAddress(h.runtime, B)).toBe(13); // A occupies 1–12
    expect(fixtureOf(B)!.localAddress).toBe(13);
    expect(h.tubes.sets.slice(sets).map(s => [s.uid, s.pid, s.value])).toEqual([[B, RDM_PID.DMX_START_ADDRESS, 13]]);
    await h.settle();
    expect(h.tubes.sets).toHaveLength(sets + 1); // the follow is not sent back
    history.undo();
    await h.settle();
    expect(fixtureOf(B)!.localAddress).toBe(5);
    expect(h.tubes.devices.get(B)!.info.dmxStartAddress).toBe(5); // undo is a local change → pushed
  });
});

describe('Auto-address (M6.4)', () => {
  it('packs the linked devices of the node gap-free in canvas order, one undo step', async () => {
    h = await createHarness((t) => {
      t.add(A, 1, { dmxStartAddress: 100 });
      t.add(B, 1, { dmxStartAddress: 7 });
      t.add(C, 1, { dmxStartAddress: 50, currentPersonality: 2 });
    });
    await addDevices(h.runtime, [A, B, C]);
    const ids = [A, B, C].map(uid => h.runtime.fixturesOfUid(uid)[0]!.fixtureId);
    // Canvas: B left, C middle, A right (same row).
    h.runAsUser(h.runtime.api.commands.move({ moves: [
      { fixtureId: ids[0]!, position: { x: 0.8, y: 0.5 } },
      { fixtureId: ids[1]!, position: { x: 0.2, y: 0.5 } },
      { fixtureId: ids[2]!, position: { x: 0.5, y: 0.505 } },
    ] }));
    await h.settle();
    h.tubes.devices.get(A)!.failWith = null;

    const outcomes = await autoAddress(h.runtime, h.tubes.node.nodeId);
    expect(outcomes.every(o => !o.error)).toBe(true);
    expect([fixtureOf(B)!.localAddress, fixtureOf(C)!.localAddress, fixtureOf(A)!.localAddress]).toEqual([1, 13, 16]);
    expect([B, C, A].map(uid => h.tubes.devices.get(uid)!.info.dmxStartAddress)).toEqual([1, 13, 16]);
    expect(history.lastDescription.value).toBe('Auto-address devices');
    await h.settle();
    history.undo();
    await h.settle();
    expect([fixtureOf(A)!.localAddress, fixtureOf(B)!.localAddress, fixtureOf(C)!.localAddress]).toEqual([100, 7, 50]);
  });

  it('reports failures per device and moves only the acknowledged ones', async () => {
    h = await createHarness((t) => {
      t.add(A, 1, { dmxStartAddress: 100 });
      t.add(B, 1, { dmxStartAddress: 7 });
    });
    await addDevices(h.runtime, [A, B]);
    h.tubes.devices.get(A)!.failWith = 'timeout';
    const outcomes = await autoAddress(h.runtime, h.tubes.node.nodeId);
    expect(outcomes.find(o => o.uid === A)?.error).toBe('The device does not answer');
    expect(outcomes.find(o => o.uid === B)?.address).toBeDefined();
    expect(fixtureOf(A)!.localAddress).toBe(100);
  });
});
