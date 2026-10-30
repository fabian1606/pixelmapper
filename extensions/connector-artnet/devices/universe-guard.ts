/**
 * Universe guard of linked fixtures (plan M6.6, D14).
 *
 * Before the core UI moves an effectively linked fixture out of its node
 * port's universe, the user confirms (“This fixture is bound to a physical
 * node port …”). When the move happens anyway, the link state becomes
 * `unlinked` (UID kept, no RDM writes); moving the fixture back into the
 * port's universe re-links it. Only local changes write the state —
 * undo/redo and collaborators bring their own state along, and the
 * effective link is derived from the universe anyway.
 */
import { getFixture, onBeforeFixtureChange, onFixturePatchChange, type Command, type FixturePatchChange, type Json } from '@pixelmapper/extension-api';
import type { DeviceRuntime } from './device-runtime';
import { ARTNET_EXTENSION_ID, LINK_KEY, linkJson, readLink } from './link';
import { nodeDisplayName, portDisplayName, portUniverse } from './node-ports';

/** Registers the guard and the unlink/re-link observer; returns the stop function. */
export function startUniverseGuard(runtime: DeviceRuntime): () => void {
  const offGuard = onBeforeFixtureChange((change) => {
    if (change.before.universe === change.after.universe) return;
    const link = readLink(getFixture(change.fixtureId)?.extensionData as Record<string, Record<string, Json>> | undefined);
    if (!link || link.state !== 'linked') return;
    const universe = portUniverse(link.nodeId, link.port);
    if (universe === null || change.before.universe !== universe || change.after.universe === universe) return;
    const where = `${nodeDisplayName(link.nodeId)} ${portDisplayName(link.nodeId, link.port).toLowerCase()}`;
    return {
      action: 'confirm',
      title: 'Unlink from the device?',
      message: `This fixture is bound to a physical node port (${where}). Change anyway?`,
      confirmLabel: 'Change anyway',
    };
  });

  /** Link-state writes for the universe changes of one history step. */
  function onChanges(changes: FixturePatchChange[]) {
    const writes: Command[] = [];
    for (const c of changes) {
      if (c.origin !== 'local' || c.initiator === ARTNET_EXTENSION_ID || !c.before || !c.after) continue;
      if (c.before.universe === c.after.universe) continue;
      const link = readLink(getFixture(c.fixtureId)?.extensionData as Record<string, Record<string, Json>> | undefined);
      const universe = link ? portUniverse(link.nodeId, link.port) : null;
      if (!link || universe === null) continue;
      let state: 'linked' | 'unlinked' | null = null;
      if (link.state === 'linked' && c.before.universe === universe && c.after.universe !== universe) state = 'unlinked';
      if (link.state === 'unlinked' && c.after.universe === universe) state = 'linked';
      if (!state) continue;
      writes.push(runtime.api.commands.setExtensionData({ owner: 'fixture', ownerId: c.fixtureId, key: LINK_KEY, value: linkJson({ ...link, state }) }));
    }
    if (!writes.length) return;
    const unlinked = writes.length === 1 ? 'Update device link' : `Update ${writes.length} device links`;
    runtime.api.run(writes.length === 1 ? writes[0]! : runtime.api.commands.batch(writes, unlinked));
  }

  const offObserver = onFixturePatchChange(onChanges, { fixtureIds: () => runtime.linkedFixtures().map(f => f.fixtureId) });
  return () => {
    offGuard();
    offObserver();
  };
}
