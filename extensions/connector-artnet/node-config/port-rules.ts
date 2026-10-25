/**
 * Rules of the node's port settings (plan D8, M7.3): what a port does now
 * (output / input / off), which modes the node lets the user choose, the
 * steps that switch it (ArtAddress, ArtInput, RDM `PORTn_ENABLED`), when a
 * switch needs a confirmation, the Net:Sub:Uni editor's arithmetic and the
 * node's per-port PIDs from `pids.toml`. Pure TypeScript, no Vue.
 */
import type { NodeState, PortRef, PortState } from '../bridge/protocol-model';
import { samePort } from '../bridge/protocol-model';

// ── Modes ──────────────────────────────────────

/** What the user can choose for a port. */
export type PortMode = 'output' | 'input' | 'off';

/** What a port does now: a mode, or what a non-switchable node reports. */
export type PortModeState = PortMode | 'both' | 'none';

/** State of the node's RDM `PORTn_ENABLED` for one port. */
export interface PortEnableState {
  /** The node is a Pixelmapper Node that lists `PORTn_ENABLED` for this port. */
  supported: boolean;
  /** Last value the node reported; null = not read yet. */
  enabled: boolean | null;
}

/** Labels of the modes. */
export const PORT_MODE_LABELS: Readonly<Record<PortModeState, string>> = {
  output: 'Output',
  input: 'Input',
  off: 'Off',
  both: 'Output + input',
  none: 'No DMX',
};

/**
 * Current mode of a port: input ports are off when ArtInput disabled them
 * (GoodInput bit 3); output ports only report “off” through RDM
 * `PORTn_ENABLED` (Art-Net has no flag for it).
 */
export function currentPortMode(port: PortState, enable: PortEnableState): PortModeState {
  if (port.direction === 'both' || port.direction === 'none') return port.direction;
  if (enable.supported && enable.enabled === false) return 'off';
  if (port.direction === 'input' && port.input.disabled) return 'off';
  return port.direction;
}

/**
 * Modes the user may choose (fewer than 2 = read-only). Output ↔ input only
 * when the node reports switchable directions (Status3 bit 3) and the port
 * can do both; “off” via ArtInput for input ports and via `PORTn_ENABLED`
 * for output ports.
 */
export function portModeOptions(node: NodeState, port: PortState, enable: PortEnableState): PortMode[] {
  if (port.direction === 'both' || port.direction === 'none') return [];
  const switchable = node.status.portDirectionSwitchable && port.canOutput && port.canInput;
  const modes: PortMode[] = switchable ? ['output', 'input'] : [port.direction];
  if (port.direction === 'input' || enable.supported) modes.push('off');
  return modes;
}

/** One request of a mode change. */
export type PortStep =
  /** ArtAddress AcDirectionTx/Rx. */
  | { kind: 'direction'; direction: 'output' | 'input' }
  /** ArtInput (input ports only). */
  | { kind: 'artInput'; disabled: boolean }
  /** RDM SET `PORTn_ENABLED`. */
  | { kind: 'rdmEnabled'; enabled: boolean };

/** The requests that switch a port from its current mode to `target`, in order. */
export function planModeChange(port: PortState, enable: PortEnableState, target: PortMode): PortStep[] {
  const current = currentPortMode(port, enable);
  if (current === target) return [];
  if (target === 'off') {
    if (port.direction === 'input') return [{ kind: 'artInput', disabled: true }];
    return enable.supported ? [{ kind: 'rdmEnabled', enabled: false }] : [];
  }
  const steps: PortStep[] = [];
  if (port.direction !== target) steps.push({ kind: 'direction', direction: target });
  if (current === 'off') {
    // ArtInput and PORTn_ENABLED change the same setting (pids.toml); ArtInput works for input ports only.
    if (target === 'input') steps.push({ kind: 'artInput', disabled: false });
    else if (enable.supported) steps.push({ kind: 'rdmEnabled', enabled: true });
  }
  return steps;
}

/**
 * Confirmation needed before switching while data flows (D8, like on the
 * node's display): `Port 2 is sending (44 fps). Output stops.` — null when
 * no data would be interrupted.
 */
export function modeChangeConfirmation(label: string, port: PortState, current: PortModeState, target: PortMode, refreshRate: number): string | null {
  if (current === target) return null;
  const outputs = current === 'output' || current === 'both';
  const inputs = current === 'input' || current === 'both';
  if (outputs && target !== 'output' && port.output.data) {
    return refreshRate > 0 ? `${label} is sending (${refreshRate} fps). Output stops.` : `${label} is sending DMX. Output stops.`;
  }
  if (inputs && target !== 'input' && port.input.data) return `${label} is receiving DMX. Input stops.`;
  return null;
}

// ── Port-Address (Net:Sub:Uni) ─────────────────

/** A 15-bit Port-Address split into its switches. */
export interface PortAddressParts {
  /** 0–127 (NetSwitch). */
  net: number;
  /** 0–15 (SubSwitch). */
  subNet: number;
  /** 0–15 (SwIn/SwOut). */
  universe: number;
}

/** Splits a Port-Address. */
export function splitPortAddress(portAddress: number): PortAddressParts {
  return { net: (portAddress >> 8) & 0x7f, subNet: (portAddress >> 4) & 0x0f, universe: portAddress & 0x0f };
}

