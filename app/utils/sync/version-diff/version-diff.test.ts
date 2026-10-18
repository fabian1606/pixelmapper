// @vitest-environment node
/**
 * Version-history diff: structural changes between two serialized projects.
 */
import { describe, expect, it } from 'vitest';
import { diffSnapshots } from '~/utils/sync/version-diff';
import { flattenScene } from './scene';
import { humanize } from './compare';

// ── Builders ─────────────────────────────────────────────────────────────────

/** Serialized fixture with defaults. */
function fixture(id: string | number, over: Record<string, unknown> = {}) {
  return {
    _type: 'fixture', id, name: `Fixture ${id}`, startAddress: 1,
    fixturePosition: { x: 0, y: 0 }, fixtureSize: { x: 1, y: 1 }, rotation: 0,
    manufacturer: 'Generic', fixtureType: 'RGB',
    channels: [{ type: 'RED', addressOffset: 0, role: 'COLOR', colorValue: '#ff0000', defaultValue: 0, chaserConfig: {} }],
    beams: [], ...over,
  };
}

/** Serialized group. */
function group(id: string, children: unknown[], over: Record<string, unknown> = {}) {
  return { _type: 'group', id, name: `Group ${id}`, expanded: true, children, ...over };
}

/** Modifier instance with defaults. */
function modifier(id: string, over: Record<string, unknown> = {}) {
  return {
    id, plugin: 'sha256:wave', signature: 'scalar', targetChannels: ['DIMMER'], blendMode: 'multiply',
    strength: 1, speed: { mode: 'bpm', value: 1 }, distribution: { kind: 'linear' }, params: { shape: 'sine', size: 1 }, ...over,
  };
}

/** Preset with defaults. */
function preset(id: string, over: Record<string, unknown> = {}) {
  return { id, name: `Preset ${id}`, createdAt: '2026-01-01T00:00:00Z', categories: [], ...over };
}

/** Snapshot with defaults. */
function snap(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 3, sceneNodes: [], savedPresets: [], pinnedModifiers: [], globalBases: {},
    modifiers: [], livePages: [], globalBpm: 120, clockEpoch: 1, ...over,
  };
}

// ── Scene ────────────────────────────────────────────────────────────────────

describe('diffSnapshots › scene', () => {
  it('identical snapshots are empty (clockEpoch and group expansion ignored)', () => {
    const a = snap({ sceneNodes: [group('g', [fixture(1)])] });
    const b = snap({ sceneNodes: [group('g', [fixture(1)], { expanded: false })], clockEpoch: 999 });
    expect(diffSnapshots(a, b).empty).toBe(true);
  });

  it.each([
    ['moved fixture', { fixturePosition: { x: 2, y: 3 } }, ['position']],
    ['height counts as position', { positionZ: 1 }, ['position']],
    ['tilt counts as rotation', { tiltX: 10 }, ['rotation']],
    ['address', { startAddress: 17 }, ['address']],
    ['color only', { channels: [{ type: 'RED', addressOffset: 0, role: 'COLOR', colorValue: '#00ff00', defaultValue: 0, chaserConfig: {} }] }, ['color']],
    ['channels', { channels: [] }, ['channels']],
    ['type', { fixtureType: 'RGBW', oflKey: 'generic/rgbw' }, ['fixture type']],
    ['unknown key humanized', { someNewThing: 1 }, ['some new thing']],
  ])('fixture field: %s', (_name, over, fields) => {
    const d = diffSnapshots(snap({ sceneNodes: [fixture(1)] }), snap({ sceneNodes: [fixture(1, over)] }));
    expect(d.fixtures.changed).toEqual([{ id: '1', name: 'Fixture 1', fields }]);
    expect(d.empty).toBe(false);
  });

  it('renamed fixture keeps the old name', () => {
    const d = diffSnapshots(snap({ sceneNodes: [fixture('a', { name: 'Spot A' })] }), snap({ sceneNodes: [fixture('a', { name: 'Spot 1' })] }));
    expect(d.fixtures.changed).toEqual([{ id: 'a', name: 'Spot 1', previousName: 'Spot A', fields: ['name'] }]);
  });

  it('added / removed fixtures in nested groups; name falls back to the id', () => {
    const a = snap({ sceneNodes: [group('g1', [group('g2', [fixture(1), fixture(2)])])] });
    const b = snap({ sceneNodes: [group('g1', [group('g2', [fixture(1), fixture(3, { name: '' })])])] });
    const d = diffSnapshots(a, b);
    expect(d.fixtures.added).toEqual([{ id: '3', name: '3' }]);
    expect(d.fixtures.removed).toEqual([{ id: '2', name: 'Fixture 2' }]);
    expect(d.groups.changed).toEqual([{ id: 'g2', name: 'Group g2', fields: ['members'] }]);
    // The outer group's direct members did not change.
    expect(d.groups.changed.map(c => c.id)).not.toContain('g1');
  });

  it('fixture moved into another group', () => {
    const a = snap({ sceneNodes: [group('g1', [fixture(1)]), group('g2', [])] });
    const b = snap({ sceneNodes: [group('g1', []), group('g2', [fixture(1)])] });
    const d = diffSnapshots(a, b);
    expect(d.fixtures.changed).toEqual([{ id: '1', name: 'Fixture 1', fields: ['group'] }]);
    expect(d.groups.changed.map(c => [c.id, c.fields])).toEqual([['g1', ['members']], ['g2', ['members']]]);
  });

  it('group renamed, reordered children, added and removed groups', () => {
    const a = snap({ sceneNodes: [group('g1', [fixture(1), fixture(2)]), group('old', [])] });
    const b = snap({ sceneNodes: [group('g1', [fixture(2), fixture(1)], { name: 'Front' }), group('new', [])] });
    const d = diffSnapshots(a, b);
    expect(d.groups.changed).toEqual([{ id: 'g1', name: 'Front', previousName: 'Group g1', fields: ['name', 'order'] }]);
    expect(d.groups.added).toEqual([{ id: 'new', name: 'Group new' }]);
    expect(d.groups.removed).toEqual([{ id: 'old', name: 'Group old' }]);
  });

  it('flattenScene treats a node with children as a group and skips junk', () => {
    const { fixtures, groups } = flattenScene([{ id: 'g', children: [fixture(1), null, 5] }, 'x']);
    expect(groups.map(g => g.id)).toEqual(['g']);
    expect(fixtures.map(f => f.id)).toEqual([1]);
  });
});

