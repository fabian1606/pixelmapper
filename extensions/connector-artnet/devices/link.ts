/**
 * The link between a fixture and an RDM device (plan D13, D14).
 *
 * After adding, a device is a normal fixture; the link is fixture extension
 * data `extensionData['connector-artnet'].rdmLink`. Unlinking keeps the UID
 * (state `unlinked`); setting the universe back to the port's universe
 * re-links. A link is only *effective* while its state is `linked` AND the
 * fixture sits in the universe of its node port — whatever changed the
 * universe (undo, a collaborator, a changed port mapping).
 */
import type { FixtureId, FixtureSummary, Json } from '@pixelmapper/extension-api';
import type { NodeId, PortRef, RdmUid } from '../bridge/protocol-model';

/** Id of this extension (owner of the extension data). */
export const ARTNET_EXTENSION_ID = 'connector-artnet';

/** Extension data key of the link. */
export const LINK_KEY = 'rdmLink';

/** Size of one DMX universe. */
export const UNIVERSE_SIZE = 512;

/** Link data stored on a fixture. */
export interface RdmLink {
  /** RDM UID of the device. */
  uid: RdmUid;
  /** Node the device is attached to. */
  nodeId: NodeId;
  /** Node port of the device's DMX line. */
  port: PortRef;
  /** Port-Address of that port when the device was added (from the TOD). */
  portAddress: number;
  /** `unlinked` after the user moved the fixture to another universe (D14). */
  state: 'linked' | 'unlinked';
}

/** A fixture of the project with its link. */
export interface LinkedFixture {
  fixtureId: FixtureId;
  name: string;
  /** Absolute 1-based start address. */
  startAddress: number;
  channelCount: number;
  link: RdmLink;
}

/** True for a `{ bind, index }` object. */
function isPortRef(value: unknown): value is PortRef {
  const p = value as PortRef | null;
  return !!p && typeof p === 'object' && Number.isInteger(p.bind) && Number.isInteger(p.index);
}

/** The link in a fixture's extension data, or null (validates the shape). */
export function readLink(extensionData: Readonly<Record<string, Readonly<Record<string, Json>>>> | undefined): RdmLink | null {
  const raw = extensionData?.[ARTNET_EXTENSION_ID]?.[LINK_KEY] as Partial<RdmLink> | undefined;
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.uid !== 'string' || typeof raw.nodeId !== 'string' || !isPortRef(raw.port)) return null;
  return {
    uid: raw.uid,
    nodeId: raw.nodeId,
    port: { bind: raw.port.bind, index: raw.port.index },
    portAddress: typeof raw.portAddress === 'number' ? raw.portAddress : 0,
    state: raw.state === 'unlinked' ? 'unlinked' : 'linked',
  };
}

/** The link as JSON for `setExtensionData`. */
export function linkJson(link: RdmLink): Json {
  return { uid: link.uid, nodeId: link.nodeId, port: { bind: link.port.bind, index: link.port.index }, portAddress: link.portAddress, state: link.state };
}

/** Fixtures of `fixtures` that carry a link (any state). */
export function linkedFixturesOf(fixtures: readonly Readonly<FixtureSummary>[]): LinkedFixture[] {
  const out: LinkedFixture[] = [];
  for (const f of fixtures) {
    const link = readLink(f.extensionData as Record<string, Record<string, Json>> | undefined);
    if (link) out.push({ fixtureId: f.id, name: f.name, startAddress: f.startAddress, channelCount: f.channelCount, link });
  }
  return out;
}

// ── Addresses ──────────────────────────────────

/** Universe (1-based) of an absolute start address. */
export function universeOf(startAddress: number): number {
  return Math.floor((startAddress - 1) / UNIVERSE_SIZE) + 1;
}

/** Address inside its universe (1–512) of an absolute start address. */
export function localAddressOf(startAddress: number): number {
  return ((startAddress - 1) % UNIVERSE_SIZE) + 1;
}

/** Absolute start address of a local address in a universe. */
export function absoluteAddress(universe: number, localAddress: number): number {
  return (universe - 1) * UNIVERSE_SIZE + localAddress;
}
