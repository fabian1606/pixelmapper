/**
 * Core command factory exposed to extensions as `ctx.commands` (ADR §5.8).
 *
 * Translates the id-based, model-agnostic API arguments into the core's
 * command classes (which hold live model references).
 */
import type {
  AddFixtureItem,
  AddFixturesCommand as ApiAddFixturesCommand,
  ChannelRangeWrite,
  Command,
  CoreCommandFactory,
  FixtureId,
  Json,
} from '@pixelmapper/extension-api';
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
import { SetFixtureKindConfigCommand } from '~/components/engine/commands/set-fixture-kind-config-command';
import { SetExtensionDataCommand, readExtensionData } from '~/components/engine/commands/set-extension-data-command';
import { AddFixturesCommand } from '~/components/engine/commands/add-fixture-command';
import { UpdateDmxCommand } from '~/components/engine/commands/update-dmx-command';
import { createBatchCommand } from '~/components/engine/commands/composite-command';
import { createKindFixture, getKind } from '~/utils/kinds/kind-host';
import { assignIdsAndAddresses } from '~/utils/engine/addressing';
import { collectFixtures, findFixtureInTree } from '~/utils/engine/scene-tree';
import { placeNewFixtures, selectionWithAdded } from '~/utils/engine/add-fixtures';
import { createFixtureFromDefinition, resolveFixtureDefinition, type ResolvedDefinition } from '~/utils/fixture-definitions/resolve-definition';
import { buildSetFixtureModeCommand } from '~/utils/fixture-definitions/fixture-mode';

/**
 * Finds a fixture or throws a readable error. Walks the live tree, so a
 * fixture added by a command that just ran is found before the store's
 * cached `flatFixtures` is refreshed.
 */
function requireFixture(id: FixtureId): Fixture {
  const fixture = findFixtureInTree(useEngineStore().sceneNodes as SceneNode[], id);
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

/** Highest absolute DMX start address accepted by the API (32 universes, like the inspector). */
const MAX_START_ADDRESS = 32 * 512;

/** Validates an absolute 1-based start address or throws. */
function requireStartAddress(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_START_ADDRESS) {
    throw new Error(`[extension-api] ${what}: startAddress must be an integer in 1..${MAX_START_ADDRESS}, got ${String(value)}`);
  }
  return value;
}

/**
 * `AddFixturesCommand` as returned to extensions: knows the new ids up
 * front and adds the fixtures to the selection when it first runs locally
 * (replays and collaborators recreate the plain command, without selection).
 */
class ExtensionAddFixturesCommand extends AddFixturesCommand implements ApiAddFixturesCommand {
  readonly fixtureIds: readonly FixtureId[];
  private selected = false;

  constructor(rootNodes: SceneNode[], private readonly added: Fixture[]) {
    super(rootNodes, added);
    this.fixtureIds = added.map(f => f.id);
  }

  override execute() {
    super.execute();
    if (this.selected) return;
    this.selected = true;
    const store = useEngineStore();
    store.selectedIds = selectionWithAdded(store.selectedIds, this.added);
  }
}

