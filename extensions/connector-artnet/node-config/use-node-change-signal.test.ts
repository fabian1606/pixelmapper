// @vitest-environment node
/**
 * Node-change signal of the node configuration (bridge contract rev 2):
 * re-read the node's RDM-only settings on `node` events that change the
 * node, but not on the NodeReport counter, `lastSeen` or data-flow flags;
 * bursts (BindIndex pages) count once; a node that comes back counts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, shallowRef } from 'vue';
import type { NodeState } from '../bridge/protocol-model';
import { makeNode, makePort } from '../bridge/testing/fixtures';
import { nodeSettingsSignature, stripReportCounter, useNodeChangeSignal } from './use-node-change-signal';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('nodeSettingsSignature', () => {
  it('ignores lastSeen, the NodeReport counter and data-flow flags', () => {
    const base = makeNode();
    const busy = makeNode({
      lastSeen: base.lastSeen + 3000,
      nodeReport: '#0001 [0002] OK',
      ports: base.ports.map(p => ({ ...p, output: { ...p.output, data: true, merging: true, discoveryRunning: true }, input: { ...p.input, data: true, errors: true } })),
    });
    expect(nodeSettingsSignature(busy)).toBe(nodeSettingsSignature(base));
    expect(stripReportCounter('#0001 [0123] OK')).toBe('#0001 [] OK');
  });

  it('changes with settings the node reports', () => {
    const base = nodeSettingsSignature(makeNode());
    expect(nodeSettingsSignature(makeNode({ shortName: 'Stage' }))).not.toBe(base);
    expect(nodeSettingsSignature(makeNode({ nodeReport: '#0002 [0001] Fault' }))).not.toBe(base);
    expect(nodeSettingsSignature(makeNode({ ports: [1, 2, 3, 4].map(b => makePort(b, b, b === 2 ? { output: { ...makePort(2, 2).output, merge: 'ltp' } } : {})) }))).not.toBe(base);
  });
});

describe('useNodeChangeSignal', () => {
  it('counts changes once per burst, not the baseline or the counter', () => {
    const current = shallowRef<NodeState | null>(makeNode());
    const scope = effectScope();
    const tick = scope.run(() => useNodeChangeSignal(() => current.value, 1000))!;
    current.value = makeNode({ nodeReport: '#0001 [0009] OK', lastSeen: 1 });
    vi.advanceTimersByTime(2000);
    expect(tick.value).toBe(0);

    // A restart: the BindIndex pages arrive as several node events.
    current.value = makeNode({ ports: [makePort(1, 1)] });
    current.value = makeNode({ ports: [makePort(1, 1), makePort(2, 2)] });
    vi.advanceTimersByTime(500);
    current.value = makeNode({ ports: [1, 2, 3].map(b => makePort(b, b)) });
    vi.advanceTimersByTime(999);
    expect(tick.value).toBe(0);
    vi.advanceTimersByTime(1);
    expect(tick.value).toBe(1);
    scope.stop();
  });

  it('counts a node that answers again', () => {
    const current = shallowRef<NodeState | null>(null);
    const scope = effectScope();
    const tick = scope.run(() => useNodeChangeSignal(() => current.value, 0))!;
    current.value = makeNode(); // first state: baseline
    vi.runAllTimers();
    expect(tick.value).toBe(0);
    current.value = null;
    current.value = makeNode();
    vi.runAllTimers();
    expect(tick.value).toBe(1);
    scope.stop();
  });
});
