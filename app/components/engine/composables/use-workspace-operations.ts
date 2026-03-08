import { type Ref, type ComputedRef } from 'vue';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import { useHistory } from './use-history';
import { GroupNodesCommand, UngroupNodesCommand } from '../commands/group-command';
import { DeleteNodesCommand } from '../commands/delete-node-command';
import { AddFixturesCommand } from '../commands/add-fixture-command';
import type { Fixture } from '~/utils/engine/core/fixture';

export function useWorkspaceOperations(
  sceneNodes: Ref<SceneNode[]>,
  selectedIds: Ref<Set<string | number>>,
  flatFixtures: ComputedRef<Fixture[]>
) {
  const history = useHistory();

  let nextGroupId = 1;
  let nextFixtureId = 1000;

  function handleAddOflFixtures(fixtures: Fixture[]) {
    let maxAddress = 0;
    for (const f of flatFixtures.value) {
      const fMax = f.startAddress + f.channels.length - 1;
      if (fMax > maxAddress) maxAddress = fMax;
    }

    fixtures.forEach((f, i) => {
      f.id = `ofl-${nextFixtureId++}`;
      f.startAddress = maxAddress + 1;
      maxAddress += f.channels.length;
      f.fixturePosition = {
        x: 0.5 + (i * 0.02),
        y: 0.5 + (i * 0.02)
      };
    });

    const command = new AddFixturesCommand(sceneNodes.value, fixtures);
    history.execute(command);

    const next = new Set(selectedIds.value);
    for (const f of fixtures) {
      next.add(f.id);
    }
    selectedIds.value = next;
  }

  function handleGroup() {
    if (selectedIds.value.size === 0) return;

    const nodesToGroup: SceneNode[] = [];
    function findNodes(nodes: SceneNode[]) {
      for (const node of nodes) {
        if (selectedIds.value.has(node.id)) {
          nodesToGroup.push(node);
        } else if (node instanceof FixtureGroup) {
          findNodes(node.children);
        }
      }
    }
    findNodes(sceneNodes.value);

    if (nodesToGroup.length === 0) return;

    const newGroup = new FixtureGroup(`group-${nextGroupId++}`, 'New Group');
    const command = new GroupNodesCommand(sceneNodes.value, nodesToGroup, newGroup);
    history.execute(command);
    selectedIds.value = new Set([newGroup.id]);
  }

  function handleUngroup(group: FixtureGroup) {
    const command = new UngroupNodesCommand(sceneNodes.value, group);
    history.execute(command);
    selectedIds.value = new Set(group.children.map(c => c.id));
  }

  function handleUngroupSelected() {
    const groupsToUngroup: FixtureGroup[] = [];
    function findGroups(nodes: SceneNode[]) {
      for (const node of nodes) {
        if (node instanceof FixtureGroup && selectedIds.value.has(node.id)) {
          groupsToUngroup.push(node);
        }
        if (node instanceof FixtureGroup) {
          findGroups(node.children);
        }
      }
    }
    findGroups(sceneNodes.value);
    for (const g of groupsToUngroup) {
      handleUngroup(g);
    }
  }

  function handleDeleteNodes(nodesToDelete: SceneNode[]) {
    if (nodesToDelete.length === 0) return;
    const command = new DeleteNodesCommand(sceneNodes.value, nodesToDelete);
    history.execute(command);

    // Clear selection
    selectedIds.value = new Set();
  }

  return {
    handleAddOflFixtures,
    handleGroup,
    handleUngroup,
    handleUngroupSelected,
    handleDeleteNodes,
  };
}
