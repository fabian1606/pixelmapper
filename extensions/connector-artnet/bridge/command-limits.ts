/**
 * Client-side checks of the limits in the bridge contract
 * (`pixelmapper-hardware/protocol/bridge-ws.md` §1, §6, §6 DmxRoute), so
 * requests the bridge would reject fail early with the same error code
 * (`badRequest`) — and so one invalid DMX route never makes the bridge
 * reject the whole route table (`dmxRoutes` is all-or-nothing).
 */
import type { DmxTarget } from './backend';
import type { NetInterface, RdmUid } from './protocol-model';
import { isPortAddress } from './protocol-model';
import type { CommandArgs, PublicCommandType } from './protocol-messages';

/** Largest text message the bridge accepts (larger ones end the connection). */
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

/** Byte limits of node names written with `artAddress` (ArtAddress ShortName/LongName). */
export const NODE_NAME_MAX_BYTES = { shortName: 17, longName: 63 } as const;

/** A rejected argument: contract-style field path + message. */
export interface ArgumentProblem {
  /** Argument path as the bridge reports it in `details.field`, e.g. `shortName`, `uid`. */
  field: string;
  message: string;
}

/** UTF-8 length of `text` in bytes. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Why a node name is too long for the node, or null when it fits (for UI validation too). */
export function nodeNameError(field: keyof typeof NODE_NAME_MAX_BYTES, name: string): string | null {
  const max = NODE_NAME_MAX_BYTES[field];
  return utf8ByteLength(name) > max ? `${field === 'shortName' ? 'Short name' : 'Long name'} is longer than ${max} bytes` : null;
}

/** True for the RDM broadcast and manufacturer-broadcast UIDs (`XXXX:FFFFFFFF`). */
export function isBroadcastUid(uid: RdmUid): boolean {
  return /^[0-9A-F]{4}:FFFFFFFF$/i.test(uid);
}

/**
 * The DHCP rule of `ipProg` (contract §6, rev 2): `dhcp: true` cannot be
 * combined with `ip`, `mask`, `gateway` or `resetToDefault` (the node
 * ignores them once DHCP is on), and `dhcp: false` needs `ip` (Art-Net
 * switches DHCP off by programming a static IP). The bridge answers both
 * with `badRequest`, `details.field: "dhcp"`; null when the arguments are fine.
 */
export function ipProgArgsProblem(args: Omit<CommandArgs<'ipProg'>, 'nodeId'>): ArgumentProblem | null {
  const has = (v: unknown) => v !== undefined && v !== null && v !== '' && v !== false;
  if (args.dhcp === true && (has(args.ip) || has(args.mask) || has(args.gateway) || has(args.resetToDefault))) {
    return { field: 'dhcp', message: 'DHCP cannot be combined with an IP, mask, gateway or reset' };
  }
  if (args.dhcp === false && !has(args.ip)) return { field: 'dhcp', message: 'Switching DHCP off needs a static IP' };
  return null;
}

/** Checks command arguments against the contract limits; null when fine. */
export function commandArgsProblem<C extends PublicCommandType>(type: C, args: CommandArgs<C>): ArgumentProblem | null {
  if (type === 'artAddress') {
    const a = args as CommandArgs<'artAddress'>;
    for (const field of ['shortName', 'longName'] as const) {
      const value = a[field];
      const message = typeof value === 'string' ? nodeNameError(field, value) : null;
      if (message) return { field, message };
    }
  }
  if (type === 'ipProg') {
    const problem = ipProgArgsProblem(args as CommandArgs<'ipProg'>);
    if (problem) return problem;
  }
  if (type === 'rdmDescribe' || type === 'flash') {
    const uid = (args as CommandArgs<'rdmDescribe'>).uid;
    if (isBroadcastUid(uid)) return { field: 'uid', message: `${type} needs a unicast UID` };
  }
  return null;
}

// ── DMX targets ────────────────────────────────

/** Parses a dotted quad into a 32-bit number; null when malformed. */
function ipv4(text: string): number | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    n = n * 256 + Number(part);
  }
  return n;
}

/** True for 255.255.255.255 or the directed broadcast of one of `interfaces`. */
export function isBroadcastIp(ip: string, interfaces: readonly NetInterface[]): boolean {
  const n = ipv4(ip);
  if (n === 0xffffffff) return true;
  if (n === null) return false;
  return interfaces.some((i) => {
    const addr = ipv4(i.ip);
    const mask = ipv4(i.mask);
    if (addr === null || mask === null || mask === 0xffffffff) return false;
    return ((addr & mask) | (~mask >>> 0)) >>> 0 === n;
  });
}

/**
 * Why a DMX target would make the bridge reject the route table (contract
 * DmxRoute: Port-Address 0–32767, a node id or a unicast IP — Art-Net 4
 * forbids broadcast ArtDmx), or null when it is valid.
 */
export function dmxTargetProblem(target: DmxTarget, interfaces: readonly NetInterface[]): string | null {
  if (!isPortAddress(target.portAddress)) return `Port-Address ${target.portAddress} is out of range (0–32767)`;
  if ('nodeId' in target) return target.nodeId ? null : 'DMX target without a node id';
  if (ipv4(target.ip) === null) return `"${target.ip}" is not an IPv4 address`;
  if (isBroadcastIp(target.ip, interfaces)) return `${target.ip} is a broadcast address — Art-Net 4 sends DMX unicast only`;
  return null;
}
