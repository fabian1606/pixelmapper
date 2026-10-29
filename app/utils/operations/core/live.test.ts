/**
 * Live page operations: execute via `applyOperations`, undo to the exact
 * pre-state, dry run, verify rollback and diff.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useHistory } from '~/components/engine/composables/use-history';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveModeStore } from '~/stores/live-mode-store';
import type { ModifierInstance } from '~/utils/engine/types';
import { defaultLivePage, defaultLiveWidget, type LivePage } from '~/utils/live/types';
import { registerPackage } from '~/utils/plugins/plugin-store';
import { applyOperations } from '../apply';
import { readApi } from '../read-api';
import { registryWith, resetOperationState, seedScene, stateFingerprint, stubOperationGlobals } from '../test-utils';
import { findFreeSpot, liveOperations } from './live';

// ── Setup ───────────────────────────────────────

/** A modifier instance with one numeric plugin param (`count`) and one string param (`mode`). */
function testModifier(id: string): ModifierInstance {
  return {
    id,
    plugin: 'sha256:test',
    signature: 'rgb',
    targetChannels: [],
    blendMode: 'add',
    strength: 1,
    speed: { mode: 'beat', timeMs: 2000, beatValue: 1, beatOffset: 0 },
    distribution: {} as ModifierInstance['distribution'],
    params: { count: 3, mode: 'wave' },
  };
}

/** Seeds a page with two widgets and returns it. */
function seedPage(): LivePage {
  const page = defaultLivePage({ id: 'page-1', name: 'Main' });
  page.widgets.push({ ...defaultLiveWidget('button', 0, 0), id: 'w-btn', label: 'Go' });
  page.widgets.push({ ...defaultLiveWidget('slider', 3, 0), id: 'w-sld' });
  useLiveModeStore().loadPages([page]);
  return page;
}

beforeAll(stubOperationGlobals);
beforeEach(() => {
  resetOperationState();
  seedScene([{ id: 'fx-a' }, { id: 'fx-b' }], [{ id: 'grp-1', name: 'All', fixtureIds: ['fx-a', 'fx-b'] }]);
  useEngineStore().modifiers = [testModifier('mod-1')];
  seedPage();
});

const registry = () => registryWith(...liveOperations);

/** Widget from the read API. */
function widget(pageId: string, widgetId: string) {
  return readApi.livePages().find(p => p.id === pageId)?.widgets.find(w => w.id === widgetId);
}

// ── Tests ───────────────────────────────────────

describe('live.listPages', () => {
  it('lists pages with grid info and friendly mappings', async () => {
    useLiveModeStore().pages[0]!.widgets[1]!.mapping = { type: 'effect-param', effectId: 'mod-1', paramKey: 'speed' };
    const result = await applyOperations({ label: 'list', ops: [{ op: 'live.listPages', input: {} }] }, { registry: registry() });
    const { pages } = result.results[0]!.value as { pages: Array<Record<string, any>> };
    expect(pages[0]).toMatchObject({ id: 'page-1', columns: 60, rows: 33, aspectRatio: '16:9' });
    expect(pages[0]!.widgets[1]).toMatchObject({
      id: 'w-sld',
      type: 'slider',
      gridW: 2,
      gridH: 6,
      mapping: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'speed' },
      mappingSummary: 'effect-param: modifier mod-1 → speed',
    });
  });
});

describe('live.addPage', () => {
  it('adds a page and undoes to the pre-state', async () => {
    const before = stateFingerprint();
    const result = await applyOperations({ label: 'Add page', ops: [{ op: 'live.addPage', input: { name: 'Effects', columns: 40 } }] }, { registry: registry() });
    expect(result.committed).toBe(true);
    const { pageId } = result.results[0]!.value as { pageId: string };
    expect(readApi.livePages().find(p => p.id === pageId)).toMatchObject({ name: 'Effects', columns: 40, widgets: [] });
    expect(result.diff).toContainEqual(expect.objectContaining({ entity: `livePage:${pageId}`, field: 'added' }));

    useHistory().undo();
    expect(stateFingerprint()).toBe(before);
  });
});

