/**
 * Generic RDM parameter form against `FakeArtNetBackend` (plan M7.1): load
 * with a small concurrency limit, render with `pm.*` inputs, write on
 * commit, show NACK reasons, re-read after writes (the device's answer
 * wins), refresh, queued messages, offline bridge.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computed, defineComponent, h, type Component } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { PmInputName, SharedGlobals } from '@pixelmapper/extension-api';
import { BridgeCommandError } from '../../bridge/backend';
import type { RdmAddress } from '../../bridge/protocol-messages';
import { FakeArtNetBackend } from '../../bridge/testing/fake-backend';
import RdmParameterForm from './RdmParameterForm.vue';
import { NODE_UID, makeForeignDescription, makeNodeDescription } from './testing/fixtures';

// ── pm.* stubs ─────────────────────────────────

/** `pm.numberInput`: typing emits updates, `change` commits. */
const NumberStub = defineComponent({
  props: ['modelValue', 'min', 'max', 'step', 'unit', 'precision', 'disabled', 'size'],
  emits: ['update:modelValue', 'commit', 'scrubStart', 'scrubEnd'],
  setup(props, { emit }) {
    return () => h('input', {
      'data-pm': 'number', 'value': props.modelValue, 'data-unit': props.unit, 'disabled': props.disabled,
      'onInput': (e: Event) => emit('update:modelValue', Number((e.target as HTMLInputElement).value)),
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

/** `pm.select`: a native select without scrub brackets. */
const SelectStub = defineComponent({
  props: ['modelValue', 'options', 'disabled', 'size'],
  emits: ['update:modelValue', 'scrubStart', 'scrubEnd'],
  setup(props, { emit }) {
    return () => h('select', {
      'data-pm': 'select', 'value': props.modelValue, 'disabled': props.disabled,
      'onChange': (e: Event) => emit('update:modelValue', (e.target as HTMLSelectElement).value),
    }, (props.options as { value: string; label: string }[]).map(o => h('option', { value: o.value }, o.label)));
  },
});

const STUBS: Partial<Record<PmInputName, Component>> = { 'pm.numberInput': NumberStub, 'pm.toggle': ToggleStub, 'pm.select': SelectStub };

// ── Fake device ────────────────────────────────

const ADDRESS: RdmAddress = { nodeId: NODE_UID, port: { bind: 1, index: 0 }, uid: NODE_UID };

/** Current parameter data of the fake node, hex by PID. */
let device: Map<number, string>;
let backend: FakeArtNetBackend;
let wrapper: VueWrapper | null = null;

beforeEach(() => {
  globalThis.__PIXELMAPPER_SHARED__ = {
    vue: {}, pinia: {},
    api: { useReplaceable: (name: PmInputName) => computed(() => STUBS[name]) } as unknown as SharedGlobals['api'],
  };
  device = new Map([[0x0501, 'ff'], [0x8100, '02'], [0x8101, '01'], [0x8110, '00b0'], [0x8118, '28'], [0x8131, '01'], [0x8132, '00'], [0x8141, '0001']]);
  backend = new FakeArtNetBackend();
  backend.start();
  backend.handle('rdmGet', ({ pid }) => {
    const data = device.get(pid);
    if (data === undefined) throw new BridgeCommandError('nack', 'NACK', { nackReason: 0, nackName: 'UNKNOWN_PID' });
    return { data };
  });
  // The device stores even break lengths only (to prove the form shows the device's answer).
  backend.handle('rdmSet', (args) => {
    const data = 'data' in args ? args.data! : '';
    device.set(args.pid, args.pid === 0x8110 ? (Number.parseInt(data, 16) & ~1).toString(16).padStart(4, '0') : data);
    return { data: '' };
  });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  globalThis.__PIXELMAPPER_SHARED__ = undefined;
});

/** Mounts the form for the node and waits for the first load. */
async function mountForm(props: Record<string, unknown> = {}) {
  wrapper = mount(RdmParameterForm, { props: { address: ADDRESS, description: makeNodeDescription(), backend, ...props } });
  await flushPromises();
  return wrapper;
}

/** Row of a PID. */
const row = (w: VueWrapper, pid: number) => w.find(`[data-pid="0x${pid.toString(16).toUpperCase()}"]`);
/** Types into a number stub (input events only, like typing). */
async function type(w: VueWrapper, pid: number, text: string) {
  const input = row(w, pid).find('input');
  (input.element as HTMLInputElement).value = text;
  await input.trigger('input');
}

/** Commits a number stub (blur / Enter). */
async function commit(w: VueWrapper, pid: number) {
  await row(w, pid).find('input').trigger('change');
  await flushPromises();
}

/** PIDs of the requests of one type. */
const pidsOf = (type: string) => backend.requests.filter(r => r.type === type).map(r => (r.args as { pid: number }).pid);

describe('RdmParameterForm', () => {
  it('reads every readable parameter and renders it with pm.* inputs', async () => {
    const w = await mountForm();
    expect(pidsOf('rdmGet')).toEqual([0x0501, 0x8100, 0x8101, 0x8110, 0x8118, 0x8131, 0x8132, 0x8141]);
    expect(backend.requests[0]!.args).toEqual({ ...ADDRESS, pid: 0x0501 });
    expect(row(w, 0x8100).text()).toContain('Hardware revision');
    expect(row(w, 0x8100).text()).toContain('2'); // read-only: plain text
    expect(row(w, 0x8110).find('[data-pm="number"]').attributes()).toMatchObject({ 'value': '176', 'data-unit': 'µs' });
    expect(row(w, 0x8101).find('[data-pm="toggle"]').attributes('aria-checked')).toBe('true');
    expect((row(w, 0x8131).find('select').element as HTMLSelectElement).value).toBe('1');
    expect(row(w, 0x8141).text()).toContain('00 01');
    expect(w.text()).not.toContain('Firmware update');
    expect(w.text()).not.toContain('Boot catch start');
  });

  it('keeps at most `concurrency` GETs in flight', async () => {
    let running = 0;
    let peak = 0;
    backend.handle('rdmGet', async ({ pid }) => {
      peak = Math.max(peak, ++running);
      await new Promise(r => setTimeout(r, 1));
      running--;
      return { data: device.get(pid)! };
    });
    await mountForm({ concurrency: 3 });
    await new Promise(r => setTimeout(r, 20));
    expect(peak).toBe(3);
    expect(pidsOf('rdmGet')).toHaveLength(8);
  });

  it('writes on commit only, re-reads and shows the device\'s answer', async () => {
    const w = await mountForm();
    await type(w, 0x8110, '251'); // update only
    expect(pidsOf('rdmSet')).toEqual([]);
    await commit(w, 0x8110);
    expect(backend.requests.find(r => r.type === 'rdmSet')!.args).toEqual({ ...ADDRESS, pid: 0x8110, data: '00fb' });
    expect(pidsOf('rdmGet').filter(p => p === 0x8110)).toHaveLength(2); // initial + re-read
    expect(row(w, 0x8110).find('input').element.value).toBe('250'); // the device stored 250, not 251
    expect(w.emitted('written')).toEqual([[{ pid: 0x8110, value: 250 }]]);
  });

  it('writes switches and choices as one SET each', async () => {
    const w = await mountForm();
    await row(w, 0x8101).find('[data-pm="toggle"]').trigger('click');
    await row(w, 0x8131).find('select').setValue('0');
    await flushPromises();
    expect(backend.requests.filter(r => r.type === 'rdmSet').map(r => r.args)).toEqual([
      { ...ADDRESS, pid: 0x8101, data: '00' },
      { ...ADDRESS, pid: 0x8131, data: '00' },
    ]);
    expect(row(w, 0x8101).find('[data-pm="toggle"]').attributes('aria-checked')).toBe('false');
  });

  it('shows a NACK in English and keeps showing the device\'s value', async () => {
    backend.handle('rdmSet', () => { throw new BridgeCommandError('nack', 'NACK', { nackReason: 4, nackName: 'WRITE_PROTECT' }); });
    const w = await mountForm();
    await type(w, 0x8118, '30');
    await commit(w, 0x8118);
    expect(row(w, 0x8118).text()).toContain('The parameter is write-protected (device locked) (NACK WRITE_PROTECT)');
    expect(row(w, 0x8118).find('input').element.value).toBe('40');
    expect(pidsOf('rdmGet').filter(p => p === 0x8118)).toHaveLength(2);
    expect(w.emitted('written')).toBeUndefined();
  });

  it('does not send values outside the described range', async () => {
    const w = await mountForm();
    await type(w, 0x8110, '400');
    await commit(w, 0x8110);
    expect(pidsOf('rdmSet')).toEqual([]);
    expect(row(w, 0x8110).text()).toContain('Must be between 176 µs and 352 µs');
  });

  it('shows read errors per parameter', async () => {
    device.delete(0x8100);
    const w = await mountForm();
    expect(row(w, 0x8100).text()).toContain('The device does not support this parameter (NACK UNKNOWN_PID)');
    expect(row(w, 0x8110).find('input').element.value).toBe('176');
  });

  it('Refresh reads every value again', async () => {
    const w = await mountForm();
    device.set(0x8118, '2c');
    await w.findAll('button').find(b => b.text() === 'Refresh')!.trigger('click');
    await flushPromises();
    expect(pidsOf('rdmGet')).toHaveLength(16);
    expect(row(w, 0x8118).find('input').element.value).toBe('44');
  });

  it('applies queued messages of this device', async () => {
    const w = await mountForm();
    backend.emit({ type: 'rdmQueued', nodeId: NODE_UID, port: { bind: 2, index: 0 }, uid: NODE_UID, subDevice: 0, pid: 0x8131, data: '00' });
    backend.emit({ type: 'rdmQueued', nodeId: NODE_UID, port: { bind: 1, index: 0 }, uid: '7FF0:00000001', subDevice: 0, pid: 0x8118, data: '01' });
    await flushPromises();
    expect((row(w, 0x8131).find('select').element as HTMLSelectElement).value).toBe('0');
    expect(row(w, 0x8118).find('input').element.value).toBe('40');
  });

  it('waits for the bridge and loads when it connects', async () => {
    backend.stop();
    const w = await mountForm();
    expect(w.text()).toContain('The Art-Net bridge is not connected');
    expect(backend.requests).toEqual([]);
    backend.connect();
    await flushPromises();
    expect(pidsOf('rdmGet')).toHaveLength(8);
    expect(w.text()).not.toContain('not connected');
  });

  it('leaves out excluded PIDs', async () => {
    const w = await mountForm({ exclude: [0x8101, 0x0501] });
    expect(pidsOf('rdmGet')).not.toContain(0x8101);
    expect(row(w, 0x8101).exists()).toBe(false);
  });

  it('handles text, write-only values and confirmed actions of other devices', async () => {
    const foreign = makeForeignDescription();
    const address: RdmAddress = { ...ADDRESS, uid: foreign.uid, subDevice: 0 };
    device = new Map([[0x8007, '4869'], [0x8001, '0000'], [0x8002, '00'], [0x8003, '0000'], [0x8004, '000000000000'], [0x8009, 'ff'], [0x800b, '00'], [0x0403, '01'], [0x0600, '00']]);
    const w = await mountForm({ description: foreign, address });
    expect(pidsOf('rdmGet')).not.toContain(0x8008); // write-only
    expect(pidsOf('rdmGet')).not.toContain(0x8006); // action

    // Text: committed on change, sent as ASCII hex.
    const text = row(w, 0x8007).find('input');
    expect((text.element as HTMLInputElement).value).toBe('Hi');
    (text.element as HTMLInputElement).value = 'Show 1';
    await text.trigger('change');
    await flushPromises();
    expect(backend.requests.filter(r => r.type === 'rdmSet').at(-1)!.args).toEqual({ ...address, pid: 0x8007, data: '53686f772031' });
    expect((row(w, 0x8007).find('input').element as HTMLInputElement).value).toBe('Show 1');

    // Write-only: shows the default, then what was sent.
    expect(row(w, 0x8008).find('input').element.value).toBe('20');
    await type(w, 0x8008, '30');
    await commit(w, 0x8008);
    expect(backend.requests.filter(r => r.type === 'rdmSet').at(-1)!.args).toMatchObject({ pid: 0x8008, data: '0000001e' });
    expect(row(w, 0x8008).find('input').element.value).toBe('30');

    // Action: Send → Confirm → SET without data.
    await row(w, 0x8006).findAll('button').find(b => b.text() === 'Send')!.trigger('click');
    expect(pidsOf('rdmSet')).not.toContain(0x8006);
    await row(w, 0x8006).findAll('button').find(b => b.text() === 'Confirm')!.trigger('click');
    await flushPromises();
    expect(backend.requests.filter(r => r.type === 'rdmSet').at(-1)!.args).toEqual({ ...address, pid: 0x8006, data: '' });
  });
});