// ── Modifiers, presets, live pages ───────────────────────────────────────────

describe('diffSnapshots › entities', () => {
  it('changed modifier params are listed per param; names come from the resolver', () => {
    const a = snap({ modifiers: [modifier('m1')] });
    const b = snap({ modifiers: [modifier('m1', { speed: { mode: 'bpm', value: 2 }, params: { shape: 'square', size: 1, waveLength: 3 } })] });
    const d = diffSnapshots(a, b, { modifierName: () => 'Waveform' });
    expect(d.modifiers.changed).toEqual([{ id: 'm1', name: 'Waveform', fields: ['speed', 'shape', 'wave length'] }]);
  });

  it('modifier added / removed / reordered; name falls back to the id', () => {
    const d = diffSnapshots(snap({ modifiers: [modifier('a'), modifier('b'), modifier('c')] }), snap({ modifiers: [modifier('c'), modifier('a'), modifier('d')] }));
    expect(d.modifiers.added).toEqual([{ id: 'd', name: 'd' }]);
    expect(d.modifiers.removed).toEqual([{ id: 'b', name: 'b' }]);
    expect(d.modifiers.reordered).toBe(true);
  });

  it('presets: added, removed, overwritten (createdAt ignored)', () => {
    const a = snap({ savedPresets: [preset('p1'), preset('p2')] });
    const b = snap({ savedPresets: [preset('p1', { createdAt: '2026-02-01', categories: [{ x: 1 }] }), preset('p3'), preset('p4', { createdAt: 'x' })] });
    const d = diffSnapshots(a, b);
    expect(d.presets.changed).toEqual([{ id: 'p1', name: 'Preset p1', fields: ['content'] }]);
    expect(d.presets.added.map(p => p.name)).toEqual(['Preset p3', 'Preset p4']);
    expect(d.presets.removed).toEqual([{ id: 'p2', name: 'Preset p2' }]);
  });

  it('live pages: layout and widgets', () => {
    const page = { id: 'l1', name: 'Main', columns: 8, aspectRatioW: 16, aspectRatioH: 9, gridSize: 40, backgroundColor: '#000', widgets: [] };
    const d = diffSnapshots(snap({ livePages: [page] }), snap({ livePages: [{ ...page, columns: 10, widgets: [{ id: 'w' }] }] }));
    expect(d.livePages.changed).toEqual([{ id: 'l1', name: 'Main', fields: ['layout', 'widgets'] }]);
  });
});

// ── Settings ─────────────────────────────────────────────────────────────────

describe('diffSnapshots › settings', () => {
  it('BPM and active preset with from/to; missing BPM defaults to 120', () => {
    const a = snap({ globalBpm: undefined, savedPresets: [preset('p1')], selectedPresetId: null });
    const b = snap({ globalBpm: 128, savedPresets: [preset('p1')], selectedPresetId: 'p1' });
    expect(diffSnapshots(a, b).settings).toEqual([
      { label: 'BPM', from: '120', to: '128' },
      { label: 'Active preset', from: 'None', to: 'Preset p1' },
    ]);
  });

  it('other settings are named; empty and missing are equal', () => {
    const a = snap({ pinnedModifiers: [], activeSectionMembers: undefined });
    const b = snap({ pinnedModifiers: [{ id: 'x' }], activeSectionMembers: {}, globalBases: { RED: 1 }, fooBar: true });
    expect(diffSnapshots(a, b).settings.map(s => s.label)).toEqual(['Global levels', 'Pinned effects', 'Foo bar']);
  });

  it('garbage input yields an empty diff', () => {
    expect(diffSnapshots(null, 'x').empty).toBe(true);
    expect(diffSnapshots({ sceneNodes: 'bad', modifiers: {} }, {}).empty).toBe(true);
  });

  it('humanize', () => {
    expect(humanize('fixturePosition')).toBe('fixture position');
    expect(humanize('wave_length')).toBe('wave length');
  });
});
