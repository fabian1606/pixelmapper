// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PresetCategory } from '~/utils/engine/preset-types';
import { rebaseChange } from '../index';
import { makeState, preset } from './test-state';

/** Tests of the preset rebase adapters. */

/** Category with a label and fixture ids. */
const cat = (label: string, fixtureIds: Array<string | number> = []): PresetCategory =>
  ({ type: 'color', label, fixtureIds, channels: [], modifiers: [] });

describe('OverwritePreset', () => {
  const payload = { presetId: 'p', presetName: 'P', oldCats: [cat('old')], newCats: [cat('new')] };

  it('applies when the remote categories are unchanged; before = current', () => {
    const current = makeState({ savedPresets: [preset('p', { name: 'Renamed', categories: [cat('old')] })] });
    const res = rebaseChange({ type: 'OverwritePreset', payload }, current);
    expect(res.payload).toEqual({ presetId: 'p', presetName: 'Renamed', oldCats: [cat('old')], newCats: [cat('new')] });
    expect(res.conflicts).toEqual([]);
  });

  it('remote overwrite of the same preset → atomic conflict, local wins', () => {
    const current = makeState({ savedPresets: [preset('p', { categories: [cat('remote')] })] });
    const res = rebaseChange({ type: 'OverwritePreset', payload }, current);
    expect((res.payload as any).newCats).toEqual([cat('new')]);
    expect((res.payload as any).oldCats).toEqual([cat('remote')]);
    expect(res.conflicts).toMatchObject([{ entityId: 'p', path: ['p', 'categories'], kind: 'modify-modify' }]);
  });

  it('skips when the preset was deleted remotely', () => {
    expect(rebaseChange({ type: 'OverwritePreset', payload }, makeState()).skipped).toBeTruthy();
  });
});

describe('UpdatePresetMetadata', () => {
  it('rebases before to current values and reports a concurrent rename', () => {
    const payload = { presetId: 'p', before: { name: 'a', color: null }, after: { name: 'b', color: '#fff' } };
    const current = makeState({ savedPresets: [preset('p', { name: 'remote' })] });
    const res = rebaseChange({ type: 'UpdatePresetMetadata', payload }, current);
    expect(res.payload).toEqual({ presetId: 'p', before: { name: 'remote', color: null }, after: { name: 'b', color: '#fff' } });
    expect(res.conflicts).toMatchObject([{ path: ['p', 'name'], base: 'a', local: 'b', remote: 'remote' }]);
  });
});

describe('DeletePreset', () => {
  const p = preset('p', { name: 'x' });

  it('applies when the preset is unchanged', () => {
    const res = rebaseChange({ type: 'DeletePreset', payload: { preset: p } }, makeState({ savedPresets: [preset('p', { name: 'x' })] }));
    expect(res.skipped).toBeUndefined();
  });

  it('remove vs modify → skipped, preset kept, conflict reported', () => {
    const res = rebaseChange({ type: 'DeletePreset', payload: { preset: p } }, makeState({ savedPresets: [preset('p', { name: 'y' })] }));
    expect(res.skipped).toMatch(/modified remotely/);
    expect(res.conflicts.map(c => c.kind)).toEqual(['remove-modify']);
  });

  it('already deleted → skipped without conflict', () => {
    const res = rebaseChange({ type: 'DeletePreset', payload: { preset: p } }, makeState());
    expect(res.skipped).toBeTruthy();
    expect(res.conflicts).toEqual([]);
  });
});

describe('active preset', () => {
  it.each(['SetActivePreset', 'preset.set'])('%s skips a deleted preset, allows null', (type) => {
    expect(rebaseChange({ type, payload: { presetId: 'gone' } }, makeState()).skipped).toBeTruthy();
    expect(rebaseChange({ type, payload: { presetId: null } }, makeState()).skipped).toBeUndefined();
  });

  it('reports a concurrent remote activation', () => {
    const presets = [preset('a'), preset('b'), preset('c')];
    const previous = makeState({ savedPresets: presets, selectedPresetId: 'a' });
    const current = makeState({ savedPresets: presets, selectedPresetId: 'c' });
    const res = rebaseChange({ type: 'SetActivePreset', payload: { presetId: 'b' } }, current, previous);
    expect(res.conflicts).toMatchObject([{ path: ['selectedPresetId'], local: 'b', remote: 'c' }]);
  });

  it('color.override skips a deleted preset', () => {
    expect(rebaseChange({ type: 'color.override', payload: { key: 'x', rgb: null } }, makeState()).skipped).toBeTruthy();
  });
});

describe('SavePreset', () => {
  it('passes through', () => {
    const payload = { preset: preset('n') };
    expect(rebaseChange({ type: 'SavePreset', payload }, makeState())).toEqual({ payload, conflicts: [] });
  });
});