/** Joins switches to a Port-Address (call `portAddressPartsError` first). */
export function joinPortAddress(parts: PortAddressParts): number {
  return (parts.net << 8) | (parts.subNet << 4) | parts.universe;
}

/** Why the switches are not a Port-Address, or null. */
export function portAddressPartsError(parts: PortAddressParts): string | null {
  const ok = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max;
  if (!ok(parts.net, 127)) return 'Net must be 0–127';
  if (!ok(parts.subNet, 15)) return 'Sub-Net must be 0–15';
  if (!ok(parts.universe, 15)) return 'Universe must be 0–15';
  return null;
}

/** Hint for a valid but discouraged Port-Address, or null. */
export function portAddressNote(portAddress: number): string | null {
  return portAddress === 0 ? 'Port-Address 0 is deprecated in Art-Net 4' : null;
}

/** Which address the editor shows and writes: the input address of input ports, else the output address. */
export function editedAddressField(port: PortState): 'outputPortAddress' | 'inputPortAddress' {
  return port.direction === 'input' ? 'inputPortAddress' : 'outputPortAddress';
}

/**
 * Ports of one BindIndex share NetSwitch and SubSwitch (bridge `artAddress`):
 * an address for one port must keep the Net and Sub-Net of the other ports
 * of its BindIndex. Returns the problem, or null.
 */
export function sharedSubNetError(node: NodeState, port: PortRef, field: 'outputPortAddress' | 'inputPortAddress', portAddress: number): string | null {
  const other = node.ports.find(p => p.port.bind === port.bind && !samePort(p.port, port) && p[field] >> 4 !== portAddress >> 4);
  if (!other) return null;
  const { net, subNet } = splitPortAddress(other[field]);
  return `Ports of BindIndex ${port.bind} share Net and Sub-Net: keep ${net}:${subNet}:x`;
}

// ── Node-wide settings ─────────────────────────

/** A choice with a label and an explanation. */
export interface LabeledOption<T extends string> {
  value: T;
  label: string;
  hint: string;
}

/** Failsafe modes (ArtAddress AcFailHold/Zero/Full/Scene). */
export const FAILSAFE_OPTIONS: readonly LabeledOption<'hold' | 'zero' | 'full' | 'scene'>[] = [
  { value: 'hold', label: 'Hold', hint: 'Keeps the last values when Art-Net stops' },
  { value: 'zero', label: 'Zero', hint: 'Sets all channels to 0 when Art-Net stops' },
  { value: 'full', label: 'Full', hint: 'Sets all channels to full when Art-Net stops' },
  { value: 'scene', label: 'Scene', hint: 'Plays the recorded scene when Art-Net stops' },
];

/** Merge modes (AcMergeHtp/Ltp). */
export const MERGE_OPTIONS: readonly LabeledOption<'htp' | 'ltp'>[] = [
  { value: 'htp', label: 'HTP', hint: 'Highest value of two sources wins' },
  { value: 'ltp', label: 'LTP', hint: 'Latest change of two sources wins' },
];

/** Output styles (AcStyleConst/Delta). */
export const OUTPUT_STYLE_OPTIONS: readonly LabeledOption<'continuous' | 'delta'>[] = [
  { value: 'continuous', label: 'Continuous', hint: 'DMX is sent all the time' },
  { value: 'delta', label: 'Delta', hint: 'DMX is sent only when values change' },
];

/** Confirmation of “Record scene”. */
export const RECORD_SCENE_CONFIRM = 'Record the current output of all ports as the failsafe scene? The stored scene is replaced.';

// ── Node PIDs per port (pids.toml) ─────────────

/** Ports with per-port PIDs on the Pixelmapper Node (pids.toml NODE_PORTS). */
export const NODE_PORT_COUNT = 4;

/** PIDs of port 1; port n adds n − 1 (pids.toml `repeat = 4`). */
export const NODE_PORT_PID_BASE = {
  /** PORTn_ENABLED, bool. */
  enabled: 0x8101,
  /** PORTn_DMX_BREAK, µs. */
  dmxBreak: 0x8110,
  /** PORTn_DMX_MAB, µs. */
  dmxMab: 0x8114,
  /** PORTn_DMX_RATE, Hz. */
  dmxRate: 0x8118,
  /** PORTn_RDM_BG_DISCOVERY, bool. */
  rdmBgDiscovery: 0x8120,
} as const;

/** Port number 1–4 of a Pixelmapper Node port (one port per BindIndex, contract §3), else null. */
export function nodePortNumber(port: PortRef): number | null {
  return port.index === 0 && port.bind >= 1 && port.bind <= NODE_PORT_COUNT ? port.bind : null;
}

/** `PORTn_ENABLED` and the further per-port PIDs (break, MAB, rate, background discovery) of port `n`. */
export function nodePortPids(n: number): { enabled: number; settings: number[] } {
  const b = NODE_PORT_PID_BASE;
  return { enabled: b.enabled + n - 1, settings: [b.dmxBreak, b.dmxMab, b.dmxRate, b.rdmBgDiscovery].map(pid => pid + n - 1) };
}

/** Every per-port PID of the node (left out of the Advanced section, which shows the rest). */
export const NODE_PORT_PIDS: readonly number[] = Array.from({ length: NODE_PORT_COUNT }, (_, i) => {
  const { enabled, settings } = nodePortPids(i + 1);
  return [enabled, ...settings];
}).flat().sort((a, b) => a - b);
