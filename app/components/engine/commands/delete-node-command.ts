import type { Command } from '../composables/use-history';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';

interface RestorePoint {
  node: SceneNode;
  parent: FixtureGroup | null;
  index: number;
}

/**
 * Undo/redo-capable command that removes one or more SceneNodes (Fixtures or FixtureGroups)
 * from the scene tree. Remembers the original parent + index for each so they can be 
 * restored precisely on undo.
 */
export class DeleteNodesCommand implements Command {
  description = 'Delete Items';

  private restorePoints: RestorePoint[] = [];

  constructor(
    private rootNodes: SceneNode[],
    private nodesToDelete: SceneNode[]
  ) { }

  execute() {
    // 1. Record original locations BEFORE any removal to ensure indices are correct
    this.restorePoints = this.nodesToDelete.map(node => {
      const parent = node.parent;
      const index = parent ? parent.children.indexOf(node) : this.rootNodes.indexOf(node);
      return { node, parent, index };
    });

    // 2. Remove nodes from current locations
    // We sort by index descending if they share a parent to avoid indexing issues,
    // but our group.removeChild handles it by reference, and splice for root is also safe
    // as long as we don't rely on the indices during the removal loop.
    for (const { node, parent } of this.restorePoints) {
      if (parent) {
        parent.removeChild(node);
      } else {
        const idx = this.rootNodes.indexOf(node);
        if (idx !== -1) this.rootNodes.splice(idx, 1);
      }
    }
  }

  undo() {
    // 3. Restore nodes to original positions.
    // Important: restore in the original order or sort by index to reconstruct array properly.
    const sortedPoints = [...this.restorePoints].sort((a, b) => a.index - b.index);

    for (const pt of sortedPoints) {
      if (pt.parent) {
        pt.parent.insertChildAt(pt.node, pt.index);
      } else {
        const safeIndex = Math.min(pt.index, this.rootNodes.length);
        this.rootNodes.splice(safeIndex, 0, pt.node);
        pt.node.parent = null;
      }
    }
  }
}
