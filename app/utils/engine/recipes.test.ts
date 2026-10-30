// @vitest-environment node
/**
 * Recipes (plan M5.2, M5.8): apply, active detection, selection-based pick.
 */
import { describe, expect, it } from 'vitest';
import type { ContentPluginManifest } from '@pixelmapper/plugin-toolchain/types';
import { activePreset, applyPreset, cardPresets, pickPreset } from './recipes';
import { distributionForParams } from './option-distribution';
import { analyzeSelection } from './distribution/selection-shape';
import { selectionDistribution } from './distribution/selection-defaults';
import { createDistribution } from './distribution/create';
import type { ModifierInstance } from './types';

const manifest = {
  params: [{ key: 'w', type: 'number', min: 0, max: 1, default: 0.5, label: 'W' }, { key: 'k', type: 'bool', default: false, label: 'K' }],
  presets: [
    { id: 'chase', label: 'Chase', params: { w: 0.15 }, speed: { mode: 'beat', beatValue: 4 }, distribution: { mode: 'order' }, default: true, when: { kind: ['row', 'area'] } },
    { id: 'ring', label: 'Ring', params: { w: 0.25 }, distribution: { mode: 'radial' }, when: { kind: ['ring'] } },
    { id: 'bars', label: 'Bars', params: { w: 0.25, k: true }, distribution: { scope: 'within' }, when: { multiHead: true } },
    { id: 'breathe', label: 'Breathe', params: { w: 1 }, strength: 0.5, when: { kind: ['single'] } },
  ],
} as unknown as ContentPluginManifest;

const inst = () => ({ id: 'm', params: { w: 0.5, k: false }, speed: { mode: 'beat', timeMs: 2000, beatValue: 1, beatOffset: 0 }, strength: 1, distribution: createDistribution({ mode: 'linear', reverse: true }) }) as unknown as ModifierInstance;
const row = (n: number, heads = 1) => Array.from({ length: n }, (_, i) => ({ x: 0.1 + i * 0.1, y: 0.5, heads }));
const ring = Array.from({ length: 12 }, (_, i) => ({ x: 0.5 + 0.3 * Math.cos(i / 12 * 6.283), y: 0.5 + 0.3 * Math.sin(i / 12 * 6.283) }));

describe('recipes', () => {
  it('apply sets params, speed, distribution and strength; keeps other distribution fields', () => {
    const m = applyPreset(inst(), manifest, manifest.presets![0]!);
    expect(m.params).toEqual({ w: 0.15, k: false });
    expect(m.speed).toMatchObject({ mode: 'beat', beatValue: 4, timeMs: 2000 });
    expect(m.distribution.mode).toBe('order');
    expect(m.distribution.reverse).toBe(true);
  });

  it('active recipe by params; Custom after an edit', () => {
    const m = applyPreset(inst(), manifest, manifest.presets![1]!);
    expect(activePreset(m, manifest)?.id).toBe('ring');
    expect(activePreset({ ...m, params: { ...m.params, w: 0.3 } }, manifest)).toBeNull();
  });

  it('picks per selection kind (row, ring, single, multi-head), else default', () => {
    const pick = (pts: { x: number; y: number; heads?: number }[]) => pickPreset(manifest, { shape: analyzeSelection(pts), hasColor: false })?.id;
    expect(pick(row(8))).toBe('chase');
    expect(pick(ring)).toBe('ring');
    expect(pick([{ x: 0.5, y: 0.5 }])).toBe('breathe');
    expect(pick(row(4, 16))).toBe('bars');
  });

  it('places the distribution on the selection', () => {
    const shape = analyzeSelection(row(8));
    const d = selectionDistribution(createDistribution({ mode: 'order', order: { ranks: { x: 3 } } }), shape);
    expect(d.order.line).toEqual(shape.axis);
    expect(d.order.ranks).toEqual({});
    const r = selectionDistribution(createDistribution({ mode: 'radial' }), analyzeSelection(ring));
    expect(r.origin.x).toBeCloseTo(0.5);
    expect(r.end.x - r.origin.x).toBeCloseTo(0.3);
  });

  it('tells recipes with equal params apart by speed and distribution', () => {
    const twins = { ...manifest, presets: [
      { id: 'ring', label: 'Ring', params: { w: 0.25 }, speed: { mode: 'beat', beatValue: 4 }, distribution: { mode: 'radial' } },
      { id: 'bar', label: 'Bar Chase', params: { w: 0.25 }, speed: { mode: 'beat', beatValue: 2 }, distribution: { scope: 'within' } },
    ] } as unknown as ContentPluginManifest;
    const m = applyPreset(inst(), twins, twins.presets![1]!);
    expect(activePreset(m, twins)?.id).toBe('bar');
    expect(activePreset(applyPreset(inst(), twins, twins.presets![0]!), twins)?.id).toBe('ring');
  });
});

