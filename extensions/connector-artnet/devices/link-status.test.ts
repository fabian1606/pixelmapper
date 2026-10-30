/**
 * Link status (plan D15) as a pure function: precedence of Unlinked,
 * Offline causes, Mismatch reasons and Connected.
 */
import { describe, expect, it } from 'vitest';
import { makeDeviceInfo } from '../bridge/testing/fixtures';
import type { DeviceEntry } from './device-store';
import type { RdmLink } from './link';
import { computeLinkStatus, isEffectivelyLinked, type LinkStatusInput } from './link-status';

const link: RdmLink = { uid: '7FF0:00000001', nodeId: 'N', port: { bind: 1, index: 0 }, portAddress: 1, state: 'linked' };

/** A present, answering device at address 1, personality 1. */
const device = (patch: Partial<DeviceEntry> = {}): DeviceEntry => ({
  uid: link.uid, nodeId: 'N', port: { bind: 1, index: 0 }, portAddress: 1, present: true, description: null,
  info: makeDeviceInfo(), lastSeen: 1, noAnswer: false, error: null, loading: false, identifying: false, ...patch,
});

/** Input of a healthy, connected fixture in U1 at 1, mode needing personality 1. */
const input = (patch: Partial<LinkStatusInput> = {}): LinkStatusInput => ({
  link, fixture: { universe: 1, localAddress: 1, modeIndex: 0 }, portUniverse: 1, portName: 'PM Node port 1',
  device: device(), bridgeConnected: true, nodeOnline: true, personalityOfMode: 1, ...patch,
});

describe('computeLinkStatus', () => {
  it('is Connected when address and personality match', () => {
    expect(computeLinkStatus(input())).toEqual({ kind: 'connected', reasons: [] });
  });

  it('is Unlinked for the stored state or another universe than the port’s', () => {
    expect(computeLinkStatus(input({ link: { ...link, state: 'unlinked' } }))).toEqual({ kind: 'unlinked', reasons: ['Unlinked — changes are not sent to the device'] });
    expect(computeLinkStatus(input({ link: { ...link, state: 'unlinked' }, fixture: { universe: 2, localAddress: 1 } })).reasons).toEqual(['Moved to another universe — changes are not sent to the device']);
    expect(computeLinkStatus(input({ fixture: { universe: 2, localAddress: 1 } })).reasons).toEqual(['The fixture is in U2, PM Node port 1 outputs U1']);
    expect(isEffectivelyLinked(link, 1, 1)).toBe(true);
    expect(isEffectivelyLinked(link, 2, 1)).toBe(false);
    expect(isEffectivelyLinked(link, 1, null)).toBe(false);
  });

  it('names the cause of Offline', () => {
    const reason = (p: Partial<LinkStatusInput>) => computeLinkStatus(input(p)).reasons[0];
    expect(reason({ portUniverse: null, bridgeConnected: false })).toBe('No Art-Net node connector for PM Node port 1');
    expect(reason({ bridgeConnected: false })).toBe('The Art-Net bridge is not connected');
    expect(reason({ nodeOnline: false })).toBe('The node is offline');
    expect(reason({ device: undefined })).toBe('The device is not on PM Node port 1');
    expect(reason({ device: device({ present: false }) })).toBe('The device is not on PM Node port 1');
    expect(reason({ device: device({ noAnswer: true }) })).toBe('The device does not answer');
    expect(reason({ device: device({ info: null }) })).toBe('Reading the device…');
  });

  it('lists every difference of a Mismatch; an unknown personality is not compared', () => {
    const status = computeLinkStatus(input({ device: device({ info: makeDeviceInfo({ dmxStartAddress: 40, currentPersonality: 2 }) }) }));
    expect(status).toEqual({ kind: 'mismatch', reasons: ['Device address 40, fixture 1', 'Device personality 2, fixture mode needs 1'] });
    expect(computeLinkStatus(input({ personalityOfMode: undefined, device: device({ info: makeDeviceInfo({ currentPersonality: 2 }) }) })).kind).toBe('connected');
  });
});
