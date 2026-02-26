import type { Command } from '../composables/use-history';
import type { SceneNode } from '~/utils/engine/core/group';

export class RenameNodeCommand implements Command {
  description = 'Rename Item';
  private oldName: string;

  constructor(
    private node: SceneNode,
    private newName: string
  ) {
    this.oldName = node.name;
    this.description = `Rename ${this.oldName} to ${this.newName}`;
  }

  execute() {
    this.node.name = this.newName;
  }

  undo() {
    this.node.name = this.oldName;
  }
}
