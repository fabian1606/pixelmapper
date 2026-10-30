/**
 * Explicit Unlink / Re-link of a fixture (plan D14, M7.2 inspector), with
 * the same semantics as the universe guard (M6.6):
 *
 * - **Unlink** sets the link state `unlinked`: the UID stays, nothing is
 *   sent to the device any more and the badge shows Unlinked.
 * - **Re-link** moves the fixture back into the universe of its node port
 *   (same address inside the universe) and sets the state `linked`. Nothing
 *   is written to the device — a different address or personality shows as
 *   Mismatch and is resolved there (*Write to device* / *Take from device*).
 *
 * Each is one undo step, run as this extension, so the patch sync and the
 * universe guard do not react to it.
 */
import { getFixture, type Command, type FixtureId, type Json } from '@pixelmapper/extension-api';
import type { DeviceRuntime } from './device-runtime';
import { absoluteAddress, LINK_KEY, linkJson, readLink, UNIVERSE_SIZE, type RdmLink } from './link';
import { nodeDisplayName, portDisplayName, portUniverse } from './node-ports';

/** The fixture's link and view, or null without a link. */
function linkOf(fixtureId: FixtureId) {
  const view = getFixture(fixtureId);
  const link = view ? readLink(view.extensionData as Record<string, Record<string, Json>> | undefined) : null;
  return view && link ? { view, link } : null;
}

/** Command that stores `link` with another state. */
function setState(runtime: DeviceRuntime, fixtureId: FixtureId, link: RdmLink, state: RdmLink['state']): Command {
  return runtime.api.commands.setExtensionData({ owner: 'fixture', ownerId: fixtureId, key: LINK_KEY, value: linkJson({ ...link, state }) });
}

/** Unlinks the fixture (see file comment); false when it has no `linked` link. */
export function unlinkFixture(runtime: DeviceRuntime, fixtureId: FixtureId): boolean {
  const found = linkOf(fixtureId);
  if (!found || found.link.state !== 'linked') return false;
  runtime.api.run(setState(runtime, fixtureId, found.link, 'unlinked'));
  return true;
}

/** Why the fixture cannot be re-linked (English), or null. */
export function relinkProblem(fixtureId: FixtureId): string | null {
  const found = linkOf(fixtureId);
  if (!found) return 'The fixture is not linked to a device';
  const { view, link } = found;
  const universe = portUniverse(link.nodeId, link.port);
  if (universe === null) return `No Art-Net node connector outputs ${portDisplayName(link.nodeId, link.port).toLowerCase()} of ${nodeDisplayName(link.nodeId)}`;
  const footprint = Math.max(1, view.channels.length);
  if (view.universe !== universe && view.localAddress + footprint - 1 > UNIVERSE_SIZE) {
    return `Address ${view.localAddress} does not fit into U${universe} with ${footprint} channels`;
  }
  return null;
}

/** Re-links the fixture (see file comment). Throws a user-facing Error when it cannot. */
export function relinkFixture(runtime: DeviceRuntime, fixtureId: FixtureId): void {
  const problem = relinkProblem(fixtureId);
  if (problem) throw new Error(problem);
  const { view, link } = linkOf(fixtureId)!;
  const universe = portUniverse(link.nodeId, link.port)!;
  const commands: Command[] = [];
  if (view.universe !== universe) {
    commands.push(runtime.api.commands.setStartAddress({ fixtureId, startAddress: absoluteAddress(universe, view.localAddress) }));
  }
  if (link.state !== 'linked') commands.push(setState(runtime, fixtureId, link, 'linked'));
  if (!commands.length) return;
  runtime.api.run(commands.length === 1 ? commands[0]! : runtime.api.commands.batch(commands, 'Re-link to the device'));
}
