import type { Fixture } from './fixture';

export type SceneNode = Fixture | FixtureGroup;

export class FixtureGroup {
  id: string | number;
  name: string;
  children: SceneNode[];
  parent: FixtureGroup | null = null;
  expanded: boolean = true;

  constructor(id: string | number, name: string = 'Group') {
    this.id = id;
    this.name = name;
    this.children = [];
  }

  addChild(node: SceneNode) {
    if (node.parent) {
      node.parent.removeChild(node);
    }
    this.children.push(node);
    node.parent = this;
  }

  removeChild(node: SceneNode) {
    this.children = this.children.filter(c => c !== node);
    if (node.parent === this) {
      node.parent = null;
    }
  }

  insertChildAt(node: SceneNode, index: number) {
    if (node.parent) {
      node.parent.removeChild(node);
    }
    this.children.splice(index, 0, node);
    node.parent = this;
  }

  /**
   * Recursively extracts all Fixtures from this group.
   */
  getAllFixtures(): Fixture[] {
    const fixtures: Fixture[] = [];
    for (const child of this.children) {
      if (child instanceof FixtureGroup) {
        fixtures.push(...child.getAllFixtures());
      } else {
        fixtures.push(child);
      }
    }
    return fixtures;
  }
}
