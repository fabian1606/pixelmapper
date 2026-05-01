import type { Command } from '../composables/use-history';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import { Fixture } from '~/utils/engine/core/fixture';
import { type SerializableCommand, registerCommand } from './serializable-command';
import { serializeProject, deserializeFixture, type SerializedNode } from '~/utils/engine/serialize';

/**
 * Undo/redo-capable command for adding one or more fixtures to the root scene.
 */
export class AddFixturesCommand implements SerializableCommand {
  readonly commandType = 'AddFixtures';
  description = 'Add Fixtures';

  constructor(
    private rootNodes: SceneNode[],
    private newNodes: SceneNode[]
  ) { }

  toPayload() {
    // Serialize the added fixtures so they can be reconstructed on replay
    function serializeNode(n: SceneNode): SerializedNode {
      if (n instanceof FixtureGroup) {
        return {
          _type: 'group' as const,
          id: n.id,
          name: n.name,
          expanded: n.expanded,
          children: n.children.map(serializeNode),
        };
      }
      const f = n as Fixture;
      return {
        _type: 'fixture' as const,
        id: f.id,
        name: f.name,
        startAddress: f.startAddress,
        fixturePosition: { ...f.fixturePosition },
        fixtureSize: { ...f.fixtureSize },
        rotation: f.rotation,
        manufacturer: f.manufacturer,
        fixtureType: f.fixtureType,
        oflKey: f.oflKey,
        channels: f.channels.map(ch => ({
          type: ch.type,
          addressOffset: ch.addressOffset,
          resolution: ch.resolution,
          fineAddressOffsets: ch.fineAddressOffsets,
          isFine: ch.isFine,
          role: ch.role,
          colorValue: ch.colorValue,
          oflChannelName: ch.oflChannelName,
          defaultValue: ch.defaultValue,
          beamId: ch.beamId,
          chaserConfig: JSON.parse(JSON.stringify(ch.chaserConfig)),
        })),
        beams: f.beams.map(b => ({ id: b.id, localX: b.localX, localY: b.localY })),
      };
    }
    return { nodes: this.newNodes.map(serializeNode) };
  }

  execute() {
    this.rootNodes.push(...this.newNodes);
  }

  undo() {
    for (const node of this.newNodes) {
      const idx = this.rootNodes.indexOf(node);
      if (idx !== -1) {
        this.rootNodes.splice(idx, 1);
      }
    }
  }
}

registerCommand('AddFixtures', (payload, ctx) => {
  function deserializeNode(data: SerializedNode): SceneNode {
    if (data._type === 'group') {
      const g = new FixtureGroup(data.id, data.name);
      g.expanded = data.expanded;
      g.children = data.children.map(deserializeNode);
      g.children.forEach(c => (c.parent = g));
      return g;
    }
    return deserializeFixture(data);
  }
  const nodes = payload.nodes.map(deserializeNode);
  return new AddFixturesCommand(ctx.sceneNodes, nodes);
});
