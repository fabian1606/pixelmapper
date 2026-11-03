/**
 * Button scripts through the `live.*` operations: `mapping` → one action
 * with a fitting trigger, explicit `actions` / `appearance` / `inputs`,
 * findings, views / diff in the agent vocabulary, and the end-to-end path
 * through the real button runtime (press / release reach the modifier).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistory } from '~/components/engine/composables/use-history';
import { pressButton, releaseButton } from '~/composables/live-ops/button-runtime';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveModeStore } from '~/stores/live-mode-store';
import type { Preset } from '~/utils/engine/preset-types';
import type { ModifierInstance } from '~/utils/engine/types';
import { defaultLivePage, defaultLiveWidget } from '~/utils/live/types';
import { applyOperations } from '../apply';
import { readApi } from '../read-api';
import { registryWith, resetOperationState, seedScene, stateFingerprint, stubOperationGlobals } from '../test-utils';
import { liveOperations } from './live';

// ── Setup ───────────────────────────────────────

/** Manifest of the `sha256:typed` test plugin: trigger `hit`, bool `invert`, number `count`. */
const TYPED = vi.hoisted(() => ({
  hash: 'sha256:typed',
  manifest: {
    params: [
      { type: 'trigger', key: 'hit', label: 'Hit', default: { pressed: false } },
      { type: 'bool', key: 'invert', label: 'Invert', default: false },
      { type: 'number', key: 'count', label: 'Count', default: 3, min: 1, max: 10 },
    ],
  },
}));

// Known manifest for the typed plugin; everything else falls through to the real store.
vi.mock('~/utils/plugins/plugin-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('~/utils/plugins/plugin-store')>();
  return { ...orig, getManifest: (hash: string) => (hash === TYPED.hash ? TYPED.manifest : orig.getManifest(hash)) };
});

/** A modifier instance of the typed plugin. */
function typedModifier(id: string): ModifierInstance {
  return {
    id,
    plugin: TYPED.hash,
    signature: 'rgb',
    targetChannels: [],
    blendMode: 'add',
    strength: 1,
    speed: { mode: 'beat', timeMs: 2000, beatValue: 1, beatOffset: 0 },
    distribution: {} as ModifierInstance['distribution'],
    params: { hit: { pressed: false }, invert: false, count: 3 },
  } as ModifierInstance;
}

/** Saved preset stub (only id / name / type matter here). */
const preset = (id: string, type?: Preset['type']): Preset => ({ id, name: id, createdAt: '', categories: [], ...(type ? { type } : {}) });

beforeAll(stubOperationGlobals);
beforeEach(() => {
  resetOperationState();
  seedScene([{ id: 'fx-a' }]);
  const engine = useEngineStore();
  engine.modifiers = [typedModifier('mod-1')];
  engine.savedPresets = [preset('warm'), preset('burst', 'flash')];
  const page = defaultLivePage({ id: 'page-1', name: 'Main' });
  page.widgets.push({ ...defaultLiveWidget('button', 0, 0), id: 'w-btn' });
  page.widgets.push({ ...defaultLiveWidget('slider', 3, 0), id: 'w-sld' });
  useLiveModeStore().loadPages([page]);
});

const registry = () => registryWith(...liveOperations);

/** Runs ops in one batch. */
const apply = (ops: Array<{ op: string; input: unknown }>) => applyOperations({ label: 'test', ops }, { registry: registry() });

/** Stored widget by id. */
const widget = (id: string) => readApi.livePages()[0]!.widgets.find(w => w.id === id);

/** Adds a button with `mapping`; returns its stored first action. */
async function buttonFor(mapping: Record<string, unknown>) {
  const res = await apply([{ op: 'live.addWidget', input: { pageId: 'page-1', type: 'button', mapping } }]);
  expect(res.committed, JSON.stringify(res.findings)).toBe(true);
  const { widgetId } = res.results[0]!.value as { widgetId: string };
  return { res, widgetId, actions: widget(widgetId)!.actions! };
}

