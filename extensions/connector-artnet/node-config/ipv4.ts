/**
 * IPv4 primitives of the node's network settings (plan M7.3): dotted-quad
 * parsing, prefix ↔ mask, and the address rules the Network section checks
 * before anything is sent with ArtIpProg. Pure TypeScript, no Vue.
 *
 * Addresses are handled as unsigned 32-bit numbers (`>>> 0`).
 */

// ── Parsing and formatting ─────────────────────

/** Smallest prefix offered in the mask choice (255.0.0.0, the Art-Net 2.x/8 net). */
export const MIN_PREFIX = 8;

/** Largest prefix offered (/30: 2 hosts; /31 and /32 leave no usable host range). */
export const MAX_PREFIX = 30;

/**
 * Parses a dotted quad (`"10.0.0.9"`) to an unsigned 32-bit number; null when
 * malformed. Leading zeros are rejected (`"010"` reads as octal elsewhere).
 */
export function parseIpv4(text: string): number | null {
  const parts = text.trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/** Formats an unsigned 32-bit address as a dotted quad. */
export function formatIpv4(value: number): string {
  const v = value >>> 0;
  return [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff].join('.');
}

// ── Masks ──────────────────────────────────────

/** Mask of a prefix length (0–32) as an unsigned 32-bit number. */
export function prefixToMask(prefix: number): number {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

/** Prefix length of a contiguous mask; null for a non-contiguous one (e.g. 255.0.255.0). */
export function maskToPrefix(mask: number): number | null {
  const m = mask >>> 0;
  const inverted = ~m >>> 0;
  // A contiguous mask's inverse is 2^n − 1 (all host bits set, from the right).
  if ((inverted & (inverted + 1)) !== 0) return null;
  let prefix = 32;
  while (prefix > 0 && ((m >>> (32 - prefix)) & 1) === 0) prefix--;
  return prefix;
}

/** Prefix length of a dotted-quad mask; null when malformed or non-contiguous. */
export function parseMaskPrefix(text: string): number | null {
  const mask = parseIpv4(text);
  return mask === null ? null : maskToPrefix(mask);
}

/** One entry of the subnet mask choice. */
export interface PrefixOption {
  prefix: number;
  /** Dotted mask, e.g. `255.255.255.0`. */
  mask: string;
  /** `255.255.255.0 (/24)`. */
  label: string;
}

/** The mask choice /8 … /30, shown dotted (plan M7.3). */
export const PREFIX_OPTIONS: readonly PrefixOption[] = Array.from({ length: MAX_PREFIX - MIN_PREFIX + 1 }, (_, i) => {
  const prefix = MIN_PREFIX + i;
  const mask = formatIpv4(prefixToMask(prefix));
  return { prefix, mask, label: `${mask} (/${prefix})` };
});

/** Network address of `ip` in a /`prefix` net. */
export function networkAddress(ip: number, prefix: number): number {
  return (ip & prefixToMask(prefix)) >>> 0;
}

/** Directed broadcast address of `ip` in a /`prefix` net. */
export function broadcastAddress(ip: number, prefix: number): number {
  return (networkAddress(ip, prefix) | ~prefixToMask(prefix)) >>> 0;
}

// ── Rules ──────────────────────────────────────

/**
 * Why `ip` cannot be a node's static address, or null. With a known prefix
 * the network and broadcast address of that net are rejected too.
 */
export function hostAddressError(ip: number, prefix: number | null): string | null {
  const first = ip >>> 24;
  if (first === 0) return 'Addresses 0.x.x.x are not usable';
  if (first === 127) return 'Loopback addresses (127.x.x.x) are not usable';
  if (first >= 224) return 'Multicast and reserved addresses (224.0.0.0 and above) are not usable';
  if (prefix === null) return null;
  if (ip === networkAddress(ip, prefix)) return `${formatIpv4(ip)} is the network address of this subnet`;
  if (ip === broadcastAddress(ip, prefix)) return `${formatIpv4(ip)} is the broadcast address of this subnet`;
  return null;
}

/**
 * Why `gateway` cannot be the default gateway of `ip`/`prefix`, or null.
 * 0 (0.0.0.0) means “no gateway” and is always allowed.
 */
export function gatewayError(gateway: number, ip: number, prefix: number | null): string | null {
  if (gateway === 0) return null;
  if (gateway === ip) return 'The gateway cannot be the node\'s own address';
  if (prefix === null) return null;
  if (networkAddress(gateway, prefix) !== networkAddress(ip, prefix)) return 'The gateway must be in the node\'s subnet';
  if (gateway === networkAddress(ip, prefix) || gateway === broadcastAddress(ip, prefix)) return 'The gateway cannot be the network or broadcast address';
  return null;
}
