// @vitest-environment node
/**
 * Manifest UX fields (plan M5.1): presets, editors, tiers, when, distribution.
 */
import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest';

/** A valid base manifest with two params. */
const base = (extra: Record<string, unknown> = {}) => ({
  schema: 1, kind: 'modifier', alias: '@test/ux', name: 'UX', version: '1.0.0', apiVersion: '^1.1.0',
  description: 'Test manifest with UX fields.', signatures: ['scalar'], output: 'scale',
  params: [
    { key: 'mode', type: 'enum', options: ['a', 'b'], default: 'a', label: 'Mode', tier: 'primary' },
    { key: 'amount', type: 'number', min: 0, max: 1, default: 0.5, label: 'Amount', tier: 'hidden', when: { mode: 'a' } },
  ],
  ...extra,
});

describe('manifest UX fields', () => {
  it('accepts a complete manifest', () => {
    const r = validateManifest(base({
      purpose: 'Does a thing.',
      distribution: { modes: ['none', 'order'], scopes: ['across'], default: { mode: 'order' } },
      editors: [{ id: 'e', input: 'pm.fader', bind: { value: 'amount' }, when: { 'distribution.mode': 'order' } }],
      presets: [
        { id: 'p1', label: 'One', params: { mode: 'b', amount: 0.2 }, speed: { mode: 'beat', beatValue: 4 }, distribution: { mode: 'order' }, strength: 1, default: true, when: { kind: ['row'] } },
        { id: 'p2', label: 'Two', params: {} },
      ],
    }));
    expect(r.errors).toEqual([]);
  });

  it('reports bad presets, editors, tiers and when keys', () => {
    const r = validateManifest(base({
      params: [{ key: 'mode', type: 'enum', options: ['a'], default: 'a', label: 'Mode', tier: 'secret', when: { nope: 1 } }],
      editors: [{ id: 'e', input: 'fader', bind: { value: 'missing' } }],
      presets: [
        { id: 'p', label: 'P', params: { mode: 'z', ghost: 1 }, default: true },
        { id: 'p', label: 'Q', params: {}, default: true, strength: 2 },
      ],
    }));
    const all = r.errors.join('\n');
    expect(all).toMatch(/tier must be one of/);
    expect(all).toMatch(/when refers to unknown key "nope"/);
    expect(all).toMatch(/input must name a pm\.\* input/);
    expect(all).toMatch(/bind "value" refers to unknown param "missing"/);
    expect(all).toMatch(/param "mode" must be one of a/);
    expect(all).toMatch(/unknown param "ghost"/);
    expect(all).toMatch(/duplicate id/);
    expect(all).toMatch(/strength must be in \[0, 1\]/);
    expect(all).toMatch(/at most one preset may be default/);
  });

  it('rejects invalid distribution options', () => {
    const r = validateManifest(base({ distribution: { modes: ['diagonal'] } }));
    expect(r.errors.join('\n')).toMatch(/distribution\.modes must list/);
  });
});
