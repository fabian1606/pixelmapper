import type { Command } from '../composables/use-history';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import { type SerializableCommand, registerCommand } from './serializable-command';

export class GroupNodesCommand implements SerializableCommand {
  readonly commandType = 'GroupNodes';
  description = 'Group Items';

  private restorePoints: { node: SceneNode, parent: FixtureGroup | null, index: number }[] = [];

  constructor(
    private rootNodes: SceneNode[],
    private nodesToGroup: SceneNode[],
    private newGroup: FixtureGroup
  ) { }

  toPayload() {
    return {
      nodeIds: this.nodesToGroup.map(n => n.id),
      groupId: this.newGroup.id,
      groupName: this.newGroup.name,
    };
  }

  execute() {
    // 1. Record original locations BEFORE any removal
    this.restorePoints = this.nodesToGroup.map(node => {
      const parent = node.parent;
      const index = parent ? parent.children.indexOf(node) : this.rootNodes.indexOf(node);
      return { node, parent, index };
    });

    const firstPoint = this.restorePoints[0];
    if (!firstPoint) return;

    // 2. Remove nodes from current locations
    // Iterate backwards based on index if they share a parent to avoid shifting issues when splicing out,
    // but we can just use our custom removeChild which filters. For root, we splice.
    for (const { node, parent } of this.restorePoints) {
      if (parent) {
        parent.removeChild(node);
      } else {
        const idx = this.rootNodes.indexOf(node);
        if (idx !== -1) this.rootNodes.splice(idx, 1);
      }
    }

    // 3. Add to the new group
    for (const { node } of this.restorePoints) {
      this.newGroup.addChild(node);
    }

    // 4. Insert the group where the first node was
    if (firstPoint.parent) {
      // Need to find safe insertion index as array might have shrunk
      const safeIndex = Math.min(firstPoint.index, firstPoint.parent.children.length);
      firstPoint.parent.insertChildAt(this.newGroup, safeIndex);
    } else {
      const safeIndex = Math.min(firstPoint.index, this.rootNodes.length);
      this.rootNodes.splice(safeIndex, 0, this.newGroup);
    }
  }

  undo() {
    // 1. Remove the group
    if (this.newGroup.parent) {
      this.newGroup.parent.removeChild(this.newGroup);
    } else {
      const idx = this.rootNodes.indexOf(this.newGroup);
      if (idx !== -1) this.rootNodes.splice(idx, 1);
    }

    // 2. Clear out children safely
    while (this.newGroup.children.length > 0) {
      const child = this.newGroup.children[0];
      if (child) this.newGroup.removeChild(child);
      else break;
    }

    // 3. Restore children to original positions.
    // Important: restore in the original order we recorded them to reconstruct array properly.
    // Actually, sorting by index ascending ensures we push them back correctly.
    const sortedPoints = [...this.restorePoints].sort((a, b) => a.index - b.index);
    for (const pt of sortedPoints) {
      if (pt.parent) {
        pt.parent.children.splice(pt.index, 0, pt.node);
        pt.node.parent = pt.parent;
      } else {
        this.rootNodes.splice(pt.index, 0, pt.node);
        pt.node.parent = null;
      }
    }
  }
}

registerCommand('GroupNodes', (payload, ctx) => {
  function findNodes(ids: (string | number)[], nodes: SceneNode[]): SceneNode[] {
    const found: SceneNode[] = [];
    function walk(list: SceneNode[]) {
      for (const n of list) {
        if (ids.includes(n.id)) found.push(n);
        if (n instanceof FixtureGroup) walk(n.children);
      }
    }
    walk(nodes);
    return found;
  }
  const nodes = findNodes(payload.nodeIds, ctx.sceneNodes);
  const group = new FixtureGroup(payload.groupId, payload.groupName);
  return new GroupNodesCommand(ctx.sceneNodes, nodes, group);
});

export class UngroupNodesCommand implements SerializableCommand {
  readonly commandType = 'UngroupNodes';
  description = 'Ungroup Items';

  private parent: FixtureGroup | null = null;
  private restoreIndex: number = -1;
  private children: SceneNode[] = [];

  constructor(
    private rootNodes: SceneNode[],
    private groupToUngroup: FixtureGroup
  ) { }

  toPayload() {
    return { groupId: this.groupToUngroup.id };
  }

  execute() {
    this.parent = this.groupToUngroup.parent;
    this.children = [...this.groupToUngroup.children];

    if (this.parent) {
      this.restoreIndex = this.parent.children.indexOf(this.groupToUngroup);
      this.parent.removeChild(this.groupToUngroup);

      for (let i = 0; i < this.children.length; i++) {
        const child = this.children[i];
        if (child) this.parent.insertChildAt(child, this.restoreIndex + i);
      }
    } else {
      this.restoreIndex = this.rootNodes.indexOf(this.groupToUngroup);
      if (this.restoreIndex !== -1) this.rootNodes.splice(this.restoreIndex, 1);

      // Empty group out
      this.children.forEach(c => this.groupToUngroup.removeChild(c));

      for (let i = 0; i < this.children.length; i++) {
        const child = this.children[i];
        if (child) {
          this.rootNodes.splice(this.restoreIndex + i, 0, child);
          child.parent = null;
        }
      }
    }
  }

  undo() {
    // Remove children from their new parent
    for (const child of this.children) {
      if (this.parent) {
        this.parent.removeChild(child);
      } else {
        const idx = this.rootNodes.indexOf(child);
        if (idx !== -1) this.rootNodes.splice(idx, 1);
      }
      this.groupToUngroup.addChild(child);  // Put them back in the group
    }

    // Reinsert group
    if (this.parent) {
      this.parent.insertChildAt(this.groupToUngroup, this.restoreIndex);
    } else {
      this.rootNodes.splice(this.restoreIndex, 0, this.groupToUngroup);
    }
  }
}

registerCommand('UngroupNodes', (payload, ctx) => {
  function findGroup(id: string | number, nodes: SceneNode[]): FixtureGroup | null {
    for (const n of nodes) {
      if (n instanceof FixtureGroup) {
        if (n.id === id) return n;
        const found = findGroup(id, n.children);
        if (found) return found;
      }
    }
    return null;
  }
  const group = findGroup(payload.groupId, ctx.sceneNodes);
  if (!group) return { description: 'UngroupNodes (missing)', execute() {}, undo() {} };
  return new UngroupNodesCommand(ctx.sceneNodes, group);
});
