/**
 * WP-L agent ergonomics of `modifiers.*`: the `color` option (colored scalar
 * chases in one op), `dark-base` warnings (end-of-batch, with the fix) and
 * the explicit default direction (left→right along x, `direction`).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApplyRequest, Finding } from '@pixelmapper/agent-kit';
import { useHistory } from '~/components/engine/composables/use-history';
import { resolveRanks } from '~/utils/engine/distribution/order';
import { applyOperations } from '../apply';
import { readApi } from '../read-api';
import { registryWith, resetOperationState, seedScene, stateFingerprint, stubOperationGlobals } from '../test-utils';
import { channelOperations } from './channels';
import { modifierOperations } from './modifiers';

beforeAll(stubOperationGlobals);
beforeEach(() => {
  resetOperationState();
  // Two rows (front y .8, back y .2) that share x: the PCA axis of this rig runs top→bottom.
  seedScene([
    { id: 'f1', x: 0.2, y: 0.8 }, { id: 'f2', x: 0.5, y: 0.8 }, { id: 'f3', x: 0.8, y: 0.8 },
    { id: 'b1', x: 0.2, y: 0.2 }, { id: 'b2', x: 0.5, y: 0.2 }, { id: 'b3', x: 0.8, y: 0.2 },
  ]);
});

/** Runs a batch with modifier + channel operations. */
function apply(request: ApplyRequest) {
  return applyOperations(request, { registry: registryWith(...modifierOperations, ...channelOperations), actor: 'agent:test' });
}

/** Base value (DMX) of a channel type on a fixture. */
function base(id: string, type: string): number | undefined {
  return readApi.fixtureDetail(id)?.channels.find(c => c.type === type)?.value;
}

/** `dark-base` findings of a result. */
const dark = (findings: Finding[]) => findings.filter(f => f.code === 'dark-base');

/** Sets every fixture's dimmer base to full. */
async function dimmersUp() {
  const ids = readApi.fixtures().map(f => String(f.id));
  await apply({ label: 'Dimmers', ops: [{ op: 'channels.set', input: { writes: [{ fixtureIds: ids, channelType: 'DIMMER', value: 1 }] } }] });
}

describe('modifiers.add color', () => {
  it('sets the base color and raises a zero dimmer in the same undo step', async () => {
    const before = stateFingerprint();
    const res = await apply({ label: 'Blue chase', ops: [{ op: 'modifiers.add', input: { plugin: 'waveform', recipe: 'chase', color: '#0000ff' } }] });
    expect(res.committed).toBe(true);
    expect(dark(res.findings)).toEqual([]);
    expect(res.findings.some(f => f.code === 'base-color-set')).toBe(true);
    const value = res.results[0]!.value as { baseColor: { fixtureIds: string[]; dimmerRaised: string[] } };
    expect(value.baseColor.fixtureIds).toHaveLength(6);
    expect(value.baseColor.dimmerRaised).toHaveLength(6);
    expect([base('f1', 'RED'), base('f1', 'GREEN'), base('f1', 'BLUE'), base('f1', 'DIMMER')]).toEqual([0, 0, 255, 255]);
    useHistory().undo();
    expect(stateFingerprint()).toBe(before);
  });

  it('keeps a programmed dimmer and recolors through modifiers.update', async () => {
    const id = 'c';
    await apply({ label: 'Add', ops: [{ op: 'channels.set', input: { writes: [{ fixtureIds: ['f1'], channelType: 'DIMMER', value: 0.5 }] } }, { op: 'modifiers.add', input: { plugin: 'waveform', id, targets: { fixtureIds: ['f1'] } } }] });
    const res = await apply({ label: 'Red', ops: [{ op: 'modifiers.update', input: { modifierId: id, color: '#ff0000' } }] });
    expect(res.committed).toBe(true);
    expect((res.results[0]!.value as { baseColor: { dimmerRaised: string[] } }).baseColor.dimmerRaised).toEqual([]);
    expect([base('f1', 'RED'), base('f1', 'BLUE'), base('f1', 'DIMMER')]).toEqual([255, 0, 128]);
  });

  it('rejects a malformed color', async () => {
    const res = await apply({ label: 'Bad', ops: [{ op: 'modifiers.add', input: { plugin: 'waveform', color: 'blue' } }] });
    expect(res.committed).toBe(false);
    expect(res.findings[0]!.code).toBe('invalid-input');
  });
});

