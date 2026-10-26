// @vitest-environment node
/**
 * Helpers of the contract's state shapes (bridge contract rev 2): the
 * Port-Address of a port is the field of its current direction, and node
 * ids may carry the UDP port of a simulator (`ip:127.0.0.1:50000`).
 */
import { describe, expect, it } from 'vitest';
import { makePort } from './testing/fixtures';
import { formatNodeId, parseNodeId, portAddressOf } from './protocol-model';

describe('portAddressOf', () => {
  it('reads the field of the current direction', () => {
    const output = makePort(1, 0x13);
    expect(output).toMatchObject({ outputPortAddress: 0x13, inputPortAddress: 0x10 }); // other field: universe 0
    expect(portAddressOf(output)).toBe(0x13);
    const input = makePort(2, 0x24, { direction: 'input', canInput: true });
    expect(input).toMatchObject({ outputPortAddress: 0x20, inputPortAddress: 0x24 });
    expect(portAddressOf(input)).toBe(0x24);
    expect(portAddressOf({ direction: 'both', outputPortAddress: 5, inputPortAddress: 6 })).toBe(5);
  });
});

describe('node ids', () => {
  it('parses UIDs, MACs and IPs with an optional UDP port', () => {
    expect(parseNodeId('7FF0:8A1B2C3D')).toEqual({ kind: 'uid', uid: '7FF0:8A1B2C3D' });
    expect(parseNodeId('mac:02:7f:f0:1b:2c:3d')).toEqual({ kind: 'mac', mac: '02:7f:f0:1b:2c:3d' });
    expect(parseNodeId('ip:2.0.0.5')).toEqual({ kind: 'ip', ip: '2.0.0.5', port: null });
    expect(parseNodeId('ip:127.0.0.1:50000')).toEqual({ kind: 'ip', ip: '127.0.0.1', port: 50000 });
  });

  it('formats them for display', () => {
    expect(formatNodeId('7FF0:8A1B2C3D')).toBe('UID 7FF0:8A1B2C3D');
    expect(formatNodeId('mac:02:7f:f0:1b:2c:3d')).toBe('MAC 02:7f:f0:1b:2c:3d');
    expect(formatNodeId('ip:2.0.0.5')).toBe('IP 2.0.0.5');
    expect(formatNodeId('ip:127.0.0.1:50000')).toBe('IP 127.0.0.1:50000');
  });
});