// ── mapping → one action ────────────────────────

describe('button mapping → actions', () => {
  it('picks a trigger that delivers the edges the target needs', async () => {
    const cases: Array<[Record<string, unknown>, string, Record<string, unknown>?]> = [
      [{ type: 'effect-param', modifierId: 'mod-1', paramKey: 'hit' }, 'hold'],
      [{ type: 'effect-param', modifierId: 'mod-1', paramKey: 'invert' }, 'toggle', { behavior: 'hold' }],
      [{ type: 'effect-param', modifierId: 'mod-1', paramKey: 'invert', behavior: 'latch' }, 'toggle', { behavior: 'hold' }],
      [{ type: 'effect-param', modifierId: 'mod-1', paramKey: 'invert', behavior: 'hold' }, 'hold', { behavior: 'hold' }],
      [{ type: 'preset', presetId: 'warm' }, 'press'],
      [{ type: 'preset', presetId: 'burst' }, 'hold'],
      [{ type: 'global-function', function: 'strobe' }, 'hold'],
      [{ type: 'global-function', function: 'speed' }, 'press'],
      [{ type: 'global-function', function: 'speed', config: { behavior: 'hold' } }, 'hold'],
      [{ type: 'global-function', function: 'stop-all' }, 'long'],
      [{ type: 'page-switch', targetPageId: 'page-1' }, 'press'],
      [{ type: 'dimmer-group', fixtureId: 'fx-a' }, 'hold'],
    ];
    for (const [mapping, trigger, extra] of cases) {
      const { actions, res } = await buttonFor(mapping);
      expect(actions, JSON.stringify(mapping)).toHaveLength(1);
      expect(actions[0]!.trigger, JSON.stringify(mapping)).toBe(trigger);
      if (extra) expect(actions[0]!.action).toMatchObject(extra);
      expect(res.findings, JSON.stringify(mapping)).toEqual([]);
    }
  });

  it('writes actions, not mapping, and replaces the whole script on update', async () => {
    const { widgetId } = await buttonFor({ type: 'preset', presetId: 'warm' });
    expect(widget(widgetId)!.mapping).toEqual({ type: 'none' });
    const res = await apply([{ op: 'live.updateWidget', input: { pageId: 'page-1', widgetId, mapping: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'hit' } } }]);
    expect(res.results[0]!.value).toEqual({ widgetId, changed: ['actions'] });
    expect(widget(widgetId)!.actions).toMatchObject([{ trigger: 'hold', action: { type: 'effect-param', paramKey: 'params.hit' } }]);
    // Diff paths cover the script, in the agent vocabulary.
    expect(res.diff).toEqual(expect.arrayContaining([
      { entity: `liveWidget:${widgetId}`, field: 'actions.0.trigger', from: 'press', to: 'hold' },
      expect.objectContaining({ entity: `liveWidget:${widgetId}`, field: 'actions.0.action.paramKey', to: 'hit' }),
    ]));
  });
});

// ── Explicit actions / appearance / inputs ──────

