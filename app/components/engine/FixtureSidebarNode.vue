<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import { Fixture } from '~/utils/engine/core/fixture';
import { ChevronRight, ChevronDown, Spotlight, Folder } from 'lucide-vue-next';
import { useHistory } from '~/components/engine/composables/use-history';
import { useShortcuts } from '~/components/engine/composables/use-shortcuts';
import { RenameNodeCommand } from '~/components/engine/commands/rename-command';
import {
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
} from '@/components/ui/sidebar';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { useGlobalContextMenu, type ContextMenuItemOption } from '~/composables/useGlobalContextMenu';
import { Trash2, Lightbulb } from 'lucide-vue-next';
import { isAdditiveModifier } from '~/utils/engine/selection-logic';
import { createHighlightCommand } from '~/components/engine/commands/highlight-fixture-command';
import PmListItem from '~/components/primitives/PmListItem.vue';
import { provideScope } from '~/composables/extensions/provide-scope';
import { fixtureView } from '~/utils/extensions/scope-views';
import { useScopeSnapshot } from '~/composables/extensions/use-scope';
import { useCanvasHoverStore } from '~/stores/canvas-hover-store';

const props = defineProps<{
  node: SceneNode;
  selectedIds: Set<string | number>;
}>();

const emit = defineEmits<{
  (e: 'select', id: string | number, mods: { range: boolean; toggle: boolean }): void;
  (e: 'group'): void;
  (e: 'ungroup', group: FixtureGroup): void;
  (e: 'zoomTo', node: SceneNode): void;
  (e: 'editType', node: SceneNode): void;
  (e: 'delete', node: SceneNode): void;
}>();

const history = useHistory();

const isGroup = computed(() => props.node instanceof FixtureGroup);
const isSelected = computed(() => props.selectedIds.has(props.node.id));

// Extension scope: fixture rows expose their fixture; group rows shadow any
// outer fixture scope with `undefined`.
const fixtureScope = provideScope('fixture', () => (isGroup.value ? undefined : fixtureView(props.node as Fixture)));
/** Scopes captured when opening the context menu (slot `context-menu/fixture|group:items`). */
const scopeSnapshot = useScopeSnapshot({ fixture: fixtureScope });

// Canvas hover: the row of the fixture under the 2D-canvas pointer gets its own
// highlight, so a single member stays identifiable while its group is selected.
const canvasHover = useCanvasHoverStore();
// Selected rows normally skip it (already highlighted) — except for the swap
// partner during a swap drag, whose fixtures are usually all selected.
const isCanvasHovered = computed(() =>
  !isGroup.value
  && (!isSelected.value || canvasHover.isSwapTarget)
  && canvasHover.hoveredFixtureId === String(props.node.id),
);
const rowEl = ref<{ $el?: HTMLElement } | null>(null);

// Keep the hovered row visible in long lists ('nearest' = no scroll when already in view).
watch(isCanvasHovered, (hovered) => {
  if (hovered) rowEl.value?.$el?.scrollIntoView?.({ block: 'nearest' });
});

const isExpanded = ref(isGroup.value ? (props.node as FixtureGroup).expanded : false);

watch(
  () => props.node,
  (newNode) => {
    if (newNode instanceof FixtureGroup) {
      isExpanded.value = newNode.expanded;
    }
  }
);

watch(isExpanded, (newVal) => {
  if (isGroup.value) {
    (props.node as FixtureGroup).expanded = newVal;
  }
});

const isEditing = ref(false);
const editName = ref('');
const inputEl = ref<HTMLInputElement | null>(null);

function handleSelect(e: MouseEvent) {
  // Shift → range-select between the anchor and this node; Ctrl/Cmd → toggle
  // (same additive rule the 2D/3D canvases use, via selection-logic).
  emit('select', props.node.id, { range: e.shiftKey, toggle: isAdditiveModifier(e) });
}

// Tracks when editing started so we can ignore menu-close blur events
let editStartTime = 0;

function startEditing() {
  editName.value = props.node.name;
  isEditing.value = true;
  editStartTime = Date.now();
  // Delay focus so the context menu has fully closed before we steal focus
  setTimeout(() => {
    inputEl.value?.focus();
    inputEl.value?.select();
  }, 50);
}

function saveRename() {
  if (!isEditing.value) return;
  const newName = editName.value.trim();
  if (newName && newName !== props.node.name) {
    history.execute(new RenameNodeCommand(props.node, newName));
  }
  isEditing.value = false;
}

// Guard: ignore blur events that fire within 300ms of startEditing (context menu close side-effect)
function onInputBlur() {
  if (Date.now() - editStartTime < 300) return;
  saveRename();
}

function cancelEditing() {
  isEditing.value = false;
}

const { openMenu } = useGlobalContextMenu();

function collectFixtures(node: SceneNode): Fixture[] {
  if (node instanceof FixtureGroup) return node.children.flatMap(collectFixtures);
  return [node as Fixture];
}

