// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { ApplyResult } from '../apply';
import { diffLines, summarizeApply } from './apply';

/** Minimal apply result with overridable fields. */
function result(over: Partial<ApplyResult>): ApplyResult {
  return { committed: false, diff: [], affected: [], findings: [], results: [], events: [], ...over };
}

describe('summarizeApply', () => {
  it('reports an action-only batch as run, not as rolled back', () => {
    const text = summarizeApply(result({ results: [{ op: 'plugins.build', kind: 'action', value: { ok: true } }] }), false, 'Build');
    expect(text.split('\n')[0]).toBe('Ran "Build": action results below (actions are not part of undo history).');
  });

  it('reports a state-changing action (modifiers.trigger) as run even with a diff', () => {
    const text = summarizeApply(result({
      results: [{ op: 'modifiers.trigger', kind: 'action', value: { changed: true } }],
      diff: [{ entity: 'modifier:m1', field: 'params.hit.pressed', from: false, to: true }],
    }), false, 'Press');
    expect(text.split('\n')[0]).toBe('Ran "Press": action results below (actions are not part of undo history).');
  });

  it('still reports a failed batch as not committed', () => {
    const text = summarizeApply(result({
      results: [{ op: 'plugins.build', kind: 'action', value: { ok: false } }],
      findings: [{ level: 'error', code: 'plugin-build-failed', message: 'compile error' }],
    }), false, 'Build');
    expect(text.split('\n')[0]).toBe('Not committed: "Build" was rolled back or changed nothing.');
  });

  it('reports committed batches with their undo group', () => {
    const text = summarizeApply(result({ committed: true, undoGroupId: 'g1' }), false, 'Wave');
    expect(text.split('\n')[0]).toBe('Committed "Wave" as one undo step (g1).');
  });
});

describe('diffLines', () => {
  it('lists added entities first and groups identical field changes', () => {
    const lines = diffLines([
      { entity: 'fixture:a', field: 'channels.3.value', from: 0, to: 255 },
      { entity: 'fixture:b', field: 'channels.3.value', from: 0, to: 255 },
      { entity: 'fixture:c', field: 'position.x', from: 0.1, to: 0.2 },
      { entity: 'modifier:m', field: 'added', to: 'Waveform · chase' },
    ]);
    expect(lines).toEqual([
      '+ modifier:m: Waveform · chase',
      'fixture a, b: channels.3.value 0 → 255',
      'fixture:c: position.x 0.1 → 0.2',
    ]);
  });
});