describe('button actions input', () => {
  it('stores a script with appearance and inputs, lists it in the agent vocabulary, undoes', async () => {
    const before = stateFingerprint();
    const res = await apply([
      {
        op: 'live.addWidget',
        input: {
          pageId: 'page-1',
          type: 'button',
          label: 'Drop',
          actions: [
            { trigger: 'press', action: { type: 'preset', presetId: 'warm' }, duration: { mode: 'beats', beats: 4 } },
            { trigger: 'long', action: { type: 'global-function', function: 'stop-all' }, hold: { mode: 'time', ms: 1500 } },
            { trigger: 'hold', action: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'hit' } },
          ],
          appearance: { active: 'pulse', inactive: 'off' },
          inputs: [{ source: 'key', address: 'KeyB' }, { source: 'midi', address: { type: 'note', channel: 1, number: 36 } }],
        },
      },
      { op: 'live.listPages', input: {} },
    ]);
    expect(res.committed).toBe(true);
    expect(res.findings).toEqual([]);
    const { widgetId } = res.results[0]!.value as { widgetId: string };
    const stored = widget(widgetId)!;
    expect(stored.actions).toHaveLength(3);
    expect(stored.actions![0]).toMatchObject({ trigger: 'press', duration: { mode: 'beats', beats: 4 }, triggerTouched: true });
    expect(stored.actions![1]).toMatchObject({ trigger: 'long', hold: { mode: 'time', ms: 1500 }, action: { globalFunction: 'stop-all' } });
    expect(stored.appearance).toEqual({ active: 'pulse', inactive: 'off' });
    expect(stored.inputs).toEqual([{ source: 'key', address: 'KeyB' }, { source: 'midi', address: { type: 'note', channel: 1, number: 36 } }]);

    const { pages } = res.results[1]!.value as { pages: Array<{ widgets: Array<Record<string, unknown>> }> };
    const view = pages[0]!.widgets.find(w => w.id === widgetId)!;
    expect(view.actions).toEqual([
      { id: expect.any(String), trigger: 'press', action: { type: 'preset', presetId: 'warm' }, duration: { mode: 'beats', beats: 4 } },
      { id: expect.any(String), trigger: 'long', action: { type: 'global-function', function: 'stop-all', config: {} }, hold: { mode: 'time', ms: 1500 } },
      { id: expect.any(String), trigger: 'hold', action: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'hit' } },
    ]);
    expect(view).toMatchObject({ appearance: { active: 'pulse', inactive: 'off' }, inputs: [{ source: 'key', address: 'KeyB' }, { source: 'midi', address: { type: 'note', channel: 1, number: 36 } }] });
    expect(view.mappingSummary).toBe('press → preset: warm; long → global-function: stop-all; hold → effect-param: modifier mod-1 → hit');

    useHistory().undo();
    expect(stateFingerprint()).toBe(before);
  });

  it('updates appearance / inputs and clears them with null', async () => {
    await apply([{ op: 'live.updateWidget', input: { pageId: 'page-1', widgetId: 'w-btn', appearance: { active: 'blink' }, inputs: [{ source: 'key', address: 'Space' }] } }]);
    expect(widget('w-btn')).toMatchObject({ appearance: { active: 'blink' }, inputs: [{ source: 'key', address: 'Space' }] });
    const res = await apply([{ op: 'live.updateWidget', input: { pageId: 'page-1', widgetId: 'w-btn', appearance: null, inputs: null } }]);
    expect(res.results[0]!.value).toEqual({ widgetId: 'w-btn', changed: ['appearance', 'inputs'] });
    expect(widget('w-btn')!.appearance).toBeUndefined();
    expect(widget('w-btn')!.inputs).toBeUndefined();
  });

  it('rejects button fields on other widgets, mapping + actions together, and invalid actions', async () => {
    const onSlider = await apply([{ op: 'live.updateWidget', input: { pageId: 'page-1', widgetId: 'w-sld', actions: [{ trigger: 'press', action: { type: 'none' } }] } }]);
    expect(onSlider.findings[0]!.message).toMatch(/for button widgets only/);
    const both = await apply([{ op: 'live.addWidget', input: { pageId: 'page-1', type: 'button', mapping: { type: 'none' }, actions: [{ trigger: 'press', action: { type: 'none' } }] } }]);
    expect(both.findings[0]!.message).toMatch(/not both/);
    const badTrigger = await apply([{ op: 'live.addWidget', input: { pageId: 'page-1', type: 'button', actions: [{ trigger: 'tap', action: { type: 'none' } }] } }]);
    expect(badTrigger.findings[0]).toMatchObject({ code: 'invalid-input' });
    const empty = await apply([{ op: 'live.addWidget', input: { pageId: 'page-1', type: 'button', actions: [] } }]);
    expect(empty.findings[0]).toMatchObject({ code: 'invalid-input' });
  });
});

// ── Findings ────────────────────────────────────

