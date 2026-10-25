/**
 * Test harness of the node configuration components (plan M7.3): `pm.*`
 * stubs behind a host stub, a `FakeArtNetBackend` + `NodeDirectory` with
 * one Pixelmapper Node, and a fake RDM responder for the node's UID
 * (parameter data by PID, description from pids.toml). Not used at runtime.
 */
import { computed, defineComponent, h, type Component } from 'vue';
import type { PmInputName, SharedGlobals } from '@pixelmapper/extension-api';
import { BridgeCommandError } from '../../bridge/backend';
import { NodeDirectory } from '../../bridge/node-directory';
import type { NodeState, RdmDeviceDescription } from '../../bridge/protocol-model';
import { FakeArtNetBackend } from '../../bridge/testing/fake-backend';
import { makeNode } from '../../bridge/testing/fixtures';
import { NODE_UID, makeDescription, pd } from '../../rdm/parameter-form/testing/fixtures';

// ── pm.* stubs ─────────────────────────────────

/** `pm.numberInput`: `change` commits the typed number; `data-value` = the value the component shows. */
const NumberStub = defineComponent({
  props: ['modelValue', 'min', 'max', 'step', 'unit', 'precision', 'disabled', 'size'],
  emits: ['update:modelValue', 'commit', 'scrubStart', 'scrubEnd'],
  setup(props, { emit }) {
    return () => h('input', {
      'data-pm': 'number', 'data-value': String(props.modelValue), 'value': props.modelValue, 'disabled': props.disabled,
      'onChange': (e: Event) => emit('commit', Number((e.target as HTMLInputElement).value)),
    });
  },
});

/** `pm.toggle`: a flip bracketed by scrubStart/scrubEnd, like the core default. */
const ToggleStub = defineComponent({
  props: ['modelValue', 'disabled', 'size'],
  emits: ['update:modelValue', 'scrubStart', 'scrubEnd'],
  setup(props, { emit }) {
    return () => h('button', {
      'data-pm': 'toggle', 'aria-checked': String(props.modelValue), 'disabled': props.disabled,
      'onClick': () => { emit('scrubStart'); emit('update:modelValue', !props.modelValue); emit('scrubEnd'); },
    });
  },
});

/** `pm.select`: a native select; `data-value` = the value the component shows (not the DOM's last choice). */
const SelectStub = defineComponent({
  props: ['modelValue', 'options', 'disabled', 'size', 'variant'],
  emits: ['update:modelValue', 'scrubStart', 'scrubEnd'],
  setup(props, { emit }) {
    return () => h('select', {
      'data-pm': 'select', 'data-value': props.modelValue, 'value': props.modelValue, 'disabled': props.disabled,
      'onChange': (e: Event) => emit('update:modelValue', (e.target as HTMLSelectElement).value),
    }, (props.options as { value: string; label: string }[]).map(o => h('option', { value: o.value }, o.label)));
  },
});

const STUBS: Partial<Record<PmInputName, Component>> = { 'pm.numberInput': NumberStub, 'pm.toggle': ToggleStub, 'pm.select': SelectStub };

/** Installs the host stub with the `pm.*` stubs. */
export function installHost(): void {
  globalThis.__PIXELMAPPER_SHARED__ = {
    vue: {}, pinia: {},
    api: { useReplaceable: (name: PmInputName) => computed(() => STUBS[name]) } as unknown as SharedGlobals['api'],
  };
}

/** Removes the host stub. */
export function uninstallHost(): void {
  globalThis.__PIXELMAPPER_SHARED__ = undefined;
}

// ── Node and RDM responder ─────────────────────

export { NODE_UID };

