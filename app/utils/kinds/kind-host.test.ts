/**
 * Fixture-kind host (plan P5.1): building, rebuilding with preserved channel
 * values, migration, coordinates, the config command, persistence and
 * addressing.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { defineFixtureKind, type Json } from '@pixelmapper/extension-api';
import { registerExtension, resetRegistry } from '~/utils/extensions/registry';
import { serializeFixture, deserializeFixture } from '~/utils/engine/serialize';
import { assignIdsAndAddresses } from '~/utils/engine/addressing';
import { SetFixtureKindConfigCommand } from '~/components/engine/commands/set-fixture-kind-config-command';
import { Fixture } from '~/utils/engine/core/fixture';
import { beamWorldPx, createKindFixture, getKind, kindToWorld, kindWorldAabb, rebuildKindFixture, worldToKind } from './kind-host';

/** A row of `count` RGB pixels spaced 10 px, centered on the origin. */
interface RowConfig { count: number; spacing?: number }

const row = defineFixtureKind<RowConfig>({
  id: 'pixel-row',
  version: '2.0.0',
  label: 'Pixel row',
  icon: 'minus',
  description: 'Test kind: a straight row of RGB pixels.',
  configSchema: [{ key: 'count', type: 'int', min: 1, max: 100, default: 3, label: 'Pixels' }],
  defaults: () => ({ count: 3 }),
  build(config) {
    const n = config.count;
    const sp = config.spacing ?? 10;
    const x0 = -((n - 1) * sp) / 2;
    return {
      channels: Array.from({ length: n * 3 }, (_, i) => ({
        type: (['RED', 'GREEN', 'BLUE'] as const)[i % 3]!,
        role: 'COLOR' as const,
        addressOffset: i,
        colorValue: ['#FF0000', '#00FF00', '#0000FF'][i % 3]!,
        defaultValue: 0,
        beamId: `p${Math.floor(i / 3)}`,
      })),
      beams: Array.from({ length: n }, (_, p) => ({ id: `p${p}`, pos: { x: x0 + p * sp, y: 0 } })),
      body: [{ type: 'polyline' as const, points: [{ x: x0, y: 0 }, { x: -x0, y: 0 }], width: 4, style: {} }],
      handles: [{ id: 'end', pos: { x: -x0, y: 0 }, role: 'anchor' as const }],
      bounds: { x: x0 - 5, y: -5, w: -2 * x0 + 10, h: 10 },
    };
  },
  // v1 stored `pixels` instead of `count`.
  migrate: (config, from) => (from.startsWith('1.') ? { count: (config as { pixels: number }).pixels } : config as RowConfig),
  library: { category: 'Pixel Bar' },
  spansUniverses: true,
});

beforeEach(() => {
  resetRegistry();
  registerExtension({
    id: 'test-kinds', version: '1.0.0', apiVersion: '^1.0.0', displayName: 'Test kinds',
    description: 'Fixture kinds for tests.', contributes: { fixtureKinds: [row as never] },
  });
});

const def = () => getKind('pixel-row')!.def;

describe('kind host', () => {
  it('builds channels, beams and size from the config', () => {
    const f = createKindFixture(def(), { id: 'a', config: { count: 4 } as Json, position: { x: 0.5, y: 0.5 } });
    expect(f.channels).toHaveLength(12);
    expect(f.beams.map(b => b.offsetPx)).toEqual([{ x: -15, y: 0 }, { x: -5, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 }]);
    expect(f.kind?.compiled?.handles[0]!.id).toBe('end');
    expect(f.fixtureSize.x).toBeCloseTo(20 / 18);
  });

  it('keeps programmed channel values across rebuilds', () => {
    const f = createKindFixture(def(), { id: 'a', config: { count: 2 } as Json });
    f.channels[0]!.chaserConfig.stepValues[0] = 200;
    f.kind!.config = { count: 3 };
    rebuildKindFixture(f);
    expect(f.channels).toHaveLength(9);
    expect(f.channels[0]!.chaserConfig.stepValues[0]).toBe(200);
  });

  it('migrates older config versions on rebuild', () => {
    const f = createKindFixture(def(), { id: 'a' });
    f.kind = { id: 'pixel-row', version: '1.0.0', config: { pixels: 5 } };
    rebuildKindFixture(f);
    expect(f.kind.version).toBe('2.0.0');
    expect(f.kind.config).toEqual({ count: 5 });
    expect(f.beams).toHaveLength(5);
  });

  it('converts coordinates with position and rotation', () => {
    const f = createKindFixture(def(), { id: 'a', position: { x: 0.5, y: 0.5 } });
    f.rotation = 90;
    const w = kindToWorld(f, { x: 10, y: 0 });
    expect(w.x).toBeCloseTo(1500);
    expect(w.y).toBeCloseTo(1510);
    const back = worldToKind(f, w);
    expect(back.x).toBeCloseTo(10);
    expect(back.y).toBeCloseTo(0);
    expect(beamWorldPx(f, f.beams[0]!).y).toBeCloseTo(1490);
    const box = kindWorldAabb(f)!;
    expect(box.maxY - box.minY).toBeCloseTo(30);
  });

  it('SetFixtureKindConfig executes and undoes', () => {
    const f = createKindFixture(def(), { id: 'a' });
    const cmd = new SetFixtureKindConfigCommand([f], 'a', f.kind!.config as Json, { count: 6 });
    cmd.execute();
    expect(f.beams).toHaveLength(6);
    cmd.undo();
    expect(f.beams).toHaveLength(3);
    expect(cmd.toPayload().after).toEqual({ count: 6 });
  });

  it('persists the kind and rebuilds on load (compiled cache without the extension)', () => {
    const f = createKindFixture(def(), { id: 'a', config: { count: 2 } as Json });
    const data = JSON.parse(JSON.stringify(serializeFixture(f)));
    expect(deserializeFixture(data).kind?.config).toEqual({ count: 2 });

    resetRegistry();
    const offline = deserializeFixture(data);
    expect(offline.beams).toHaveLength(2);
    expect(offline.kind?.compiled?.beams).toHaveLength(2);
  });

  it('assigns addresses; spansUniverses kinds may cross universe boundaries', () => {
    const existing = new Fixture('x', Array.from({ length: 500 }, (_, i) => ({ type: 'DIMMER', addressOffset: i, role: 'DIMMER', colorValue: '#fff', defaultValue: 0 } as never)), 1);
    const strip = createKindFixture(def(), { id: 'p', config: { count: 10 } as Json });
    const plain = new Fixture('q', Array.from({ length: 30 }, (_, i) => ({ type: 'DIMMER', addressOffset: i, role: 'DIMMER', colorValue: '#fff', defaultValue: 0 } as never)), 1);
    assignIdsAndAddresses([strip], [existing]);
    expect(strip.startAddress).toBe(501);
    assignIdsAndAddresses([plain], [existing]);
    expect(plain.startAddress).toBe(513);
  });
});