describe('button action findings', () => {
  /** Adds a button with `actions`; returns the apply result. */
  const add = (actions: unknown[]) => apply([{ op: 'live.addWidget', input: { pageId: 'page-1', type: 'button', actions } }]);

  it('rolls back unknown modifiers, params and presets', async () => {
    const before = stateFingerprint();
    const modifier = await add([{ trigger: 'hold', action: { type: 'effect-param', modifierId: 'nope', paramKey: 'hit' } }]);
    expect(modifier.committed).toBe(false);
    expect(modifier.findings).toContainEqual(expect.objectContaining({ level: 'error', code: 'modifier-not-found', message: expect.stringMatching(/^action 1 \(hold\): /) }));
    const param = await add([{ trigger: 'press', action: { type: 'none' } }, { trigger: 'hold', action: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'nope' } }]);
    expect(param.findings).toContainEqual(expect.objectContaining({ code: 'param-not-found', message: expect.stringMatching(/^action 2 \(hold\)/) }));
    const presetMissing = await add([{ trigger: 'press', action: { type: 'preset', presetId: 'gone' } }]);
    expect(presetMissing.findings).toContainEqual(expect.objectContaining({ level: 'error', code: 'preset-not-found' }));
    expect(stateFingerprint()).toBe(before);
  });

  it('warns about param types a button cannot drive and triggers that miss an edge', async () => {
    const number = await add([{ trigger: 'press', action: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'count' } }]);
    expect(number.findings).toEqual([expect.objectContaining({ level: 'warning', code: 'mapping-ignored-by-widget', message: expect.stringMatching(/number param "count"/) })]);
    const stuck = await add([{ trigger: 'press', action: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'hit' } }]);
    expect(stuck.findings).toEqual([expect.objectContaining({ level: 'warning', code: 'trigger-never-released' })]);
    // A timed press releases after its duration: fine.
    const timed = await add([{ trigger: 'press', action: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'hit' }, duration: { mode: 'time', ms: 200 } }]);
    expect(timed.findings).toEqual([]);
    const latch = await add([{ trigger: 'toggle', action: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'invert', behavior: 'latch' } }]);
    expect(latch.findings).toEqual([expect.objectContaining({ level: 'warning', code: 'bool-latch-not-released' })]);
    const ignored = await add([{ trigger: 'hold', action: { type: 'global-function', function: 'strobe' }, duration: { mode: 'beats', beats: 2 } }]);
    expect(ignored.findings).toEqual([expect.objectContaining({ level: 'warning', code: 'duration-ignored' })]);
  });
});

// ── Runtime ─────────────────────────────────────

describe('button created by live.addWidget, played through the button runtime', () => {
  it('press / release reach the modifier\'s trigger param as press / release edges', async () => {
    const { widgetId, actions } = await buttonFor({ type: 'effect-param', modifierId: 'mod-1', paramKey: 'hit' });
    const hit = () => useEngineStore().modifiers[0]!.params.hit as { pressed: boolean; pressedAt?: number; releasedAt?: number; clicks?: number };

    pressButton(actions, { key: widgetId });
    expect(hit()).toMatchObject({ pressed: true, clicks: 1 });
    expect(hit().pressedAt).toBeTypeOf('number');
    expect(hit().releasedAt).toBeUndefined();

    releaseButton(actions, { key: widgetId });
    expect(hit()).toMatchObject({ pressed: false, clicks: 1 });
    expect(hit().releasedAt).toBeTypeOf('number');
  });

  it('a bool param mapped with behavior latch toggles on, then off', async () => {
    const { widgetId, actions } = await buttonFor({ type: 'effect-param', modifierId: 'mod-1', paramKey: 'invert' });
    const invert = () => useEngineStore().modifiers[0]!.params.invert;
    pressButton(actions, { key: widgetId });
    releaseButton(actions, { key: widgetId });
    expect(invert()).toBe(true);
    pressButton(actions, { key: widgetId });
    releaseButton(actions, { key: widgetId });
    expect(invert()).toBe(false);
  });
});
