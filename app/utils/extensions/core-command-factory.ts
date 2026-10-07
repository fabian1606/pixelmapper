/**
 * Core command factory exposed to extensions as `ctx.commands` (ADR §5.8).
 *
 * Translates the id-based, model-agnostic API arguments into the core's
 * command classes (which hold live model references). Factories whose core
 * support lands in a later plan phase throw a descriptive error.
 */
import type { ChannelRangeWrite, Command, CoreCommandFactory, FixtureId } from '@pixelmapper/extension-api';
import type { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import { useEngineStore } from '~/stores/engine-store';
import {
  SetChannelValuesCommand,
  createSnapshot,
  type SnapshotMap,
} from '~/components/engine/commands/set-channel-values-command';
import { SetChannelRangeCommand, type RangeSnapshotMap } from '~/components/engine/commands/set-channel-range-command';
import { RenameNodeCommand } from '~/components/engine/commands/rename-command';
import { MoveFixtureCommand } from '~/components/engine/commands/move-fixture-command';
import { RotateFixtureCommand } from '~/components/engine/commands/rotate-fixture-command';

/** Error for factories whose core support is not implemented yet. */
function notYet(name: string, phase: string): never {
  throw new Error(`[extension-api] commands.${name} is not available yet (arrives with plan ${phase}).`);
}

/** Finds a fixture or throws a readable error. */
function requireFixture(id: FixtureId): Fixture {
  const fixture = useEngineStore().flatFixtures.find(f => f.id === id);
  if (!fixture) throw new Error(`[extension-api] fixture "${String(id)}" not found`);
  return fixture as Fixture;
}

/** Finds a scene node (fixture or group) by id. */
function findNode(nodes: readonly SceneNode[], id: string | number): SceneNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n instanceof FixtureGroup) {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** Clamps a DMX byte. */
const dmx = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Range writes for several channels as one `SetChannelRangeCommand`. */
function setChannelRanges({ changes, description }: { changes: ChannelRangeWrite[]; description?: string }): Command {
  const snapshots: RangeSnapshotMap = new Map();
  for (const { fixtureId, channelIndex, min, max } of changes) {
    const fixture = requireFixture(fixtureId);
    const channel = fixture.channels[channelIndex];
    if (!channel) throw new Error(`[extension-api] channel ${channelIndex} not found on fixture "${String(fixtureId)}"`);
    snapshots.set(
      { fixture, channelIndex },
      {
        before: { rangeMin: channel.rangeMin ?? 0, rangeMax: channel.rangeMax ?? 255 },
        after: { rangeMin: dmx(Math.min(min, max)), rangeMax: dmx(Math.max(min, max)) },
      },
    );
  }
  return new SetChannelRangeCommand(snapshots, description);
}

/** Creates the factory. Stateless; safe to share. */
export function createCoreCommandFactory(): CoreCommandFactory {
  return {
    setChannelValues({ fixtureId, values, description }): Command {
      const fixture = requireFixture(fixtureId);
      const snapshots: SnapshotMap = new Map();
      for (const { channelIndex, value } of values) {
        const channel = fixture.channels[channelIndex];
        if (!channel) continue;
        const before = createSnapshot(channel);
        const after = createSnapshot(channel);
        const step = after.chaserConfig!.activeEditStep ?? 0;
        after.chaserConfig!.stepValues[step] = dmx(value);
        after.stepValues = [...after.chaserConfig!.stepValues];
        snapshots.set({ fixture, channelIndex }, { before, after });
      }
      return new SetChannelValuesCommand(snapshots, description);
    },

    setChannelRange: write => setChannelRanges({ changes: [write] }),
    setChannelRanges,

    setFixtureKindConfig: () => notYet('setFixtureKindConfig', 'P5.1'),
    addFixture: () => notYet('addFixture', 'P5.1'),
    setExtensionData: () => notYet('setExtensionData', 'P5.5'),

    rename({ nodeId, name }): Command {
      const node = findNode(useEngineStore().sceneNodes, nodeId);
      if (!node) throw new Error(`[extension-api] scene node "${String(nodeId)}" not found`);
      return new RenameNodeCommand(node, name);
    },

    move({ moves }): Command {
      const fixtures = moves.map(m => requireFixture(m.fixtureId));
      const before = fixtures.map(f => ({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y }));
      const after = moves.map((m, i) => ({ id: fixtures[i]!.id, x: m.position.x, y: m.position.y }));
      return new MoveFixtureCommand(fixtures, before, after);
    },

    rotate({ fixtureId, rotation }): Command {
      const fixture = requireFixture(fixtureId);
      return new RotateFixtureCommand(
        [fixture],
        [{ id: fixture.id, rotation: fixture.rotation }],
        [{ id: fixture.id, rotation }],
      );
    },
  };
}
