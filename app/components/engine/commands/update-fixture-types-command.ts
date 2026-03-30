import type { Command } from '../composables/use-history';
import type { SceneNode } from '~/utils/engine/core/group';
import { FixtureGroup } from '~/utils/engine/core/group';
import type { Fixture } from '~/utils/engine/core/fixture';

export class UpdateFixtureTypesCommand implements Command {
  name = 'Update Fixture Types';
  description = 'Updated the profile type for existing fixture instances.';

  constructor(
    private sceneNodes: SceneNode[],
    private oldFixtures: Fixture[],
    private newFixtures: Fixture[]
  ) {}

  execute() {
    this.swap(this.oldFixtures, this.newFixtures);
  }

  undo() {
    this.swap(this.newFixtures, this.oldFixtures);
  }

  private swap(from: Fixture[], to: Fixture[]) {
    for (let i = 0; i < from.length; i++) {
      this.replaceNodeInTree(this.sceneNodes, from[i]!.id, to[i]!);
    }
  }

  private replaceNodeInTree(nodes: SceneNode[], id: string | number, newNode: SceneNode): boolean {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i]!.id === id) {
        nodes[i] = newNode;
        return true;
      }
      if (nodes[i] instanceof FixtureGroup) {
        if (this.replaceNodeInTree((nodes[i] as FixtureGroup).children, id, newNode)) {
          return true;
        }
      }
    }
    return false;
  }
}
