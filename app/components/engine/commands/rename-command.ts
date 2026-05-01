import type { Command } from '../composables/use-history';
import type { SceneNode } from '~/utils/engine/core/group';
import { type SerializableCommand, registerCommand } from './serializable-command';

export class RenameNodeCommand implements SerializableCommand {
  readonly commandType = 'RenameNode';
  description = 'Rename Item';
  private oldName: string;

  constructor(
    private node: SceneNode,
    private newName: string
  ) {
    this.oldName = node.name;
    this.description = `Rename ${this.oldName} to ${this.newName}`;
  }

  toPayload() {
    return { nodeId: this.node.id, oldName: this.oldName, newName: this.newName };
  }

  execute() {
    this.node.name = this.newName;
  }

  undo() {
    this.node.name = this.oldName;
  }
}

registerCommand('RenameNode', (payload, ctx) => {
  function findNode(nodes: SceneNode[]): SceneNode | null {
    for (const n of nodes) {
      if (n.id === payload.nodeId) return n;
      if ('children' in n) {
        const found = findNode((n as any).children);
        if (found) return found;
      }
    }
    return null;
  }
  const node = findNode(ctx.sceneNodes);
  if (!node) return { description: 'RenameNode (missing)', execute() {}, undo() {} };
  const cmd = new RenameNodeCommand(node, payload.newName);
  return cmd;
});