/** PARAMETER_DESCRIPTIONs of the node as pids.toml generates them (all ports + node-wide PIDs). */
export function nodeDescription(o: Partial<RdmDeviceDescription> = {}): RdmDeviceDescription {
  const perPort = [1, 2, 3, 4].flatMap(n => [
    pd(0x8100 + n, `Port ${n} enabled`, { maxValue: 1, defaultValue: 1 }),
    pd(0x810f + n, `Port ${n} DMX break`, { dataTypeName: 'uint16', pdlSize: 2, unit: 0x15, prefix: 0x04, minValue: 176, maxValue: 352, defaultValue: 176 }),
    pd(0x8113 + n, `Port ${n} DMX mark after break`, { dataTypeName: 'uint16', pdlSize: 2, unit: 0x15, prefix: 0x04, minValue: 12, maxValue: 88, defaultValue: 16 }),
    pd(0x8117 + n, `Port ${n} DMX refresh rate`, { unit: 0x08, minValue: 1, maxValue: 44, defaultValue: 40 }),
    pd(0x811f + n, `Port ${n} background discovery`, { maxValue: 1, defaultValue: 1 }),
  ]);
  const descriptions = [
    pd(0x8100, 'Hardware revision', { commandClass: 'get' }),
    ...perPort,
    pd(0x8124, 'Background discovery interval', { dataTypeName: 'uint16', pdlSize: 2, unit: 0x15, minValue: 1, maxValue: 600, defaultValue: 3 }),
  ];
  return makeDescription(NODE_UID, 0x0002, [0x0020, 0x0030, 0x0082, 0x0501, ...descriptions.map(d => d.pid)], descriptions, {
    softwareVersionLabel: '1.2.0', bootSoftwareVersionLabel: 'boot 3', deviceModelDescription: 'Pixelmapper Node', ...o,
  });
}

/** Default parameter data of the fake node (hex by PID): ports enabled, timing defaults. */
function defaultRdmData(): Map<number, string> {
  const data = new Map<number, string>([[0x0501, 'ff'], [0x8100, '00'], [0x8124, '0003'], [0x0082, '504d204e6f6465']]);
  for (let n = 1; n <= 4; n++) {
    data.set(0x8100 + n, '01');
    data.set(0x810f + n, '00b0');
    data.set(0x8113 + n, '0010');
    data.set(0x8117 + n, '28');
    data.set(0x811f + n, '01');
  }
  return data;
}

/** A connected fake bridge that knows one node, plus the node's RDM data. */
export interface NodeHarness {
  backend: FakeArtNetBackend;
  directory: NodeDirectory;
  /** Current parameter data of the node's RDM responder (hex by PID). */
  rdm: Map<number, string>;
  /** Replaces the node (as a `node` event). */
  update: (overrides: Partial<NodeState>) => void;
  /** PIDs of the requests of one type. */
  pidsOf: (type: 'rdmGet' | 'rdmSet') => number[];
  /** Arguments of the requests of one type. */
  argsOf: (type: string) => unknown[];
}

/** Sets up the bridge, the directory and the node (see `NodeHarness`). */
export async function setupNode(node: Partial<NodeState> = {}, description: RdmDeviceDescription = nodeDescription()): Promise<NodeHarness> {
  const backend = new FakeArtNetBackend();
  const directory = new NodeDirectory(backend);
  const rdm = defaultRdmData();
  backend.start();
  backend.handle('rdmDescribe', () => description);
  backend.handle('rdmGet', ({ pid }) => {
    const data = rdm.get(pid);
    if (data === undefined) throw new BridgeCommandError('nack', 'NACK', { nackReason: 0, nackName: 'UNKNOWN_PID' });
    return { data };
  });
  backend.handle('rdmSet', (args) => {
    // Hex data as sent; decoded string values (DEVICE_LABEL) as ASCII hex.
    const text = typeof args.value === 'string' ? [...args.value].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('') : '';
    rdm.set(args.pid, args.data !== undefined ? args.data : text);
    return { data: '' };
  });
  let current = makeNode(node);
  backend.emit({ type: 'node', node: current });
  // Let the directory take the bridge's snapshot (macrotask: after all pending promises).
  await new Promise(resolve => setTimeout(resolve, 0));
  return {
    backend,
    directory,
    rdm,
    update: (overrides) => {
      current = { ...current, ...overrides };
      backend.emit({ type: 'node', node: current });
    },
    pidsOf: type => backend.requests.filter(r => r.type === type).map(r => (r.args as { pid: number }).pid),
    argsOf: type => backend.requests.filter(r => r.type === type).map(r => r.args),
  };
}
