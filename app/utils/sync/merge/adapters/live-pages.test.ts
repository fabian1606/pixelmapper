// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { LivePage } from '~/utils/live/types';
import { listRebaseAdapterTypes, rebaseChange, registerRebaseAdapter } from '../index';
import { makeState } from './test-state';

/** Tests of the live-mode adapters, engine adapters and the registry. */

/** Page with widgets and a section. */
const page = (id: string, widgetIds: string[], over: Partial<LivePage> = {}): LivePage => ({
  id,
  name: id,
  widgets: widgetIds.map(w => ({ id: w, type: 'button', gridX: 0, gridY: 0, gridW: 1, gridH: 1, mapping: { type: 'none' } })),
  sections: [{ id: 's1', source: 'all-presets', mode: 'flash', members: [] }],
  ...over,
} as unknown as LivePage);

const state = () => makeState({ livePages: [page('p1', ['w1', 'w2'])], liveControllers: [{ id: 'c1', definitionKey: 'k' }] });

describe('live.* commands', () => {
  // [type, payload, skipped?]
  const cases: Array<[string, Record<string, unknown>, boolean]> = [
    ['live.updatePage', { pageId: 'p1', changes: { name: 'x' } }, false],
    ['live.updatePage', { pageId: 'gone', changes: {} }, true],
    ['live.addWidget', { pageId: 'gone', widget: {} }, true],
    ['live.moveWidget', { pageId: 'p1', widgetId: 'w1', gridX: 1, gridY: 1, gridW: 1, gridH: 1 }, false],
    ['live.moveWidget', { pageId: 'p1', widgetId: 'gone', gridX: 1, gridY: 1, gridW: 1, gridH: 1 }, true],
    ['live.updateMapping', { pageId: 'p1', widgetId: 'gone', patch: {} }, true],
    ['live.updateChildMapping', { pageId: 'p1', twinId: 'w2', controlId: 'x', patch: {} }, false],
    ['live.updateSection', { pageId: 'p1', sectionId: 's1', changes: {} }, false],
    ['live.setSectionMembers', { pageId: 'p1', sectionId: 'gone', members: [] }, true],
    ['section.setActive', { pageId: 'p1', sectionId: 's1', keys: [] }, false],
    ['live.removeController', { instanceId: 'c1', definitionKey: 'k' }, false],
    ['live.removeController', { instanceId: 'gone', definitionKey: 'k' }, true],
    ['live.removePage', { pageId: 'gone' }, true],
    ['live.addPage', { page: page('new', []) }, false],
  ];

  it.each(cases)('%s %j → skipped=%s', (type, payload, skipped) => {
    expect(Boolean(rebaseChange({ type, payload }, state()).skipped)).toBe(skipped);
  });

  it('batch payloads keep existing widgets only', () => {
    const res = rebaseChange({ type: 'live.batchMoveWidgets', payload: { pageId: 'p1', updates: [{ widgetId: 'w1' }, { widgetId: 'gone' }] } }, state());
    expect(res.payload).toEqual({ pageId: 'p1', updates: [{ widgetId: 'w1' }] });
    const grouped = rebaseChange({ type: 'live.groupWidgets', payload: { pageId: 'p1', widgetIds: ['gone'], groupId: 'g' } }, state());
    expect(grouped.skipped).toBeTruthy();
  });

  it('removeWidget keeps a widget modified remotely (with previous)', () => {
    const previous = state();
    const current = makeState({ livePages: [page('p1', ['w1', 'w2'])] });
    current.livePages![0]!.widgets[0]!.label = 'remote edit';
    const res = rebaseChange({ type: 'live.removeWidget', payload: { pageId: 'p1', widgetId: 'w1' } }, current, previous);
    expect(res.skipped).toBeTruthy();
    expect(res.conflicts).toMatchObject([{ entityId: 'w1', kind: 'remove-modify' }]);
  });
});

describe('engine live-ops', () => {
  it('engine.bpm reports a concurrent BPM change', () => {
    const res = rebaseChange({ type: 'engine.bpm', payload: { bpm: 128 } }, makeState({ globalBpm: 100 }), makeState({ globalBpm: 120 }));
    expect(res.payload).toEqual({ bpm: 128 });
    expect(res.conflicts).toMatchObject([{ path: ['globalBpm'], local: 128, remote: 100 }]);
  });
});

describe('registry', () => {
  it('passes unknown types through unchanged (deep copy)', () => {
    const payload = { a: { b: 1 } };
    const res = rebaseChange({ type: 'my-ext/doThing', payload }, makeState());
    expect(res).toEqual({ payload, conflicts: [] });
    expect(res.payload).not.toBe(payload);
  });

  it('falls back to pass-through when an adapter throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerRebaseAdapter('test.throws', () => { throw new Error('boom'); });
    expect(rebaseChange({ type: 'test.throws', payload: { x: 1 } }, makeState()).payload).toEqual({ x: 1 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('covers every persisted command and persistent live-op', () => {
    const expected = [
      'AddFixtures', 'DeleteNodes', 'GroupNodes', 'UngroupNodes', 'RenameNode', 'MoveFixture', 'RotateFixture',
      'SetChannelValues', 'SetChannelRange', 'UpdateDmx', 'SetFixtureKindConfig', 'SetExtensionData', 'SetModifiers',
      'SavePreset', 'DeletePreset', 'OverwritePreset', 'UpdatePresetMetadata', 'SetActivePreset',
      'live.addPage', 'live.removePage', 'live.updatePage', 'live.addWidget', 'live.removeWidget', 'live.moveWidget',
      'live.updateMapping', 'live.batchMoveWidgets', 'live.groupWidgets', 'live.ungroupWidgets', 'live.batchSetGroupIds',
      'live.updateChildMapping', 'live.addSection', 'live.removeSection', 'live.updateSection', 'live.setSectionMembers',
      'live.addController', 'live.removeController', 'live.setControllerInstance',
      'preset.set', 'color.override', 'fixture.drag', 'engine.bpm', 'engine.speed', 'engine.clock',
      'modifier.update', 'modifier.sync', 'channel.update', 'section.setActive',
    ];
    const registered = listRebaseAdapterTypes();
    for (const type of expected) expect(registered).toContain(type);
  });
});
