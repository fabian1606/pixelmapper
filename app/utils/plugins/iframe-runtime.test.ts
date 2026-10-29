// @vitest-environment node
/**
 * Custom panel bridge (plan P4.6): message validation, srcdoc construction
 * and the in-iframe runtime (executed against stubs with a real plugin).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ParamSchema } from '@pixelmapper/extension-api';
import { encodeParams } from '@pixelmapper/plugin-toolchain/params';
import { SAMPLE, SAMPLE_FIELDS } from '@pixelmapper/plugin-toolchain/runtime';
import { BUILTIN_PLUGINS } from './builtin-index';
import { buildPanelSrcdoc, coerceParam, envelope, parsePanelMessage, PANEL_PROTOCOL, stripExports } from './iframe-runtime';

const SCHEMA: ParamSchema = [
  { key: 'amount', type: 'number', min: 0, max: 1, default: 0.5, label: 'Amount' },
  { key: 'mode', type: 'enum', options: ['a', 'b'], default: 'a', label: 'Mode' },
  { key: 'pos', type: 'point', default: { x: 0.5, y: 0.5 }, label: 'Pos' },
];
const raw = (msg: unknown, channel = 'c1') => ({ protocol: PANEL_PROTOCOL, channel, msg });

describe('panel messages', () => {
  it('accepts valid messages and clamps numbers', () => {
    expect(parsePanelMessage(raw({ type: 'ready' }), 'c1', SCHEMA)).toEqual({ type: 'ready' });
    expect(parsePanelMessage(raw({ type: 'set-param', key: 'amount', value: 3 }), 'c1', SCHEMA)).toEqual({ type: 'set-param', key: 'amount', value: 1 });
    expect(parsePanelMessage(raw({ type: 'resize', height: 5000 }), 'c1', SCHEMA)).toEqual({ type: 'resize', height: 600 });
  });

  it('drops foreign channels, unknown types, unknown keys and bad values', () => {
    expect(parsePanelMessage(raw({ type: 'ready' }, 'other'), 'c1', SCHEMA)).toBeNull();
    expect(parsePanelMessage({ msg: { type: 'ready' } }, 'c1', SCHEMA)).toBeNull();
    expect(parsePanelMessage(raw({ type: 'eval', code: 'x' }), 'c1', SCHEMA)).toBeNull();
    expect(parsePanelMessage(raw({ type: 'set-param', key: 'nope', value: 1 }), 'c1', SCHEMA)).toBeNull();
    expect(parsePanelMessage(raw({ type: 'set-param', key: 'mode', value: 'z' }), 'c1', SCHEMA)).toBeNull();
    expect(parsePanelMessage(raw({ type: 'set-param', key: 'pos', value: { x: 2, y: 0 } }), 'c1', SCHEMA)).toBeNull();
  });

  it('validates curves (increasing x, unit range)', () => {
    const def: ParamSchema[number] = { key: 'c', type: 'curve', default: [], label: 'C' };
    expect(coerceParam(def, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(coerceParam(def, [{ x: 0.5, y: 0 }, { x: 0.2, y: 1 }])).toBeNull();
  });
});

describe('srcdoc', () => {
  it('strips exports, escapes script ends and sets a network-free CSP', () => {
    expect(stripExports('export function mount() {}\nexport const x = 1;')).toBe('function mount() {}\nconst x = 1;');
    const doc = buildPanelSrcdoc('c1', 'export function mount(el) { el.textContent = "</script>"; }', { '--primary': 'red' });
    expect(doc).toContain("default-src 'none'");
    expect(doc).not.toMatch(/connect-src/);
    expect(doc).toContain('--primary:red;');
    expect(doc).toContain('<\\/script>');
    expect(doc.match(/<\/script>/g)).toHaveLength(1);
  });
});

describe('in-iframe runtime', () => {
  const builtin = BUILTIN_PLUGINS.find(p => p.manifest.alias === '@pixelmapper/waveform')!;
  const wasmPath = join(__dirname, '../../../public/plugins', `${builtin.hash.slice(7)}.wasm`);

  it.skipIf(!existsSync(wasmPath))('mounts the panel, renders with the plugin and sends validated messages', () => {
    const ui = `export function mount(el, api) {
      const s = new Float32Array(${SAMPLE_FIELDS} * 4);
      for (let i = 0; i < 4; i++) { s[i * ${SAMPLE_FIELDS} + ${SAMPLE.spatial}] = i / 4; s[i * ${SAMPLE_FIELDS} + ${SAMPLE.base0}] = 1; }
      const out = api.render(s, 4);
      el.result = Array.from(out);
      el.theme = api.theme['--primary'];
      api.beginScrub();
      api.setParam('invert', true);
      api.endScrub();
      api.onParams(p => { el.params = p; });
    }`;
    const doc = buildPanelSrcdoc('c1', ui, {});
    const script = /<script>([\s\S]*)<\/script>/.exec(doc)![1]!;

    // Stubbed iframe globals.
    const sent: { msg: { type: string } }[] = [];
    let onMessage: (e: { source: unknown; data: unknown }) => void = () => {};
    const parentWin = { postMessage: (data: { msg: { type: string } }) => sent.push(data) };
    const root: Record<string, unknown> = {};
    const win = { addEventListener: (type: string, cb: typeof onMessage) => { if (type === 'message') onMessage = cb; } };
    const documentStub = { getElementById: () => root, body: {}, documentElement: { scrollHeight: 100 } };
    class RO { observe() {} }
    new Function('window', 'parent', 'document', 'ResizeObserver', script)(win, parentWin, documentStub, RO);

    expect(sent[0]!.msg.type).toBe('ready');
    const wasm = readFileSync(wasmPath);
    const encoded = encodeParams(builtin.manifest.params, {});
    onMessage({ source: parentWin, data: envelope('c1', { type: 'init', params: {}, encoded, theme: { '--primary': 'red' }, wasm: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) }) });

    const types = sent.map(s => s.msg.type);
    expect(types).not.toContain('error');
    expect(root.theme).toBe('red');
    // Wave default (a dot at the moving position, time 0) over spatial 0, .25, .5, .75 → 1, 0, 0, 0.
    expect((root.result as number[]).map(v => Math.round(v * 100) / 100 + 0)).toEqual([1, 0, 0, 0]);
    expect(types).toEqual(['ready', 'scrub', 'set-param', 'scrub']);

    onMessage({ source: parentWin, data: envelope('c1', { type: 'params', params: { shape: 'square' }, encoded }) });
    expect(root.params).toEqual({ shape: 'square' });
  });
});
