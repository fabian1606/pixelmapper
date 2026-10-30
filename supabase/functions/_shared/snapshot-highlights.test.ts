// Run with: bun test supabase/functions/_shared
// Defensive normalization of the snapshot-preview highlights (migration 015).
import { describe, expect, test } from 'bun:test';
import { normalizeHighlights } from './snapshot-highlights.ts';

const PREV = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/** A well-formed RPC result (as returned by snapshot_preview_highlights). */
const VALID = {
  previousId: PREV,
  categories: {
    live: { added: 1, changed: 1, removed: 1 },
    effect: { added: 0, changed: 1, removed: 0 },
    preset: { added: 1, changed: 0, removed: 0 },
    fixtures: { added: 1, changed: 2, removed: 1, moved: 1, groups: 2 },
    settings: { added: 0, changed: 1, removed: 0 },
  },
  live: {
    pages: [{
      status: 'changed',
      page: { id: 'L1', name: 'Main', widgets: [] },
      widgets: { added: ['w3'], changed: ['w1'], removed: [{ id: 'w2', type: 'slider', label: 'Dim' }] },
      sectionsChanged: true,
    }],
    removed: [{ id: 'L2', name: 'Old' }],
  },
  effects: {
    items: [{ status: 'changed', modifier: { id: 'm1', strength: 0.5 }, changedKeys: ['strength'], before: { strength: 1 } }],
    removed: [],
  },
  presets: { items: [{ status: 'added', preset: { id: 'p3', name: 'New' }, changedKeys: [] }], removed: [] },
  fixtures: { added: [3], changed: [0, 1], moved: [0], removed: 1 },
  fixtureIndex: { f1: 0, f2: 1, 3: 2, f6: 3 },
  settings: ['globalBpm'],
  truncated: false,
};

describe('normalizeHighlights', () => {
  test('non-object → null', () => {
    expect(normalizeHighlights(null, 4)).toBeNull();
    expect(normalizeHighlights([], 4)).toBeNull();
    expect(normalizeHighlights('x', 4)).toBeNull();
  });

  test('passes a valid result through', () => {
    expect(normalizeHighlights(VALID, 4)).toEqual({ ...VALID, fixtureIndex: { 3: 2, f1: 0, f2: 1, f6: 3 } });
  });

  test('first version: previousId null, empty sections', () => {
    expect(normalizeHighlights({ previousId: null, categories: {} }, 0)).toEqual({
      previousId: null,
      categories: {},
      live: { pages: [], removed: [] },
      effects: { items: [], removed: [] },
      presets: { items: [], removed: [] },
      fixtures: { added: [], changed: [], moved: [], removed: 0 },
      fixtureIndex: {},
      settings: [],
      truncated: false,
    });
  });

  test('drops layout indices outside the layout; moved ⊆ changed', () => {
    const res = normalizeHighlights({
      fixtures: { added: [3, 4, -1, 1.5, '2'], changed: [0, 9], moved: [0, 1, 9], removed: -3 },
      fixtureIndex: { a: 0, b: 4, c: 'x', d: 3 },
    }, 4);
    expect(res?.fixtures).toEqual({ added: [3], changed: [0], moved: [0], removed: 0 });
    expect(res?.fixtureIndex).toEqual({ a: 0, d: 3 });
  });

  test('categories: unknown kinds dropped, counts clamped, moved ≤ changed', () => {
    const res = normalizeHighlights({
      categories: {
        live: { added: -1, changed: 2.7, removed: 'x' },
        bogus: { added: 1 },
        effect: 5,
        fixtures: { added: 0, changed: 1, removed: 0, moved: 4, groups: 1 },
      },
    }, 0);
    expect(res?.categories).toEqual({
      live: { added: 0, changed: 2, removed: 0 },
      fixtures: { added: 0, changed: 1, removed: 0, moved: 1, groups: 1 },
    });
  });

  test('drops malformed items', () => {
    const res = normalizeHighlights({
      live: {
        pages: [
          { status: 'removed', page: { id: 'a' } },
          { status: 'added', page: { name: 'no id' } },
          { status: 'added', page: { id: 'ok' }, widgets: { added: ['w', 5], removed: [{ id: 'r' }, { type: 'x' }] } },
        ],
        removed: [{ id: 'L' }, { name: 'no id' }, 7],
      },
      effects: { items: [{ status: 'changed', modifier: [] }, { status: 'added', modifier: { id: 'm' }, changedKeys: [1, 'k'], before: [] }] },
      presets: { items: [null, { status: 'changed', preset: { id: 'p' } }] },
      settings: ['a', 1, null],
      previousId: 'not-a-uuid',
      truncated: 'yes',
    }, 0);
    expect(res?.live).toEqual({
      pages: [{
        status: 'added',
        page: { id: 'ok' },
        widgets: { added: ['w'], changed: [], removed: [{ id: 'r', type: '', label: '' }] },
        sectionsChanged: false,
      }],
      removed: [{ id: 'L', name: '' }],
    });
    expect(res?.effects.items).toEqual([{ status: 'added', modifier: { id: 'm' }, changedKeys: ['k'], before: {} }]);
    expect(res?.presets.items).toEqual([{ status: 'changed', preset: { id: 'p' }, changedKeys: [] }]);
    expect(res?.settings).toEqual(['a']);
    expect(res?.previousId).toBeNull();
    expect(res?.truncated).toBe(false);
  });

  test('previousId is lower-cased; truncated kept', () => {
    const res = normalizeHighlights({ previousId: PREV.toUpperCase(), truncated: true }, 0);
    expect(res?.previousId).toBe(PREV);
    expect(res?.truncated).toBe(true);
  });
});