describe('canvas points (ui.canvas: point)', () => {
  const pts = {
    params: [
      { key: 'w', type: 'number', min: 0, max: 1, default: 0.5, label: 'W' },
      { key: 'a', type: 'point', default: { x: 0.2, y: 0.2 }, label: 'A', ui: { canvas: 'point' } },
      { key: 'b', type: 'point', default: { x: 0.8, y: 0.8 }, label: 'B' },
    ],
    presets: [
      { id: 'thin', label: 'Thin', params: { w: 0.1 } },
      { id: 'centered', label: 'Centered', params: { w: 0.1, a: { x: 0.5, y: 0.5 } } },
    ],
  } as unknown as ContentPluginManifest;
  const dragged = () => ({ ...inst(), params: { w: 0.7, a: { x: 0.1, y: 0.9 }, b: { x: 0.3, y: 0.3 } } }) as unknown as ModifierInstance;

  it('a recipe keeps dragged canvas points it does not name; other params reset', () => {
    const m = applyPreset(dragged(), pts, pts.presets![0]!);
    expect(m.params).toEqual({ w: 0.1, a: { x: 0.1, y: 0.9 }, b: { x: 0.8, y: 0.8 } });
    expect(activePreset(m, pts)?.id).toBe('thin');
  });

  it('a recipe that names a canvas point sets it', () => {
    const m = applyPreset(dragged(), pts, pts.presets![1]!);
    expect(m.params.a).toEqual({ x: 0.5, y: 0.5 });
    expect(activePreset(m, pts)?.id).toBe('centered');
    expect(activePreset({ ...m, params: { ...m.params, a: { x: 0.4, y: 0.5 } } }, pts)?.id).toBe('thin');
  });
});

describe('every modifier has recipes', () => {
  it('a manifest without presets gets one Default recipe (the schema defaults), active on a fresh instance', () => {
    const bare = { params: manifest.params } as unknown as ContentPluginManifest;
    expect(cardPresets(bare).map(p => p.label)).toEqual(['Default']);
    expect(activePreset(inst(), bare)?.id).toBe('default');
    expect(cardPresets(manifest)).toBe(manifest.presets);
  });
});

describe('option distribution (manifest optionDistribution)', () => {
  const m = {
    params: [{ key: 'arrange', type: 'enum', options: ['gradient', 'alternate'], default: 'gradient', label: 'Arrange', optionDistribution: { alternate: { mode: 'order' } } }],
  } as unknown as ContentPluginManifest;

  it('picking the option switches the spread and places it on the selection', () => {
    const d = createDistribution({ mode: 'linear' });
    const next = distributionForParams(m, { arrange: 'gradient' }, { arrange: 'alternate' }, d, analyzeSelection(row(4)));
    expect(next?.mode).toBe('order');
    expect(next?.order.line).toBeTruthy();
  });

  it('no change when the option stays, has no patch, or the spread already matches', () => {
    const d = createDistribution({ mode: 'linear' });
    expect(distributionForParams(m, { arrange: 'alternate' }, { arrange: 'alternate' }, d)).toBeNull();
    expect(distributionForParams(m, { arrange: 'alternate' }, { arrange: 'gradient' }, d)).toBeNull();
    expect(distributionForParams(m, { arrange: 'gradient' }, { arrange: 'alternate' }, createDistribution({ mode: 'order' }))).toBeNull();
  });
});

describe('twin recipes (same params, other spread)', () => {
  it('the spread decides between recipes with equal params', () => {
    const twins = {
      params: manifest.params,
      presets: [
        { id: 'odd', label: 'Odd/Even', params: { w: 0.5 }, distribution: { scope: 'across', mode: 'order', reverse: false, order: { mirror: false } } },
        { id: 'halves', label: 'Halves', params: { w: 0.5 }, distribution: { scope: 'across', mode: 'linear', reverse: false } },
      ],
    } as unknown as ContentPluginManifest;
    expect(activePreset(applyPreset(inst(), twins, twins.presets![1]!), twins)?.id).toBe('halves');
    expect(activePreset(applyPreset(inst(), twins, twins.presets![0]!), twins)?.id).toBe('odd');
  });
});
