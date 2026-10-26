// @vitest-environment node
/**
 * Pure network rules of the node configuration (plan M7.3): IPv4 parsing,
 * the /8–/30 mask choice, address validation (network/broadcast address of
 * the mask rejected), the staged diff that becomes `ipProg`, and the
 * confirmation texts.
 */
import { describe, expect, it } from 'vitest';
import { ipProgArgsProblem } from '../bridge/command-limits';
import {
  PREFIX_OPTIONS,
  broadcastAddress,
  formatIpv4,
  gatewayError,
  hostAddressError,
  maskToPrefix,
  networkAddress,
  parseIpv4,
  parseMaskPrefix,
  prefixToMask,
} from './ipv4';
import {
  applyConfirmMessage,
  changesAddress,
  draftFromSettings,
  networkChanges,
  validateNetworkDraft,
  type NetworkDraft,
  type NetworkSettings,
} from './network-draft';

const ip = (s: string) => parseIpv4(s)!;

describe('ipv4', () => {
  it('parses and formats dotted quads strictly', () => {
    expect(formatIpv4(ip('2.27.44.61'))).toBe('2.27.44.61');
    expect(ip('255.255.255.255')).toBe(0xffffffff);
    for (const bad of ['1.2.3', '1.2.3.4.5', '256.1.1.1', '01.2.3.4', '1.2.3.x', '', ' . . . ']) expect(parseIpv4(bad)).toBeNull();
    expect(parseIpv4(' 10.0.0.9 ')).toBe(ip('10.0.0.9'));
  });

  it('converts prefixes and contiguous masks', () => {
    expect(formatIpv4(prefixToMask(8))).toBe('255.0.0.0');
    expect(formatIpv4(prefixToMask(30))).toBe('255.255.255.252');
    expect(maskToPrefix(ip('255.255.255.0'))).toBe(24);
    expect(maskToPrefix(0)).toBe(0);
    expect(maskToPrefix(0xffffffff)).toBe(32);
    expect(maskToPrefix(ip('255.0.255.0'))).toBeNull();
    expect(parseMaskPrefix('255.255.240.0')).toBe(20);
  });

  it('offers /8 to /30, shown dotted', () => {
    expect(PREFIX_OPTIONS).toHaveLength(23);
    expect(PREFIX_OPTIONS[0]).toEqual({ prefix: 8, mask: '255.0.0.0', label: '255.0.0.0 (/8)' });
    expect(PREFIX_OPTIONS.at(-1)!.label).toBe('255.255.255.252 (/30)');
  });

  it('computes network and broadcast addresses', () => {
    expect(formatIpv4(networkAddress(ip('10.1.2.3'), 16))).toBe('10.1.0.0');
    expect(formatIpv4(broadcastAddress(ip('10.1.2.3'), 16))).toBe('10.1.255.255');
  });

  it('rejects the network and broadcast address of the mask and special ranges', () => {
    expect(hostAddressError(ip('10.0.0.20'), 24)).toBeNull();
    expect(hostAddressError(ip('10.0.0.0'), 24)).toMatch(/network address/);
    expect(hostAddressError(ip('10.0.0.255'), 24)).toMatch(/broadcast address/);
    expect(hostAddressError(ip('10.0.0.255'), 16)).toBeNull(); // a host in a /16
    expect(hostAddressError(ip('2.255.255.255'), 8)).toMatch(/broadcast/);
    expect(hostAddressError(ip('127.0.0.1'), 8)).toMatch(/Loopback/);
    expect(hostAddressError(ip('0.1.2.3'), null)).toMatch(/0\.x/);
    expect(hostAddressError(ip('239.1.1.1'), null)).toMatch(/Multicast/);
  });

  it('checks the gateway against the subnet', () => {
    expect(gatewayError(0, ip('10.0.0.20'), 24)).toBeNull();
    expect(gatewayError(ip('10.0.0.1'), ip('10.0.0.20'), 24)).toBeNull();
    expect(gatewayError(ip('10.0.1.1'), ip('10.0.0.20'), 24)).toMatch(/subnet/);
    expect(gatewayError(ip('10.0.0.20'), ip('10.0.0.20'), 24)).toMatch(/own address/);
    expect(gatewayError(ip('10.0.0.255'), ip('10.0.0.20'), 24)).toMatch(/broadcast/);
  });
});

