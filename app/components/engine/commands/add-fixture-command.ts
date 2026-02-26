import type { Command } from '../composables/use-history';
import { type SceneNode } from '~/utils/engine/core/group';

/**
 * Undo/redo-capable command for adding one or more fixtures to the root scene.
 */
export class AddFixturesCommand implements Command {
  description = 'Add Fixtures';

  constructor(
    private rootNodes: SceneNode[],
    private newNodes: SceneNode[]
  ) { }

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
