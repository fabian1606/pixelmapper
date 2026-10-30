// @vitest-environment node
/**
 * Pure port and device rules of the node configuration (plan M7.3): modes
 * and the requests that switch them, the confirmation while data flows,
 * Net:Sub:Uni, the shared Sub-Net of a BindIndex, the per-port PIDs from
 * pids.toml, and name limits.
 */
import { describe, expect, it } from 'vitest';
import { BridgeCommandError } from '../bridge/backend';
import { makeNode, makePort, makeStatus } from '../bridge/testing/fixtures';
import type { PortState } from '../bridge/protocol-model';
import {
  NODE_PORT_PIDS,
  currentPortMode,
  joinPortAddress,
  modeChangeConfirmation,
  nodePortNumber,
  nodePortPids,
  planModeChange,
  portAddressNote,
  portAddressPartsError,
  failsafeHint,
  portModeOptions,
  portsSharingFailsafe,
  recordSceneConfirm,
  sharedSubNetError,
  splitPortAddress,
  type PortEnableState,
} from './port-rules';
import { describeNodeError, formatVersInfo, nameError } from './device-rules';

/** A port that can switch between output and input. */
const port = (o: Partial<PortState> = {}) => makePort(2, 2, { canInput: true, ...o });
const ON: PortEnableState = { supported: true, enabled: true };
const NO_RDM: PortEnableState = { supported: false, enabled: null };

describe('port modes', () => {
  it('reads the mode from PortTypes, GoodInput and PORTn_ENABLED', () => {
    expect(currentPortMode(port(), ON)).toBe('output');
    expect(currentPortMode(port(), { supported: true, enabled: false })).toBe('off');
    expect(currentPortMode(port({ direction: 'input' }), NO_RDM)).toBe('input');
    expect(currentPortMode(port({ direction: 'input', input: { data: false, disabled: true, errors: false, sacn: false } }), NO_RDM)).toBe('off');
    expect(currentPortMode(port({ direction: 'both' }), ON)).toBe('both');
  });

  it('offers a direction switch only when the node reports it', () => {
    expect(portModeOptions(makeNode(), port(), ON)).toEqual(['output', 'input', 'off']);
    expect(portModeOptions(makeNode(), port(), NO_RDM)).toEqual(['output', 'input']);
    expect(portModeOptions(makeNode({ status: makeStatus({ portDirectionSwitchable: false }) }), port(), NO_RDM)).toEqual(['output']);
    expect(portModeOptions(makeNode(), port({ canInput: false }), ON)).toEqual(['output', 'off']);
    expect(portModeOptions(makeNode(), port({ direction: 'input' }), NO_RDM)).toEqual(['output', 'input', 'off']); // ArtInput
    expect(portModeOptions(makeNode(), port({ direction: 'both' }), ON)).toEqual([]);
  });

  it('plans ArtAddress, ArtInput and PORTn_ENABLED steps', () => {
    expect(planModeChange(port(), ON, 'input')).toEqual([{ kind: 'direction', direction: 'input' }]);
    expect(planModeChange(port(), ON, 'off')).toEqual([{ kind: 'rdmEnabled', enabled: false }]);
    expect(planModeChange(port({ direction: 'input' }), NO_RDM, 'off')).toEqual([{ kind: 'artInput', disabled: true }]);
    const off: PortEnableState = { supported: true, enabled: false };
    expect(planModeChange(port(), off, 'output')).toEqual([{ kind: 'rdmEnabled', enabled: true }]);
    expect(planModeChange(port(), off, 'input')).toEqual([{ kind: 'direction', direction: 'input' }, { kind: 'artInput', disabled: false }]);
    expect(planModeChange(port(), ON, 'output')).toEqual([]);
  });

  it('asks before stopping a data flow', () => {
    const sending = port({ output: { ...makePort(2, 2).output, data: true } });
    expect(modeChangeConfirmation('Port 2', sending, 'output', 'input', 44)).toBe('Port 2 is sending (44 fps). Output stops.');
    expect(modeChangeConfirmation('Port 2', sending, 'output', 'off', 0)).toBe('Port 2 is sending DMX. Output stops.');
    expect(modeChangeConfirmation('Port 2', port(), 'output', 'input', 44)).toBeNull();
    const receiving = port({ direction: 'input', input: { data: true, disabled: false, errors: false, sacn: false } });
    expect(modeChangeConfirmation('Port 2', receiving, 'input', 'output', 44)).toBe('Port 2 is receiving DMX. Input stops.');
    expect(modeChangeConfirmation('Port 2', sending, 'off', 'output', 44)).toBeNull();
  });
});