/** Settings of a node with a static address. */
const STATIC: NetworkSettings = { dhcp: false, ip: '10.0.0.20', mask: '255.255.255.0', gateway: '10.0.0.1' };
/** Settings of a node on DHCP. */
const DHCP: NetworkSettings = { dhcp: true, ip: '192.168.1.44', mask: '255.255.255.0', gateway: '0.0.0.0' };
/** A draft from `settings` with overrides. */
const draft = (settings: NetworkSettings, o: Partial<NetworkDraft> = {}): NetworkDraft => ({ ...draftFromSettings(settings), ...o });

describe('network draft', () => {
  it('starts from the node\'s report (no gateway = empty)', () => {
    expect(draftFromSettings(DHCP)).toEqual({ dhcp: true, ip: '192.168.1.44', prefix: 24, gateway: '' });
    expect(draftFromSettings({ ...STATIC, mask: '255.0.255.0' }).prefix).toBeNull();
  });

  it('has no change while nothing is edited', () => {
    expect(networkChanges(STATIC, draft(STATIC))).toBeNull();
    expect(networkChanges(DHCP, draft(DHCP, { ip: 'garbage' }))).toBeNull(); // static fields ignored under DHCP
  });

  it('sends only the changed static values', () => {
    expect(networkChanges(STATIC, draft(STATIC, { ip: '10.0.0.30' }))).toEqual({ ip: '10.0.0.30' });
    expect(networkChanges(STATIC, draft(STATIC, { prefix: 16, gateway: '' }))).toEqual({ mask: '255.255.0.0', gateway: '0.0.0.0' });
  });

  it('switches to DHCP with dhcp alone and to static with all values', () => {
    expect(networkChanges(STATIC, draft(STATIC, { dhcp: true }))).toEqual({ dhcp: true });
    expect(networkChanges(DHCP, draft(DHCP, { dhcp: false, ip: '192.168.1.50', gateway: '192.168.1.1' })))
      .toEqual({ dhcp: false, ip: '192.168.1.50', mask: '255.255.255.0', gateway: '192.168.1.1' });
  });

  it('keeps a mask outside the choice unless it is changed', () => {
    const odd = { ...STATIC, mask: '255.0.255.0' };
    expect(networkChanges(odd, draft(odd, { ip: '10.0.0.30' }))).toEqual({ ip: '10.0.0.30' });
    expect(validateNetworkDraft(draft(odd)).prefix).toBe('Choose a subnet mask');
  });

  it('validates static values only', () => {
    expect(validateNetworkDraft(draft(STATIC))).toEqual({});
    expect(validateNetworkDraft(draft(DHCP, { ip: 'x' }))).toEqual({});
    expect(validateNetworkDraft(draft(STATIC, { ip: '10.0.0' })).ip).toMatch(/IPv4 address/);
    expect(validateNetworkDraft(draft(STATIC, { ip: '10.0.0.255' })).ip).toMatch(/broadcast address/);
    expect(validateNetworkDraft(draft(STATIC, { ip: '10.0.0.0' })).ip).toMatch(/network address/);
    expect(validateNetworkDraft(draft(STATIC, { gateway: '10.9.0.1' })).gateway).toMatch(/subnet/);
    expect(validateNetworkDraft(draft(STATIC, { gateway: 'router' })).gateway).toMatch(/leave it empty/);
  });

  it('knows which changes move the node', () => {
    expect(changesAddress(STATIC, { ip: '10.0.0.30' })).toBe(true);
    expect(changesAddress(STATIC, { mask: '255.255.0.0' })).toBe(false);
    expect(changesAddress(STATIC, { dhcp: true })).toBe(true);
    expect(changesAddress(STATIC, { resetToDefault: true })).toBe(true);
  });

  it('produces only changes the bridge accepts (DHCP rule, contract rev 2)', () => {
    for (const change of [
      networkChanges(STATIC, draft(STATIC, { dhcp: true })),
      networkChanges(DHCP, draft(DHCP, { dhcp: false, ip: '192.168.1.50' })),
      networkChanges(STATIC, draft(STATIC, { ip: '10.0.0.30', prefix: 16 })),
    ]) expect(ipProgArgsProblem(change!)).toBeNull();
  });

  it('names the new IP in the confirmation', () => {
    expect(applyConfirmMessage(draft(STATIC, { ip: '10.0.0.30' }))).toBe('The node will use IP 10.0.0.30 / 255.255.255.0, gateway 10.0.0.1.');
    expect(applyConfirmMessage(draft(STATIC, { dhcp: true }))).toMatch(/DHCP/);
  });
});