/** Builds the fixtures of `commands.addFixtures` (definitions resolved once per key). */
async function buildFixtures(items: readonly AddFixtureItem[]): Promise<Fixture[]> {
  const keys = [...new Set(items.flatMap(i => (i.definition ? [i.definition] : [])))];
  const resolved = new Map<string, ResolvedDefinition>();
  await Promise.all(keys.map(async (key) => {
    const def = await resolveFixtureDefinition(key);
    if (!def) throw new Error(`[extension-api] fixture definition "${key}" not found`);
    resolved.set(key, def);
  }));
  return items.map((item, i) => {
    if (!!item.definition === !!item.kind) throw new Error(`[extension-api] addFixtures item ${i}: give exactly one of definition or kind`);
    let fixture: Fixture;
    if (item.kind) {
      const registered = getKind(item.kind.id);
      if (!registered) throw new Error(`[extension-api] fixture kind "${item.kind.id}" is not installed`);
      fixture = createKindFixture(registered.def, { id: 'pending', config: item.kind.config });
    }
    else {
      const modeIndex = item.modeIndex ?? 0;
      const def = resolved.get(item.definition!)!;
      if (!Number.isInteger(modeIndex) || !def.definition.modes[modeIndex]) {
        throw new Error(`[extension-api] addFixtures item ${i}: "${item.definition}" has no mode ${String(modeIndex)}`);
      }
      fixture = createFixtureFromDefinition(def, modeIndex);
    }
    if (item.startAddress !== undefined) requireStartAddress(item.startAddress, `addFixtures item ${i}`);
    if (item.name !== undefined) fixture.name = item.name;
    return fixture;
  });
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

/**
 * Creates the factory. `callerExtensionId` (the extension whose context
 * holds the factory) is the default writer of `setExtensionData`.
 */
export function createCoreCommandFactory(callerExtensionId?: string): CoreCommandFactory {
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

    setFixtureKindConfig({ fixtureId, config }): Command {
      const fixture = requireFixture(fixtureId);
      if (!fixture.kind) throw new Error(`[extension-api] fixture "${String(fixtureId)}" is not a kind fixture`);
      const store = useEngineStore();
      return new SetFixtureKindConfigCommand(store.flatFixtures as Fixture[], fixture.id, fixture.kind.config as Json, config);
    },
    addFixture({ kind, ofl, position }): Command {
      // OFL fixtures need an async definition fetch; extensions add them through the library UI.
      if (!kind) throw new Error(`[extension-api] commands.addFixture needs { kind }${ofl ? ' (OFL keys are added through the fixture library)' : ''}`);
      const registered = getKind(kind.id);
      if (!registered) throw new Error(`[extension-api] fixture kind "${kind.id}" is not installed`);
      const store = useEngineStore();
      const fixture = createKindFixture(registered.def, { id: 'pending', config: kind.config, position });
      assignIdsAndAddresses([fixture], store.flatFixtures as Fixture[]);
      return new AddFixturesCommand(store.sceneNodes as SceneNode[], [fixture]);
    },
    async addFixtures(items): Promise<ApiAddFixturesCommand> {
      if (items.length === 0) throw new Error('[extension-api] commands.addFixtures needs at least one item');
      const fixtures = await buildFixtures(items);
      // Shared add path (plan M4.1): ids, addresses (explicit or appended), cascade.
      const store = useEngineStore();
      placeNewFixtures(fixtures, collectFixtures(store.sceneNodes as SceneNode[]), { startAddresses: items.map(i => i.startAddress) });
      return new ExtensionAddFixturesCommand(store.sceneNodes as SceneNode[], fixtures);
    },

    setStartAddress({ fixtureId, startAddress }): Command {
      const fixture = requireFixture(fixtureId);
      requireStartAddress(startAddress, 'setStartAddress');
      return new UpdateDmxCommand(fixture, fixture.startAddress, startAddress);
    },

    async setFixtureMode({ fixtureId, modeIndex }): Promise<Command> {
      const fixture = requireFixture(fixtureId);
      try {
        return await buildSetFixtureModeCommand(useEngineStore().sceneNodes as SceneNode[], fixture, modeIndex);
      }
      catch (err) {
        throw new Error(`[extension-api] setFixtureMode: ${(err as Error).message}`);
      }
    },

    batch(commands, description): Command {
      return createBatchCommand(commands, description);
    },

    setExtensionData({ owner, ownerId, extensionId, key, value }): Command {
      const ext = extensionId ?? callerExtensionId;
      if (!ext) throw new Error('[extension-api] commands.setExtensionData needs an extensionId outside an extension context');
      if (owner !== 'project' && ownerId === undefined) throw new Error(`[extension-api] setExtensionData on a ${owner} needs ownerId`);
      return new SetExtensionDataCommand({
        owner, ownerId, extensionId: ext, key,
        before: readExtensionData(owner, ownerId, ext, key),
        after: value,
      });
    },

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