describe('Port-Address', () => {
  it('splits and joins Net:Sub:Uni', () => {
    expect(splitPortAddress(0x1234)).toEqual({ net: 0x12, subNet: 3, universe: 4 });
    expect(joinPortAddress({ net: 127, subNet: 15, universe: 15 })).toBe(0x7fff);
    expect(portAddressPartsError({ net: 128, subNet: 0, universe: 0 })).toMatch(/Net/);
    expect(portAddressPartsError({ net: 0, subNet: 0, universe: 1.5 })).toMatch(/Universe/);
    expect(portAddressNote(0)).toMatch(/deprecated/);
    expect(portAddressNote(1)).toBeNull();
  });

  it('keeps the shared Net/Sub-Net of a BindIndex', () => {
    // A node with two ports in BindIndex 1 at Sub-Net 0.
    const node = makeNode({ ports: [makePort(1, 1), { ...makePort(1, 2), port: { bind: 1, index: 1 } }] });
    expect(sharedSubNetError(node, { bind: 1, index: 0 }, 5)).toBeNull();
    expect(sharedSubNetError(node, { bind: 1, index: 0 }, 0x15)).toMatch(/keep 0:0:x/);
    expect(sharedSubNetError(makeNode(), { bind: 1, index: 0 }, 0x15)).toBeNull(); // one port per BindIndex
  });

  it('compares with the address of the other port\'s current direction (rev 2)', () => {
    // The other port is an input at 0:2:3; its output field only carries Net/Sub-Net with universe 0.
    const input = { ...makePort(1, 0x23, { direction: 'input', canInput: true }), port: { bind: 1, index: 1 } };
    expect(input.outputPortAddress).toBe(0x20);
    const node = makeNode({ ports: [makePort(1, 0x21), input] });
    expect(sharedSubNetError(node, { bind: 1, index: 0 }, 0x25)).toBeNull();
    expect(sharedSubNetError(node, { bind: 1, index: 0 }, 0x35)).toMatch(/keep 0:2:x/);
  });
});

describe('failsafe per port (contract rev 2)', () => {
  it('names the ports of the same BindIndex that the AcFail* commands affect', () => {
    expect(portsSharingFailsafe(makeNode(), { bind: 2, index: 0 })).toEqual([]); // Pixelmapper Node: one port per BindIndex
    const multi = makeNode({ ports: [makePort(1, 1), { ...makePort(1, 2), port: { bind: 1, index: 1 } }] });
    expect(portsSharingFailsafe(multi, { bind: 1, index: 0 }).map(p => p.port)).toEqual([{ bind: 1, index: 1 }]);
  });

  it('explains the mode, also when the bridge does not report it', () => {
    expect(failsafeHint('zero')).toMatch(/0 when Art-Net stops/);
    expect(failsafeHint(null)).toMatch(/unknown/);
  });

  it('asks before recording the scene of a port', () => {
    expect(recordSceneConfirm('Port 2')).toBe('Record the current output of Port 2 as the failsafe scene? The stored scene is replaced.');
    expect(recordSceneConfirm('Port 1.1', ['Port 1.2'])).toMatch(/Port 1\.1 and Port 1\.2 \(one BindIndex\)/);
  });
});

describe('node port PIDs (pids.toml)', () => {
  it('maps BindIndex 1–4 to PORTn PIDs', () => {
    expect(nodePortNumber({ bind: 3, index: 0 })).toBe(3);
    expect(nodePortNumber({ bind: 5, index: 0 })).toBeNull();
    expect(nodePortNumber({ bind: 1, index: 1 })).toBeNull();
    expect(nodePortPids(1)).toEqual({ enabled: 0x8101, settings: [0x8110, 0x8114, 0x8118, 0x8120, 0x8160] });
    expect(nodePortPids(4)).toEqual({ enabled: 0x8104, settings: [0x8113, 0x8117, 0x811b, 0x8123, 0x8163] });
    expect(NODE_PORT_PIDS).toHaveLength(24);
    expect(NODE_PORT_PIDS).not.toContain(0x8124); // RDM_BG_DISCOVERY_INTERVAL is node-wide
  });
});

describe('device rules', () => {
  it('limits names to printable ASCII within the byte limit', () => {
    expect(nameError('PM Node', 17)).toBeNull();
    expect(nameError('', 17)).toBe('Enter a name');
    expect(nameError('', 32, true)).toBeNull();
    expect(nameError('x'.repeat(18), 17)).toBe('At most 17 characters (18)');
    expect(nameError('Bühne', 17)).toMatch(/ASCII/);
  });

  it('formats VersInfo and node errors', () => {
    expect(formatVersInfo(0x0102)).toBe('1.2');
    expect(describeNodeError(new BridgeCommandError('timeout', 'x'))).toBe('The node did not answer');
    expect(describeNodeError(new BridgeCommandError('invalidPortAddress', 'x'))).toMatch(/share Net and Sub-Net/);
    expect(describeNodeError(new BridgeCommandError('nack', 'x', { nackReason: 6 }))).toMatch(/NACK DATA_OUT_OF_RANGE/);
  });
});
