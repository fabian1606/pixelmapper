<script setup lang="ts">
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from '@/components/ui/context-menu';
import { TrashIcon } from 'lucide-vue-next';

/**
 * Unified context menu for any SceneNode (Fixture or FixtureGroup).
 * Pass capability flags to control which items are visible.
 * The default slot is used as the context-menu trigger.
 *
 * Deletion is intentionally no-dialog here: the parent (index.vue)
 * owns the confirmation dialog and undo/redo stack.
 */
interface Props {
  node: SceneNode;
  canZoom?: boolean;
  canGroup?: boolean;
  canUngroup?: boolean;
  canRename?: boolean;
  canEditType?: boolean;
  canDelete?: boolean;
}

interface Emits {
  (e: 'zoomTo', node: SceneNode): void;
  (e: 'group'): void;
  (e: 'ungroup', group: FixtureGroup): void;
  (e: 'rename'): void;
  (e: 'editType', node: SceneNode): void;
  (e: 'delete', node: SceneNode): void;
}

const props = withDefaults(defineProps<Props>(), {
  canZoom: false,
  canGroup: false,
  canUngroup: false,
  canRename: false,
  canEditType: false,
  canDelete: false,
});

const emit = defineEmits<Emits>();
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <slot />
    </ContextMenuTrigger>

    <ContextMenuContent>
      <ContextMenuItem v-if="canZoom" @click="emit('zoomTo', node)">
        Center Item
      </ContextMenuItem>

      <ContextMenuItem v-if="canGroup" @click="emit('group')">
        Group Selection
        <ContextMenuShortcut>⌘G</ContextMenuShortcut>
      </ContextMenuItem>

      <ContextMenuItem
        v-if="canUngroup"
        @click="emit('ungroup', node as FixtureGroup)"
      >
        Ungroup
        <ContextMenuShortcut>⇧⌘G</ContextMenuShortcut>
      </ContextMenuItem>

      <ContextMenuItem v-if="canRename" @click="emit('rename')">
        Rename
        <ContextMenuShortcut>F2</ContextMenuShortcut>
      </ContextMenuItem>

      <ContextMenuSeparator v-if="canEditType" />
      <ContextMenuItem v-if="canEditType" @click="emit('editType', node)">
        Edit Fixture Type
      </ContextMenuItem>

      <ContextMenuSeparator v-if="canDelete && (canZoom || canGroup || canUngroup || canRename || canEditType)" />

      <ContextMenuItem v-if="canDelete" variant="destructive" @click="emit('delete', node)">
        <TrashIcon />
        Delete
        <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
