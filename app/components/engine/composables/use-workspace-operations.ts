import { type Ref, type ComputedRef } from 'vue';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import { useHistory } from './use-history';
import { GroupNodesCommand, UngroupNodesCommand } from '../commands/group-command';
import { DeleteNodesCommand } from '../commands/delete-node-command';
import { AddFixturesCommand } from '../commands/add-fixture-command';
import { MoveFixtureCommand } from '../commands/move-fixture-command';
import { WORLD_WIDTH, WORLD_HEIGHT } from '~/utils/engine/constants';
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

  function handleAlign(type: 'distribute-x' | 'distribute-y' | 'center-x' | 'center-y' | 'smart-grid') {
    const targetFixtures = flatFixtures.value.filter(f => selectedIds.value.has(f.id));
    if (targetFixtures.length < 2) return;

    const count = targetFixtures.length;
    const before = targetFixtures.map(f => ({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y }));
    const after = targetFixtures.map(f => ({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y }));

    const minX = Math.min(...after.map(f => f.x));
    const maxX = Math.max(...after.map(f => f.x));
    const minY = Math.min(...after.map(f => f.y));
    const maxY = Math.max(...after.map(f => f.y));

    switch (type) {
      case 'center-x':
      case 'center-y': {
        const avgX = (minX + maxX) / 2;
        const avgY = (minY + maxY) / 2;
        after.forEach(f => {
          if (type === 'center-x') f.x = avgX;
          if (type === 'center-y') f.y = avgY;
        });
        break;
      }
      case 'distribute-x':
      case 'distribute-y': {
        const isX = type === 'distribute-x';
        after.sort((a, b) => isX ? a.x - b.x : a.y - b.y);
        const min = isX ? minX : minY;
        const max = isX ? maxX : maxY;
        const step = count > 1 ? (max - min) / (count - 1) : 0;
        after.forEach((f, i) => {
          if (isX) f.x = min + step * i;
          else f.y = min + step * i;
        });
        break;
      }
      case 'smart-grid': {
        const sizeX = Math.max(0.001, maxX - minX);
        const sizeY = Math.max(0.001, maxY - minY);
        const aspect = sizeX / sizeY;
        const snap = (norm: number, max: number) => Math.round((norm * max) / 25) * 25 / max;
        
        const rows = Math.max(1, Math.round(Math.sqrt(count / aspect)));
        const cols = Math.ceil(count / rows);

        if (aspect >= 1) {
          after.sort((a, b) => a.y - b.y);
          for (let r = 0; r < rows; r++) {
            const start = r * cols;
            const end = Math.min(start + cols, count);
            const rowItems = after.slice(start, end).sort((a, b) => a.x - b.x);
            after.splice(start, rowItems.length, ...rowItems);
          }
        } else {
          after.sort((a, b) => a.x - b.x);
          for (let c = 0; c < cols; c++) {
            const start = c * rows;
            const end = Math.min(start + rows, count);
            const colItems = after.slice(start, end).sort((a, b) => a.y - b.y);
            after.splice(start, colItems.length, ...colItems);
          }
        }
        
        const startX = snap(minX, WORLD_WIDTH);
        const startY = snap(minY, WORLD_HEIGHT);
        const stepX = cols > 1 ? snap(sizeX / (cols - 1), WORLD_WIDTH) : 0;
        const stepY = rows > 1 ? snap(sizeY / (rows - 1), WORLD_HEIGHT) : 0;
        
        if (aspect >= 1) {
          after.forEach((f, index) => {
            const c = index % cols;
            const r = Math.floor(index / cols);
            f.x = startX + c * stepX;
            f.y = startY + r * stepY;
          });
        } else {
          after.forEach((f, index) => {
            const r = index % rows;
            const c = Math.floor(index / rows);
            f.x = startX + c * stepX;
            f.y = startY + r * stepY;
          });
        }
        break;
      }
    }

    const command = new MoveFixtureCommand(flatFixtures.value, before, after);
    history.execute(command);
  }

  return {
    handleAddOflFixtures,
    handleGroup,
    handleUngroup,
    handleUngroupSelected,
    handleDeleteNodes,
    handleAlign,
  };
}
