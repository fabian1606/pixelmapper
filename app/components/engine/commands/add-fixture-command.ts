import type { Command } from '../composables/use-history';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import { type SerializableCommand, registerCommand } from './serializable-command';
import { serializeNode, deserializeFixture, type SerializedNode } from '~/utils/engine/serialize';

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
