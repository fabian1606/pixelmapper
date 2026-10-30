/**
 * Staged network settings of a node (plan D8, M7.3): the values the node
 * reported (ArtIpProgReply), the user's draft, its validation, the diff that
 * becomes the `ipProg` command, and the confirmation texts. Nothing is sent
 * while the user edits; “Apply…” sends the diff after a confirmation.
 * Pure TypeScript, no Vue.
 */
import type { IpProgArgs } from '../bridge/protocol-messages';
import { formatIpv4, gatewayError, hostAddressError, parseIpv4, parseMaskPrefix, prefixToMask } from './ipv4';

// ── Shapes ─────────────────────────────────────

/** Network settings as the node reports them (`ipProg` result = ArtIpProgReply). */
export interface NetworkSettings {
  dhcp: boolean;
  ip: string;
  mask: string;
  /** `0.0.0.0` = no gateway. */
  gateway: string;
}

/** What the user edits; text fields stay strings until validated. */
export interface NetworkDraft {
  dhcp: boolean;
  ip: string;
  /** Prefix length /8–/30; null when the node reports a mask outside that choice and it was not changed. */
  prefix: number | null;
  /** Empty = no gateway. */
  gateway: string;
}

/** Validation messages per field (English); empty object = valid. */
export interface NetworkDraftErrors {
  ip?: string;
  prefix?: string;
  gateway?: string;
}

/** The `ipProg` arguments of a change (without `nodeId`). */
export type NetworkChange = Omit<IpProgArgs, 'nodeId'>;

/** Gateway value that means “none”. */
const NO_GATEWAY = '0.0.0.0';

// ── Staging ────────────────────────────────────

/** Draft that shows the reported settings unchanged. */
export function draftFromSettings(settings: NetworkSettings): NetworkDraft {
  return {
    dhcp: settings.dhcp,
    ip: settings.ip,
    prefix: parseMaskPrefix(settings.mask),
    gateway: settings.gateway === NO_GATEWAY ? '' : settings.gateway,
  };
}

/** Gateway of a draft as a number (0 = none); null when malformed. */
function draftGateway(draft: NetworkDraft): number | null {
  return draft.gateway.trim() === '' ? 0 : parseIpv4(draft.gateway);
}

/** Validates a draft (static values are only checked when DHCP is off). */
export function validateNetworkDraft(draft: NetworkDraft): NetworkDraftErrors {
  const errors: NetworkDraftErrors = {};
  if (draft.dhcp) return errors;
  const ip = parseIpv4(draft.ip);
  if (ip === null) errors.ip = 'Enter an IPv4 address like 10.0.0.20';
  else {
    const problem = hostAddressError(ip, draft.prefix);
    if (problem) errors.ip = problem;
  }
  if (draft.prefix === null) errors.prefix = 'Choose a subnet mask';
  const gateway = draftGateway(draft);
  if (gateway === null) errors.gateway = 'Enter an IPv4 address, or leave it empty for no gateway';
  else if (ip !== null) {
    const problem = gatewayError(gateway, ip, draft.prefix);
    if (problem) errors.gateway = problem;
  }
  return errors;
}

/** True when a draft has no validation errors. */
export function isDraftValid(draft: NetworkDraft): boolean {
  return Object.keys(validateNetworkDraft(draft)).length === 0;
}

/**
 * The `ipProg` arguments that turn `current` into `draft`, or null when
 * nothing changes. Switching to static sends all three values; a static
 * edit sends only the changed ones; DHCP on sends `dhcp: true` alone (the
 * node ignores the other values then).
 */
export function networkChanges(current: NetworkSettings, draft: NetworkDraft): NetworkChange | null {
  if (draft.dhcp) return current.dhcp ? null : { dhcp: true };
  const ip = parseIpv4(draft.ip);
  const gateway = draftGateway(draft);
  const mask = draft.prefix === null ? null : formatIpv4(prefixToMask(draft.prefix));
  if (current.dhcp) {
    return {
      dhcp: false,
      ip: ip === null ? draft.ip.trim() : formatIpv4(ip),
      ...(mask !== null ? { mask } : {}),
      gateway: gateway === null ? draft.gateway.trim() : formatIpv4(gateway),
    };
  }
  const change: NetworkChange = {};
  if (ip === null || ip !== parseIpv4(current.ip)) change.ip = ip === null ? draft.ip.trim() : formatIpv4(ip);
  if (mask !== null && parseIpv4(mask) !== parseIpv4(current.mask)) change.mask = mask;
  if (gateway === null || gateway !== (parseIpv4(current.gateway) ?? 0)) change.gateway = gateway === null ? draft.gateway.trim() : formatIpv4(gateway);
  return Object.keys(change).length ? change : null;
}

/** True when the draft would make the node answer from another IP. */
export function changesAddress(current: NetworkSettings, change: NetworkChange): boolean {
  if (change.dhcp === true || change.resetToDefault) return true;
  return change.ip !== undefined && parseIpv4(change.ip) !== parseIpv4(current.ip);
}

// ── Confirmation texts ─────────────────────────

/** Warning shown with every network change that can move the node. */
export const CONNECTION_DROP_WARNING = 'Running Art-Net connections to this node drop until it answers at its new address. Pixelmapper follows the node by its identity.';

/** Short description of a draft: `10.0.0.20 / 255.255.255.0, gateway 10.0.0.1` or `DHCP`. */
export function describeDraft(draft: NetworkDraft): string {
  if (draft.dhcp) return 'DHCP';
  const mask = draft.prefix === null ? 'unchanged mask' : formatIpv4(prefixToMask(draft.prefix));
  const gateway = draft.gateway.trim() ? `gateway ${draft.gateway.trim()}` : 'no gateway';
  return `${draft.ip.trim()} / ${mask}, ${gateway}`;
}

/** Headline of the apply confirmation: what the node will use afterwards. */
export function applyConfirmMessage(draft: NetworkDraft): string {
  if (draft.dhcp) return 'The node will get its address from a DHCP server. Its new IP is not known in advance.';
  return `The node will use IP ${describeDraft(draft)}.`;
}

/** Headline of the reset confirmation. */
export const RESET_CONFIRM_MESSAGE = 'Reset the node\'s network settings to the factory defaults? The node uses DHCP again and falls back to a 2.x.x.x address without a DHCP server.';