function handleHighlight() {
  const command = createHighlightCommand(collectFixtures(props.node));
  if (command) history.execute(command);
}

function onContextMenu(e: MouseEvent) {
  const options: ContextMenuItemOption[] = [
    {
      label: 'Center Item',
      action: () => emit('zoomTo', props.node),
    },
    {
      label: 'Group Selection',
      shortcut: '⌘G',
      action: () => emit('group'),
    },
  ];

  if (isGroup.value) {
    options.push({
      label: 'Ungroup',
      shortcut: '⇧⌘G',
      action: () => emit('ungroup', props.node as FixtureGroup),
    });
  }

  options.push({
    label: 'Rename',
    shortcut: 'F2',
    action: () => startEditing(),
  });

  options.push({
    label: 'Highlight (Set to White)',
    icon: Lightbulb,
    action: handleHighlight,
  });

  if (!isGroup.value && (props.node as Fixture).definition) {
    options.push({ isSeparator: true });
    options.push({
      label: 'Edit Fixture Type',
      shortcut: 'E',
      action: () => emit('editType', props.node),
    });
  }

  options.push({ isSeparator: true });
  options.push({
    label: 'Delete',
    variant: 'destructive',
    icon: Trash2,
    shortcut: 'Del',
    action: () => emit('delete', props.node),
  });

  openMenu(e, options, { id: isGroup.value ? 'group' : 'fixture', scopes: scopeSnapshot.value });
}

// F2 triggers rename only when this node is the single selection
useShortcuts([
  { key: 'F2', label: 'Rename', handler: () => { if (isSelected.value) startEditing(); } },
]);
</script>

<template>
  <!-- ─── Fixture (leaf) node ─────────────────────────────────────────────── -->
  <PmListItem v-if="!isGroup" id="fixture" :as="SidebarMenuItem" :manual="['badges', 'actions']" v-slot="{ Badges, Actions }">
    <SidebarMenuButton
      ref="rowEl"
      :is-active="isSelected"
      :class="isCanvasHovered && (isSelected ? 'bg-muted-foreground/30!' : 'bg-muted-foreground/15')"
      @click="handleSelect"
      @contextmenu.prevent="onContextMenu"
    >
      <Spotlight class="w-4 h-4 mr-2" @dblclick.stop="emit('zoomTo', node)" />
      <input
        v-if="isEditing"
        ref="inputEl"
        v-model="editName"
        class="bg-background border border-primary rounded px-1 w-full text-sm outline-none"
        @keydown.enter="saveRename"
        @keydown.esc="cancelEditing"
        @blur="onInputBlur"
        @click.stop
      />
      <span v-else @dblclick="startEditing">{{ node.name }}</span>
      <span class="ml-auto flex items-center gap-1 empty:hidden"><component :is="Badges" /><component :is="Actions" /></span>
    </SidebarMenuButton>
  </PmListItem>

  <!-- ─── Group (collapsible) node ─────────────────────────────────────────── -->
  <Collapsible v-else v-model:open="isExpanded" as-child>
    <PmListItem id="group" :as="SidebarMenuItem" :manual="['badges', 'actions']" v-slot="{ Badges, Actions }">
      <SidebarMenuButton :is-active="isSelected" @click="handleSelect" @contextmenu.prevent="onContextMenu">
        <CollapsibleTrigger as-child>
          <button class="mr-1 hover:bg-accent rounded p-0.5" @click.stop @dblclick.stop="emit('zoomTo', node)">
            <ChevronDown v-if="isExpanded" class="w-3 h-3" />
            <ChevronRight v-else class="w-3 h-3" />
          </button>
        </CollapsibleTrigger>
        <input
          v-if="isEditing"
          ref="inputEl"
          v-model="editName"
          class="bg-background border border-primary rounded px-1 w-full text-sm outline-none"
          @keydown.enter="saveRename"
          @keydown.esc="cancelEditing"
          @blur="saveRename"
          @click.stop
        />
        <span v-else @dblclick="startEditing">{{ node.name }}</span>
        <span class="ml-auto flex items-center gap-1 empty:hidden"><component :is="Badges" /><component :is="Actions" /></span>
      </SidebarMenuButton>

      <CollapsibleContent>
        <SidebarMenuSub class="ml-4 border-l border-border pl-2">
          <!-- Recursive render -->
          <FixtureSidebarNode
            v-for="child in (node as FixtureGroup).children"
            :key="child.id"
            :node="child"
            :selected-ids="selectedIds"
            @select="(id, mods) => emit('select', id, mods)"
            @group="emit('group')"
            @ungroup="g => emit('ungroup', g)"
            @zoom-to="(n: SceneNode) => emit('zoomTo', n)"
            @edit-type="(n: SceneNode) => emit('editType', n)"
            @delete="(n: SceneNode) => emit('delete', n)"
          />
        </SidebarMenuSub>
      </CollapsibleContent>
    </PmListItem>
  </Collapsible>
</template>
