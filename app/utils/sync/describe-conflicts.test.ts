// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { LivePage } from '~/utils/live/types';
import type { MergeConflict } from '~/utils/sync/merge/types';
import type { SyncConflictItem } from '~/utils/sync/sync-conflicts';
import { describeConflicts } from '~/utils/sync/describe-conflicts';
import { fixture, group, makeState, mod, preset } from '~/utils/sync/merge/adapters/test-state';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a conflict item with defaults for the values. */
function item(changeType: string, entityId: MergeConflict['entityId'], path: MergeConflict['path'], kind: MergeConflict['kind'] = 'modify-modify'): SyncConflictItem {
  return { changeType, conflict: { entityId, path, base: 0, local: 1, remote: 2, kind } };
}

/** Live page with one widget and one section. */
const page = {
  id: 'p1',
  name: 'Main',
  widgets: [{ id: 'w1', type: 'fader', label: 'Fader 1' }],
  sections: [{ id: 's1', name: 'Colors' }],
} as unknown as LivePage;

/** Shared state of the tests. */
const state = makeState({
  modifiers: [mod('m1', { speed: 1 })],
  sceneNodes: [group('g1', [fixture('f1', { name: 'Front Left' })], 'Stage')],
  savedPresets: [preset('pr1', { name: 'Intro' })],
  livePages: [page],
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('describeConflicts', () => {
  it('names effects via the resolver and drops ids from paths', () => {
    const lines = describeConflicts([item('modifier.update', 'm1', ['m1', 'params', 'speed'])], state, { modifierName: () => 'Rainbow' });
    expect(lines).toEqual(['Effect "Rainbow": speed']);
  });

  it('falls back to a short id for effects without a resolver', () => {
    expect(describeConflicts([item('SetModifiers', 'm1', ['strength'])], state)).toEqual(['Effect "m1": strength']);
  });

  it('resolves nested fixtures and maps position fields', () => {
    const lines = describeConflicts([
      item('MoveFixture', 'f1', ['f1', 'x']),
      item('MoveFixture', 'f1', ['f1', 'y']),
      item('RenameNode', 'g1', ['g1', 'name']),
    ], state);
    expect(lines).toEqual(['Fixture "Front Left": position', 'Group "Stage": name']);
  });

  it('describes presets, live widgets and sections', () => {
    const lines = describeConflicts([
      item('OverwritePreset', 'pr1', ['pr1', 'categories', 0, 'entries']),
      item('live.updateMapping', 'w1', ['livePages', 'p1', 'widgets', 'w1', 'mapping', 'targetId']),
      item('live.updateSection', 's1', ['livePages', 'p1', 'sections', 's1', 'selectedPresetIds']),
    ], state);
    expect(lines).toEqual([
      'Preset "Intro": categories',
      'Live widget "Fader 1": mapping',
      'Live section "Colors": selected preset ids',
    ]);
  });

  it('describes global BPM', () => {
    expect(describeConflicts([item('engine.bpm', null, ['globalBpm'])], state)).toEqual(['BPM']);
  });

  it('describes removed-but-modified entities and order conflicts', () => {
    const lines = describeConflicts([
      item('live.removeWidget', 'w1', ['livePages', 'p1', 'widgets', 'w1'], 'remove-modify'),
      item('SetModifiers', null, [], 'order'),
    ], state);
    expect(lines).toEqual(['Live widget "Fader 1": kept although deleted elsewhere', 'Order']);
  });

  it('falls back to a short id for unknown entities', () => {
    const lines = describeConflicts([item('MoveFixture', '0123456789abcdef', ['0123456789abcdef', 'x'])], state);
    expect(lines).toEqual(['Fixture "01234567": position']);
  });

  it('deduplicates and caps the list', () => {
    const items = Array.from({ length: 12 }, (_, i) => item('SetModifiers', 'm1', ['m1', `field${i}`]));
    items.push(item('SetModifiers', 'm1', ['m1', 'field0']));
    const lines = describeConflicts(items, state, { maxLines: 8 });
    expect(lines).toHaveLength(9);
    expect(lines[8]).toBe('and 4 more');
  });
});
