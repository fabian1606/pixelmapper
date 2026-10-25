/**
 * Status of a linked fixture (plan D15, M6.7): Connected, Mismatch (the
 * device reports another address/personality than the fixture's patch),
 * Offline, Unlinked. Pure — the inputs come from the fixture view, the
 * device store and the node connector.
 */
import type { DeviceEntry } from './device-store';
import type { RdmLink } from './link';

/** Status kinds shown by the badge. */
export type LinkStatusKind = 'connected' | 'mismatch' | 'offline' | 'unlinked';

/** A status with the reasons shown in its tooltip. */
export interface LinkStatus {
  kind: LinkStatusKind;
  /** Short user-facing explanations (English). */
  reasons: string[];
}

/** Everything the status depends on. */
export interface LinkStatusInput {
  link: RdmLink;
  /** The fixture's patch: universe and address inside it, mode index if it has a definition. */
  fixture: { universe: number; localAddress: number; modeIndex?: number };
  /** Universe of the link's node port; null when the node has no connector or the port no output. */
  portUniverse: number | null;
  /** Display name of the node port, e.g. "PM Node port 2". */
  portName: string;
  device: DeviceEntry | undefined;
  bridgeConnected: boolean;
  nodeOnline: boolean;
  /** Personality the fixture's mode needs; undefined when unknown. */
  personalityOfMode: number | undefined;
}

/**
 * True while the link is in force: state `linked` and the fixture sits in
 * the universe of its node port (D14). Only then are patch changes pushed.
 */
export function isEffectivelyLinked(link: RdmLink, fixtureUniverse: number, portUniverse: number | null): boolean {
  return link.state === 'linked' && portUniverse !== null && fixtureUniverse === portUniverse;
}

/** Computes the badge status. */
export function computeLinkStatus(input: LinkStatusInput): LinkStatus {
  const { link, fixture, portUniverse, device } = input;
  if (link.state === 'unlinked') {
    // Unlinked by moving it out of the port's universe (D14), or explicitly in the inspector.
    const moved = portUniverse !== null && fixture.universe !== portUniverse;
    return { kind: 'unlinked', reasons: [moved ? 'Moved to another universe — changes are not sent to the device' : 'Unlinked — changes are not sent to the device'] };
  }
  if (portUniverse !== null && fixture.universe !== portUniverse) {
    return { kind: 'unlinked', reasons: [`The fixture is in U${fixture.universe}, ${input.portName} outputs U${portUniverse}`] };
  }
  // Without a connector there is no bridge connection either: name the actual cause.
  if (portUniverse === null) return { kind: 'offline', reasons: [`No Art-Net node connector for ${input.portName}`] };
  if (!input.bridgeConnected) return { kind: 'offline', reasons: ['The Art-Net bridge is not connected'] };
  if (!input.nodeOnline) return { kind: 'offline', reasons: ['The node is offline'] };
  if (!device?.present) return { kind: 'offline', reasons: [`The device is not on ${input.portName}`] };
  if (device.noAnswer) return { kind: 'offline', reasons: ['The device does not answer'] };
  if (!device.info) return { kind: 'offline', reasons: ['Reading the device…'] };

  const reasons: string[] = [];
  if (device.info.dmxStartAddress !== fixture.localAddress) {
    reasons.push(`Device address ${device.info.dmxStartAddress}, fixture ${fixture.localAddress}`);
  }
  if (input.personalityOfMode !== undefined && device.info.currentPersonality !== input.personalityOfMode) {
    reasons.push(`Device personality ${device.info.currentPersonality}, fixture mode needs ${input.personalityOfMode}`);
  }
  return reasons.length ? { kind: 'mismatch', reasons } : { kind: 'connected', reasons: [] };
}
