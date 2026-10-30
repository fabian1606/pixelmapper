/**
 * Patch sync between linked fixtures and their devices (plan M6.5, D5, D13).
 *
 * Pixelmapper → device: address/mode changes of effectively linked fixtures
 * made in this app (`local` by the user or another extension, `undo`,
 * `redo`) become RDM SETs (DMX_PERSONALITY first, then DMX_START_ADDRESS);
 * the device is re-read afterwards, so the state is its answer. Changes this
 * extension made itself ("Take from device", "Assign free address",
 * auto-address) and collaborators' changes (their app pushes) are not sent.
 *
 * Device → Pixelmapper never happens automatically: a difference shows as
 * Mismatch, resolved with *Write to device* / *Take from device*.
 */
import { getFixture, onFixturePatchChange, type Command, type FixtureId, type FixturePatchChange } from '@pixelmapper/extension-api';
import type { RdmUid } from '../bridge/protocol-model';
import type { DeviceRuntime } from './device-runtime';
import { fixtureLinkState } from './fixture-link-state';
import { absoluteAddress, ARTNET_EXTENSION_ID } from './link';

/** Starts pushing patch changes of linked fixtures; returns the stop function. */
export function startPatchSync(runtime: DeviceRuntime): () => void {
  /** Per-device chain, so SETs reach a device in the order the changes happened. */
  const chains = new Map<RdmUid, Promise<void>>();

  /** Queues `job` after the previous writes to `uid`. */
  function enqueue(uid: RdmUid, job: () => Promise<void>) {
    const next = (chains.get(uid) ?? Promise.resolve()).then(job).catch((err) => {
      console.warn(`[artnet] RDM write to ${uid} failed:`, err);
    });
    chains.set(uid, next);
    void next.finally(() => { if (chains.get(uid) === next) chains.delete(uid); });
  }

  /** Pushes one change when it is a local patch change of an effectively linked fixture. */
  function onChange(change: FixturePatchChange) {
    if (change.origin === 'remote' || change.initiator === ARTNET_EXTENSION_ID) return;
    const { before, after } = change;
    if (!before || !after) return;
    const view = getFixture(change.fixtureId);
    const state = view ? fixtureLinkState(runtime, view) : null;
    // Linked before AND after: moving into or out of the port's universe (re)links instead (D14).
    if (!view || !state?.effective || before.universe !== state.portUniverse) return;
    const { uid } = state.link;
    const modeChanged = after.modeIndex !== before.modeIndex && after.modeIndex !== undefined;
    const addressChanged = after.localAddress !== before.localAddress;
    if (!modeChanged && !addressChanged) return;
    enqueue(uid, async () => {
      const device = runtime.store.get(uid);
      if (!device) return;
      if (modeChanged && view.source) {
        const maps = await runtime.loadPersonalityMaps(view.source.key, device);
        const personality = maps?.personalityByMode[after.modeIndex!];
        if (personality !== undefined) await runtime.store.setPersonality(uid, personality);
        else console.warn(`[artnet] mode ${after.modeIndex} of ${view.source.key} has no RDM personality; not sent to ${uid}`);
      }
      await runtime.store.setStartAddress(uid, after.localAddress);
    });
  }

  return onFixturePatchChange(
    changes => changes.forEach(onChange),
    { fixtureIds: () => runtime.linkedFixtures().map(f => f.fixtureId) },
  );
}

/**
 * *Write to device*: sends the fixture's mode (as personality) and address
 * to the device, then re-reads it. Throws a user-facing Error.
 */
export async function writeToDevice(runtime: DeviceRuntime, fixtureId: FixtureId): Promise<void> {
  const view = getFixture(fixtureId);
  const state = view ? fixtureLinkState(runtime, view) : null;
  if (!view || !state) throw new Error('The fixture is not linked to a device');
  if (!state.effective) throw new Error('The fixture is not in the universe of its node port');
  const device = state.device;
  if (!device?.present) throw new Error('The device is offline');
  const { uid } = state.link;
  if (view.source) {
    const maps = await runtime.loadPersonalityMaps(view.source.key, device);
    const personality = maps?.personalityByMode[view.source.modeIndex];
    if (personality !== undefined && personality !== device.info?.currentPersonality) await runtime.store.setPersonality(uid, personality);
  }
  if (runtime.store.get(uid)?.info?.dmxStartAddress !== view.localAddress) await runtime.store.setStartAddress(uid, view.localAddress);
}

/**
 * *Take from device*: re-reads the device and sets the fixture's address and
 * mode to what it reports — one undo step, run as this extension so the
 * sync does not send it back. Throws a user-facing Error.
 */
export async function takeFromDevice(runtime: DeviceRuntime, fixtureId: FixtureId): Promise<void> {
  const view = getFixture(fixtureId);
  const state = view ? fixtureLinkState(runtime, view) : null;
  if (!view || !state) throw new Error('The fixture is not linked to a device');
  if (!state.effective || state.portUniverse === null) throw new Error('The fixture is not in the universe of its node port');
  const info = await runtime.store.readInfo(state.link.uid);
  if (!info) throw new Error(runtime.store.get(state.link.uid)?.error ?? 'The device does not answer');
  const { commands } = runtime.api;
  const steps: Command[] = [];
  if (view.source) {
    const device = runtime.store.get(state.link.uid)!;
    const maps = await runtime.loadPersonalityMaps(view.source.key, device);
    const modeIndex = maps?.modeByPersonality[info.currentPersonality];
    if (modeIndex === undefined) throw new Error(`Personality ${info.currentPersonality} of the device has no mode in the fixture's definition`);
    if (modeIndex !== view.source.modeIndex) steps.push(await commands.setFixtureMode({ fixtureId, modeIndex }));
  }
  if (info.dmxStartAddress !== view.localAddress) {
    steps.push(commands.setStartAddress({ fixtureId, startAddress: absoluteAddress(state.portUniverse, info.dmxStartAddress) }));
  }
  if (steps.length) runtime.api.run(commands.batch(steps, 'Take patch from device'));
}
