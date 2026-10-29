// @vitest-environment node
/**
 * Canvas hints in param `ui` (plan M4): `canvas: 'point'` on point params,
 * `canvas: 'radius'` with an anchor on number params.
 */
import { describe, expect, it } from 'vitest';
import { paramCanvasHint, paramUiInput } from '@pixelmapper/extension-api';
import { validateManifest } from './manifest';

/** A valid manifest with the given params. */
const manifest = (params: unknown[]) => ({
  schema: 1, kind: 'modifier', alias: '@test/canvas', name: 'Canvas', version: '1.0.0', apiVersion: '^1.1.0',
  description: 'Test manifest with canvas hints.', signatures: ['scalar'], output: 'scale', params,
});

const center = (ui: unknown = { canvas: 'point', label: 'C', color: '#ff8800' }) =>
  ({ key: 'center', type: 'point', default: { x: 0.5, y: 0.5 }, label: 'Center', ui });
const size = (ui: unknown = { canvas: 'radius', anchor: 'center' }, min = 0.01) =>
  ({ key: 'size', type: 'number', min, max: 1, default: 0.2, label: 'Size', ui });

/** Joined errors of a manifest with these params. */
const errorsOf = (params: unknown[]) => validateManifest(manifest(params)).errors.join('\n');

describe('canvas hints in manifest validation', () => {
  it('accepts point and radius hints (and the string ui form)', () => {
    const r = validateManifest(manifest([
      center(),
      size(),
      { key: 'speed', type: 'number', min: 0, max: 1, default: 0.5, label: 'Speed', ui: 'pm.fader' },
      { key: 'corner', type: 'point', default: { x: 0, y: 0 }, label: 'Corner', ui: { input: 'pm.xyInput', canvas: 'point', color: 'rgb(0, 128, 255)' } },
    ]));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('rejects an unknown canvas kind', () => {
    expect(errorsOf([center({ canvas: 'line' })])).toMatch(/unknown ui\.canvas "line"/);
  });

  it('rejects a hint on the wrong param type', () => {
    expect(errorsOf([{ ...size(), ui: { canvas: 'point' } }])).toMatch(/"point" needs a point param/);
    expect(errorsOf([center({ canvas: 'radius', anchor: 'center' })])).toMatch(/"radius" needs a number param/);
  });

  it('checks the radius anchor', () => {
    expect(errorsOf([center(), size({ canvas: 'radius' })])).toMatch(/needs ui\.anchor/);
    expect(errorsOf([center(), size({ canvas: 'radius', anchor: 'nope' })])).toMatch(/unknown param "nope"/);
    const speed = { key: 'speed', type: 'number', min: 0, max: 1, default: 0.5, label: 'Speed' };
    expect(errorsOf([speed, size({ canvas: 'radius', anchor: 'speed' })])).toMatch(/must be a point param/);
  });

  it('warns when the anchor has no point handle', () => {
    const r = validateManifest(manifest([center('pm.xyInput'), size()]));
    expect(r.errors).toEqual([]);
    expect(r.warnings.join('\n')).toMatch(/ring center is not draggable/);
  });

  it('rejects a negative radius range', () => {
    expect(errorsOf([center(), size(undefined, -1)])).toMatch(/needs min ≥ 0/);
  });

  it('rejects bad object fields', () => {
    const all = errorsOf([
      center({ canvas: 'point', color: 'not a color!', label: '', extra: 1 }),
      { key: 'other', type: 'point', default: { x: 0, y: 0 }, label: 'Other', ui: { label: 'X' } },
      { key: 'third', type: 'point', default: { x: 0, y: 0 }, label: 'Third', ui: { input: 'pm.nope' } },
      { key: 'fourth', type: 'point', default: { x: 0, y: 0 }, label: 'Fourth', ui: 42 },
    ]);
    expect(all).toMatch(/ui has unknown field "extra"/);
    expect(all).toMatch(/ui\.color must be a CSS color/);
    expect(all).toMatch(/ui\.label must be a non-empty string/);
    expect(all).toMatch(/need ui\.canvas/);
    expect(all).toMatch(/unknown ui\.input "pm\.nope"/);
    expect(all).toMatch(/ui must be a pm\.\* input name or an object/);
  });

  it('keeps rejecting unknown string inputs', () => {
    expect(errorsOf([center('pm.nope')])).toMatch(/unknown ui "pm\.nope"/);
  });
});

describe('param ui helpers', () => {
  it('read the input and the hint from both forms', () => {
    expect(paramUiInput('pm.fader')).toBe('pm.fader');
    expect(paramUiInput({ input: 'pm.xyInput', canvas: 'point' })).toBe('pm.xyInput');
    expect(paramUiInput({ canvas: 'point' })).toBeUndefined();
    expect(paramCanvasHint('pm.fader')).toBeNull();
    expect(paramCanvasHint({ input: 'pm.fader' })).toBeNull();
    expect(paramCanvasHint({ canvas: 'radius', anchor: 'c' })).toEqual({ canvas: 'radius', anchor: 'c' });
  });
});

describe('a hinted plugin end to end', () => {
  it('builds and validates (four corner points + area size)', async () => {
    const { buildPackage, validate } = await import('./index');
    const corner = (key: string, x: number, y: number) =>
      ({ key, type: 'point', default: { x, y }, label: `Corner ${key.toUpperCase()}`, ui: { canvas: 'point', label: key.toUpperCase() } });
    const m = {
      ...manifest([
        corner('a', 0, 0), corner('b', 1, 0), corner('c', 1, 1), corner('d', 0, 1),
        { key: 'size', type: 'number', min: 0.01, max: 1, default: 0.3, label: 'Area size', ui: { canvas: 'radius', anchor: 'a' } },
      ]),
      output: 'scale',
    } as Parameters<typeof buildPackage>[0];
    // Brightness falls off with the distance to the nearest corner (x-units; aspect 1 until ABI 1.3).
    const source = `
import { Modifier, Frame, Sample, Out, Params, register } from "@pixelmapper/plugin-sdk";
class M extends Modifier {
  px: StaticArray<f32> = new StaticArray<f32>(4);
  py: StaticArray<f32> = new StaticArray<f32>(4);
  size: f32 = 0.3;
  prepare(p: Params): void {
    for (let i = 0; i < 4; i++) { this.px[i] = p.get(i * 2); this.py[i] = p.get(i * 2 + 1); }
    this.size = p.get(8);
  }
  render(ctx: Frame, s: Sample, out: Out): void {
    let d: f32 = 10;
    for (let i = 0; i < 4; i++) d = Mathf.min(d, Mathf.hypot(s.x - this.px[i], s.y - this.py[i]));
    out.set(0, Mathf.max(0, 1 - d / this.size) * (0.5 + 0.5 * Mathf.sin(s.phase * 6.2831853)));
  }
}
register(new M());
`;
    const { pkg, diagnostics } = await buildPackage(m, { 'modifier.ts': source });
    expect(diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    const r = await validate({ manifest: m, wasm: pkg!.wasm }, { frames: 60, skipPerf: true });
    expect(r.errors).toEqual([]);
  }, 60_000);
});