describe('live.addWidget', () => {
  it('adds an auto-placed effect-param slider and undoes it', async () => {
    const before = stateFingerprint();
    const result = await applyOperations({
      label: 'Add slider',
      ops: [{ op: 'live.addWidget', input: { pageId: 'page-1', type: 'slider', label: 'Count', mapping: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'count' } } }],
    }, { registry: registry() });
    expect(result.committed).toBe(true);
    expect(result.findings).toEqual([]);
    const value = result.results[0]!.value as { widgetId: string; gridX: number; gridY: number };
    // Button occupies 0–2, slider 3–4 → first free 2-wide spot in row 0 starts at x = 5.
    expect(value).toMatchObject({ gridX: 5, gridY: 0, gridW: 2, gridH: 6 });
    expect(widget('page-1', value.widgetId)).toMatchObject({
      type: 'slider',
      label: 'Count',
      mapping: { type: 'effect-param', effectId: 'mod-1', paramKey: 'params.count' },
    });

    useHistory().undo();
    expect(stateFingerprint()).toBe(before);
  });

  it('places consecutive widgets of one batch without overlap', async () => {
    const result = await applyOperations({
      label: 'Control page',
      ops: [
        { op: 'live.addPage', input: { name: 'Fx' } },
        { op: 'live.addWidget', input: { pageId: 'page-1', type: 'xy' } },
        { op: 'live.addWidget', input: { pageId: 'page-1', type: 'xy' } },
      ],
    }, { registry: registry() });
    const a = result.results[1]!.value as { gridX: number };
    const b = result.results[2]!.value as { gridX: number };
    expect([a.gridX, b.gridX]).toEqual([5, 11]);
  });

  it('dry run leaves state and history untouched', async () => {
    const before = stateFingerprint();
    const result = await applyOperations({
      label: 'Try',
      dryRun: true,
      ops: [{ op: 'live.addWidget', input: { pageId: 'page-1', type: 'button', gridX: 20, gridY: 10, mapping: { type: 'global-function', function: 'strobe' } } }],
    }, { registry: registry() });
    expect(result.committed).toBe(false);
    const { widgetId } = result.results[0]!.value as { widgetId: string };
    expect(result.diff).toContainEqual(expect.objectContaining({ entity: `liveWidget:${widgetId}`, field: 'added' }));
    expect(stateFingerprint()).toBe(before);
    expect(useHistory().canUndo.value).toBe(false);
  });

  it('rolls back when effect-param targets a missing modifier or param', async () => {
    const before = stateFingerprint();
    const missingModifier = await applyOperations({
      label: 'Bad',
      ops: [
        { op: 'live.addWidget', input: { pageId: 'page-1', type: 'button' } },
        { op: 'live.addWidget', input: { pageId: 'page-1', type: 'slider', mapping: { type: 'effect-param', modifierId: 'nope', paramKey: 'speed' } } },
      ],
    }, { registry: registry() });
    expect(missingModifier.committed).toBe(false);
    expect(missingModifier.findings).toContainEqual(expect.objectContaining({ level: 'error', code: 'modifier-not-found', opIndex: 1 }));
    expect(stateFingerprint()).toBe(before);

    const missingParam = await applyOperations({
      label: 'Bad',
      ops: [{ op: 'live.addWidget', input: { pageId: 'page-1', type: 'slider', mapping: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'nope' } } }],
    }, { registry: registry() });
    expect(missingParam.findings).toContainEqual(expect.objectContaining({ code: 'param-not-found' }));

    const stringParam = await applyOperations({
      label: 'Bad',
      ops: [{ op: 'live.addWidget', input: { pageId: 'page-1', type: 'slider', mapping: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'mode' } } }],
    }, { registry: registry() });
    expect(stringParam.findings).toContainEqual(expect.objectContaining({ code: 'param-not-mappable' }));
    expect(stateFingerprint()).toBe(before);
    expect(useHistory().canUndo.value).toBe(false);
  });

  it('rejects unknown pages, too-wide widgets and invalid types', async () => {
    const run = (input: unknown) => applyOperations({ label: 'x', ops: [{ op: 'live.addWidget', input }] }, { registry: registry() });
    expect((await run({ pageId: 'nope', type: 'button' })).findings[0]).toMatchObject({ code: 'operation-failed' });
    expect((await run({ pageId: 'page-1', type: 'button', gridX: 59, gridY: 0 })).findings[0]!.message).toMatch(/exceeds the page width/);
    expect((await run({ pageId: 'page-1', type: 'knob' })).findings[0]).toMatchObject({ code: 'invalid-input' });
  });

  it('warns when the widget type ignores the mapping', async () => {
    const result = await applyOperations({
      label: 'Warn',
      ops: [{ op: 'live.addWidget', input: { pageId: 'page-1', type: 'button', mapping: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'strength' } } }],
    }, { registry: registry() });
    expect(result.committed).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({ level: 'warning', code: 'mapping-ignored-by-widget' }));
  });

  it('maps a button to a trigger param without warnings, and warns for other params', async () => {
    // A plugin with a momentary `trigger` param (ABI 1.3) and a number param.
    registerPackage({
      hash: 'sha256:trigger-test',
      manifest: {
        schema: 1, kind: 'modifier', alias: '@test/trigger', name: 'Trigger', version: '1.0.0', apiVersion: '^1.3.0',
        description: 'Test plugin with a trigger param.', signatures: ['scalar'], output: 'scale',
        params: [
          { key: 'hit', type: 'trigger', label: 'Hit', default: { pressed: false } },
          { key: 'decay', type: 'number', label: 'Decay', min: 0, max: 1, default: 0.5 },
        ],
      },
      wasm: new Uint8Array(),
      source: {},
      toolchain: 'test',
    });
    useEngineStore().modifiers = [{ ...testModifier('mod-t'), plugin: 'sha256:trigger-test', params: { hit: { pressed: false }, decay: 0.5 } }];
    const add = (type: string, paramKey: string) => applyOperations({
      label: 'Trigger',
      ops: [{ op: 'live.addWidget', input: { pageId: 'page-1', type, mapping: { type: 'effect-param', modifierId: 'mod-t', paramKey } } }],
    }, { registry: registry() });
    const button = await add('button', 'hit');
    expect(button.committed).toBe(true);
    expect(button.findings).toEqual([]);
    const wrong = await add('button', 'decay');
    expect(wrong.committed).toBe(true);
    expect(wrong.findings).toContainEqual(expect.objectContaining({ level: 'warning', code: 'mapping-ignored-by-widget' }));
  });

  it('resolves channel and dimmer-group targets', async () => {
    const result = await applyOperations({
      label: 'Targets',
      ops: [
        { op: 'live.addWidget', input: { pageId: 'page-1', type: 'slider', mapping: { type: 'channel', fixtureId: 'fx-a', channelOffset: 3 } } },
        { op: 'live.addWidget', input: { pageId: 'page-1', type: 'slider', mapping: { type: 'dimmer-group', groupId: 'grp-1' } } },
      ],
    }, { registry: registry() });
    expect(result.committed).toBe(true);
    const bad = await applyOperations({
      label: 'Bad target',
      ops: [{ op: 'live.addWidget', input: { pageId: 'page-1', type: 'slider', mapping: { type: 'channel', fixtureId: 'fx-a', channelOffset: 9 } } }],
    }, { registry: registry() });
    expect(bad.findings).toContainEqual(expect.objectContaining({ code: 'channel-out-of-range' }));
  });
});