describe('dark-base warning', () => {
  it('warns with a channels.set fix when a scale chase sits on a zero dimmer', async () => {
    const res = await apply({ label: 'Chase', dryRun: true, ops: [{ op: 'modifiers.add', input: { plugin: 'waveform', recipe: 'chase' } }] });
    const [w] = dark(res.findings);
    expect(w?.level).toBe('warning');
    expect(w?.message).toMatch(/DIMMER base is 0/);
    expect(w?.message).toContain('"op":"channels.set"');
  });

  it('is silent when a later op of the same batch lights the base', async () => {
    const ids = readApi.fixtures().map(f => String(f.id));
    const res = await apply({
      label: 'Chase then dimmer',
      ops: [
        { op: 'modifiers.add', input: { plugin: 'waveform', recipe: 'chase' } },
        { op: 'channels.set', input: { writes: [{ fixtureIds: ids, channelType: 'DIMMER', value: 1 }] } },
      ],
    });
    expect(res.committed).toBe(true);
    expect(dark(res.findings)).toEqual([]);
  });

  it('warns about a black color base, and not for absolute output on its own channels', async () => {
    await dimmersUp();
    const ids = readApi.fixtures().map(f => String(f.id));
    await apply({ label: 'Black', ops: [{ op: 'channels.set', input: { writes: [{ fixtureIds: ids, color: '#000000' }] } }] });
    const chase = await apply({ label: 'Chase', dryRun: true, ops: [{ op: 'modifiers.add', input: { plugin: 'waveform' } }] });
    expect(dark(chase.findings)[0]?.message).toMatch(/color base is black/);
    const shift = await apply({ label: 'Color', dryRun: true, ops: [{ op: 'modifiers.add', input: { plugin: 'colorAdjust' } }] });
    expect(dark(shift.findings)).toEqual([]);
  });

  it('warns for modifiers.update and applyRecipe too', async () => {
    await dimmersUp();
    await apply({ label: 'Add', ops: [{ op: 'modifiers.add', input: { plugin: 'waveform', id: 'w' } }] });
    await apply({ label: 'Off', ops: [{ op: 'channels.set', input: { writes: [{ fixtureIds: ['f1'], channelType: 'DIMMER', value: 0 }] } }] });
    const res = await apply({ label: 'Upd', ops: [{ op: 'modifiers.update', input: { modifierId: 'w', strength: 0.5 } }] });
    expect(dark(res.findings)[0]?.message).toMatch(/stays dark on f1:/);
  });
});

describe('default direction', () => {
  /** Ranks of the order spread of modifier `id`, resolved like the engine. */
  function ranks(id: string): Record<string, number> {
    const m = readApi.modifier(id)!;
    return resolveRanks(m.distribution, readApi.fixtures().map(f => ({ id: f.id, x: f.x, y: f.y }))).ranks;
  }

  it('runs a chase left→right along x: fixtures sharing x move together', async () => {
    await dimmersUp();
    await apply({ label: 'Chase', ops: [{ op: 'modifiers.add', input: { plugin: 'waveform', id: 'c', spread: { type: 'order' } } }] });
    const r = ranks('c');
    expect(r.f1).toBe(r.b1);
    expect(r.f1).toBeLessThan(r.f2!);
    expect(r.f2).toBeLessThan(r.f3!);
  });

  it('places a spatial handle left→right and honors direction', async () => {
    await apply({ label: 'Wave', ops: [{ op: 'modifiers.add', input: { plugin: 'waveform', id: 'w', spread: { type: 'spatial' } } }] });
    const d = readApi.modifier('w')!.distribution;
    expect(d.origin.x).toBeCloseTo(0.2);
    expect(d.end.x).toBeCloseTo(0.8);
    expect(d.origin.y).toBeCloseTo(d.end.y);
    await apply({ label: 'Down', ops: [{ op: 'modifiers.update', input: { modifierId: 'w', spread: { type: 'spatial', direction: 'bottom-to-top' } } }] });
    const up = readApi.modifier('w')!.distribution;
    expect(up.origin.y).toBeCloseTo(0.8);
    expect(up.end.y).toBeCloseTo(0.2);
  });

  it('orders by direction: top-to-bottom puts the back row first', async () => {
    await apply({ label: 'Chase', ops: [{ op: 'modifiers.add', input: { plugin: 'waveform', id: 'c', spread: { type: 'order', direction: 'top-to-bottom' } } }] });
    const r = ranks('c');
    expect(r.b1).toBe(r.b3);
    expect(r.b1).toBeLessThan(r.f1!);
  });
});
