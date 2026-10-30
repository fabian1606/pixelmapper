/**
 * Scene tree traversal on the raw node arrays.
 *
 * Commands mutate `sceneNodes` in place (a `shallowRef`), so the store's
 * `flatFixtures` computed can be stale in the middle of a command or batch.
 * Code that runs there (batch children, change observation) walks the tree
 * directly with these helpers.
 */
import type { Fixture } from './core/fixture';
import { FixtureGroup, type SceneNode } from './core/group';

/** All fixtures of a tree in scene order (groups expanded). */
export function collectFixtures(nodes: readonly SceneNode[]): Fixture[] {
  const out: Fixture[] = [];
  const visit = (list: readonly SceneNode[]) => {
    for (const node of list) {
      if (node instanceof FixtureGroup) visit(node.children);
      else out.push(node);
    }
  };
  visit(nodes);
  return out;
}

/** Finds a fixture by id anywhere in the tree. */
export function findFixtureInTree(nodes: readonly SceneNode[], id: string | number): Fixture | undefined {
  for (const node of nodes) {
    if (node instanceof FixtureGroup) {
      const hit = findFixtureInTree(node.children, id);
      if (hit) return hit;
    }
    else if (node.id === id) return node;
  }
  return undefined;
}