describe('live.updateWidget', () => {
  it('updates grid, label, color and mapping in one undo step with a field diff', async () => {
    const before = stateFingerprint();
    const result = await applyOperations({
      label: 'Edit',
      ops: [{
        op: 'live.updateWidget',
        input: { pageId: 'page-1', widgetId: 'w-sld', gridX: 10, gridH: 8, label: 'Speed', color: '#ff0000', mapping: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'speed' } },
      }],
    }, { registry: registry() });
    expect(result.committed).toBe(true);
    expect(result.results[0]!.value).toEqual({ widgetId: 'w-sld', changed: ['grid', 'label', 'color', 'mapping'] });
    expect(result.diff).toEqual(expect.arrayContaining([
      { entity: 'liveWidget:w-sld', field: 'gridX', from: 3, to: 10 },
      { entity: 'liveWidget:w-sld', field: 'gridH', from: 6, to: 8 },
      { entity: 'liveWidget:w-sld', field: 'label', from: undefined, to: 'Speed' },
      { entity: 'liveWidget:w-sld', field: 'mapping.type', from: 'none', to: 'effect-param' },
    ]));

    useHistory().undo();
    expect(stateFingerprint()).toBe(before);
    expect(useHistory().canUndo.value).toBe(false);
  });

  it('clears the label with null and rejects empty updates', async () => {
    await applyOperations({ label: 'Clear', ops: [{ op: 'live.updateWidget', input: { pageId: 'page-1', widgetId: 'w-btn', label: null } }] }, { registry: registry() });
    expect(widget('page-1', 'w-btn')?.label).toBeUndefined();
    const empty = await applyOperations({ label: 'Empty', ops: [{ op: 'live.updateWidget', input: { pageId: 'page-1', widgetId: 'w-btn' } }] }, { registry: registry() });
    expect(empty.findings[0]!.message).toMatch(/nothing to update/);
  });

  it('rolls back an invalid mapping', async () => {
    const before = stateFingerprint();
    const result = await applyOperations({
      label: 'Bad',
      ops: [{ op: 'live.updateWidget', input: { pageId: 'page-1', widgetId: 'w-sld', gridX: 20, mapping: { type: 'effect-param', modifierId: 'gone', paramKey: 'speed' } } }],
    }, { registry: registry() });
    expect(result.committed).toBe(false);
    expect(stateFingerprint()).toBe(before);
  });
});

describe('live.removeWidget', () => {
  it('removes a widget and undo restores it at its list position', async () => {
    const before = stateFingerprint();
    const result = await applyOperations({ label: 'Remove', ops: [{ op: 'live.removeWidget', input: { pageId: 'page-1', widgetId: 'w-btn' } }] }, { registry: registry() });
    expect(result.committed).toBe(true);
    expect(widget('page-1', 'w-btn')).toBeUndefined();
    expect(result.diff).toContainEqual(expect.objectContaining({ entity: 'liveWidget:w-btn', field: 'removed' }));

    useHistory().undo();
    expect(stateFingerprint()).toBe(before);
  });

  it('fails for unknown widgets', async () => {
    const result = await applyOperations({ label: 'x', ops: [{ op: 'live.removeWidget', input: { pageId: 'page-1', widgetId: 'nope' } }] }, { registry: registry() });
    expect(result.findings[0]).toMatchObject({ code: 'operation-failed' });
  });
});

describe('findFreeSpot', () => {
  it('falls back below all widgets when the page is full', () => {
    const page = defaultLivePage({ columns: 4, aspectRatioW: 1, aspectRatioH: 1 });
    page.widgets.push({ ...defaultLiveWidget('button', 0, 0), gridW: 4, gridH: 4 });
    expect(findFreeSpot(page, 2, 2)).toEqual({ x: 0, y: 4 });
  });
});
