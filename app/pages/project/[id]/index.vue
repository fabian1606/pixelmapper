<script setup lang="ts">
import { ref, shallowRef, computed, nextTick, watch, defineAsyncComponent } from 'vue';
import { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import DeleteConfirmDialog from '~/components/engine/DeleteConfirmDialog.vue';
import FixtureEditor from '~/components/engine/FixtureEditor.vue';
import FixtureSidebar from '~/components/engine/FixtureSidebar.vue';
import FixturePropertiesSidebar from '~/components/engine/FixturePropertiesSidebar.vue';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useHistory, triggerSaveSnapshot } from '~/components/engine/composables/use-history';
import { useWorkspaceOperations } from '~/components/engine/composables/use-workspace-operations';
import { UpdateFixtureTypesCommand } from '~/components/engine/commands/update-fixture-types-command';
import { createFixtureFromOfl } from '~/utils/ofl/fixture-factory';
import AddFixtureDialog from '~/components/engine/AddFixtureDialog.vue';
import CustomFixtureEditorDialog from '~/components/engine/custom-fixture-editor/CustomFixtureEditorDialog.vue';
import FixtureWorkspace from '~/components/engine/FixtureWorkspace.vue';
import { useShortcuts } from '~/components/engine/composables/use-shortcuts';
import ViewportModeSwitcher, { type ViewportMode } from '~/components/design/ViewportModeSwitcher.vue';
import UniverseInspector from '~/components/design/UniverseInspector.vue';
import { storeToRefs } from 'pinia';
import { useEngineStore } from '~/stores/engine-store';
import { setPageViewportMode } from '~/composables/extensions/provide-root-scopes';

definePageMeta({ layout: 'project' })

const engineStore = useEngineStore()
const { sceneNodes, flatFixtures, selectedIds } = storeToRefs(engineStore)
const engine = engineStore.engine
const history = useHistory()

// Window sizing
const windowWidth = ref(1024)
const windowHeight = ref(768)
const updateSize = () => {
  if (typeof window !== 'undefined') {
    windowWidth.value = window.innerWidth - 256
    windowHeight.value = window.innerHeight
  }
}

const viewportMode = ref<ViewportMode>('2d')
const workspaceRef = ref<InstanceType<typeof FixtureWorkspace> | null>(null)

// 3D viewport: code-split (three.js chunk) and created lazily on first switch,
// then kept alive via v-show so camera state survives mode changes.
const Viewport3D = defineAsyncComponent(() => import('~/components/three/Viewport3D.vue'))
const threeDActivated = ref(false)
watch(viewportMode, (mode) => {
  if (mode === '3d') threeDActivated.value = true
  // Mirror into the global `viewport` extension scope.
  setPageViewportMode(mode)
}, { immediate: true })

function handleZoomTo(node: SceneNode) {
  workspaceRef.value?.zoomTo(node)
}

function handleSelectFixtures(ids: (string | number)[]) {
  selectedIds.value = new Set(ids)
}

const propertiesSidebarRef = ref<InstanceType<typeof FixturePropertiesSidebar> | null>(null)
const fixtureSidebarRef = ref<{
  quickSave: () => void
  overwriteActivePreset: () => void
  createPresetFromSelection: (selectedIds: Set<string | number>) => void
} | null>(null)

function handleOpenPropertiesTab(tab: string, isModifier?: boolean, effectId?: string) {
  nextTick(() => propertiesSidebarRef.value?.openTab(tab, isModifier, effectId))
}

// Anchor for shift-range selection in the sidebar — the last node clicked
// without shift. Range-select spans from here to the shift-clicked node.
let selectionAnchor: string | number | null = null

// Flatten the scene tree into the order the rows appear in the sidebar,
// descending only into expanded groups (collapsed groups contribute just
// their own row). This linear order defines what "between two nodes" means.
function flattenVisibleNodes(nodes: SceneNode[]): SceneNode[] {
  const out: SceneNode[] = []
  for (const node of nodes) {
    out.push(node)
    if (node instanceof FixtureGroup && node.expanded) {
      out.push(...flattenVisibleNodes(node.children))
    }
  }
  return out
}

function handleSelect(id: string | number, mods: { range: boolean; toggle: boolean }) {
  if (mods.range) {
    const flat = flattenVisibleNodes(sceneNodes.value)
    // Anchor = the last non-shift click, or — if that's gone/stale — any node
    // that's currently selected (so shift extends from a selection made
    // anywhere: canvas, 3D, or a drilled-into group member).
    let anchor = selectionAnchor
    if (anchor === null || !flat.some(n => n.id === anchor)) {
      anchor = flat.find(n => selectedIds.value.has(n.id))?.id ?? null
    }
    const a = anchor !== null ? flat.findIndex(n => n.id === anchor) : -1
    const b = flat.findIndex(n => n.id === id)
    if (a !== -1 && b !== -1 && a !== b) {
      const [lo, hi] = a < b ? [a, b] : [b, a]
      // Shift-range ignores groups entirely — it only ever yields individual
      // leaf fixtures. Expanded group headers are skipped (their children are
      // already their own rows in the slice); a collapsed group contributes
      // all of its leaf fixtures.
      const ids = flat.slice(lo, hi + 1).flatMap(n =>
        n instanceof FixtureGroup
          ? (n.expanded ? [] : n.getAllFixtures().map(f => f.id))
          : [n.id]
      )
      selectedIds.value = new Set(ids)
      // Keep the anchor so the user can grow/shrink the range with more shift-clicks.
      return
    }
  }

  if (mods.toggle) {
    const next = new Set(selectedIds.value)
    next.has(id) ? next.delete(id) : next.add(id)
    selectedIds.value = next
  } else {
    selectedIds.value = new Set([id])
  }
  selectionAnchor = id
}

function handleSelectAll() {
  // Figma-style: Ctrl+A operates on the current selection level — if the
  // selection (or its first match) lives inside a group, select that
  // group's siblings; otherwise select everything at the top level.
  function findFirstSelected(nodes: SceneNode[]): SceneNode | null {
    for (const node of nodes) {
      if (selectedIds.value.has(node.id)) return node
      if (node instanceof FixtureGroup) {
        const found = findFirstSelected(node.children)
        if (found) return found
      }
    }
    return null
  }
  const referenceNode = findFirstSelected(sceneNodes.value)
  const parentGroup = referenceNode?.parent ?? null
  const siblings = parentGroup ? parentGroup.children : sceneNodes.value
  selectedIds.value = new Set(siblings.map(n => n.id))
}

const hasSelectedGroup = computed(() => {
  let hasGroup = false
  function findSelected(nodes: SceneNode[]) {
    for (const node of nodes) {
      if (node instanceof FixtureGroup && selectedIds.value.has(node.id)) hasGroup = true
      if (node instanceof FixtureGroup) findSelected(node.children)
    }
  }
  findSelected(sceneNodes.value)
  return hasGroup
})

const { handleAddOflFixtures, handleGroup, handleUngroup, handleUngroupSelected, handleDeleteNodes } =
  useWorkspaceOperations(sceneNodes, selectedIds, flatFixtures)

const addDialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const nodesPendingDelete = shallowRef<SceneNode[]>([])

function handleDeleteNode(node: SceneNode) {
  nodesPendingDelete.value = [node]
  deleteDialogOpen.value = true
}

function handleDeleteSelected() {
  if (selectedIds.value.size === 0) return
  const nodesToDelete: SceneNode[] = []
  function findTopLevelSelected(nodes: SceneNode[]) {
    for (const node of nodes) {
      if (selectedIds.value.has(node.id)) nodesToDelete.push(node)
      else if (node instanceof FixtureGroup) findTopLevelSelected(node.children)
    }
  }
  findTopLevelSelected(sceneNodes.value)
  if (nodesToDelete.length === 0) return
  nodesPendingDelete.value = nodesToDelete
  deleteDialogOpen.value = true
}

function confirmDelete() {
  handleDeleteNodes(nodesPendingDelete.value)
  nodesPendingDelete.value = []
}

const customFixtureEditorOpen = ref(false)
const editFixtureDefinition = shallowRef<import('~/utils/ofl/types').OflFixture | null>(null)

function handleEditFixtureType(node: SceneNode) {
  if (node instanceof Fixture && node.definition) {
    editFixtureDefinition.value = node.definition
    customFixtureEditorOpen.value = true
  }
}

function handleUpdateFixtureType(newOfl: import('~/utils/ofl/types').OflFixture) {
  const targetName = editFixtureDefinition.value?.name
  if (!targetName) return
  const oldInstances = flatFixtures.value.filter(f => f.definition?.name === targetName)
  if (oldInstances.length > 0) {
    const newInstances = oldInstances.map(old => {
      const newFixture = createFixtureFromOfl(newOfl)
      newFixture.id = old.id
      newFixture.name = old.name
      newFixture.fixturePosition = { ...old.fixturePosition }
      newFixture.positionZ = old.positionZ
      newFixture.rotation = old.rotation
      newFixture.tiltX = old.tiltX
      newFixture.rollZ = old.rollZ
      newFixture.startAddress = old.startAddress
      return newFixture
    })
    history.execute(new UpdateFixtureTypesCommand(sceneNodes.value, oldInstances, newInstances))
  }
  customFixtureEditorOpen.value = false
  editFixtureDefinition.value = null
}

useShortcuts([
  { key: 'z',         ctrl: true,               label: 'Undo',           handler: () => history.undo() },
  { key: 'z',         ctrl: true, shift: true,  label: 'Redo',           handler: () => history.redo() },
  { key: 'y',         ctrl: true,               label: 'Redo',           handler: () => history.redo() },
  { key: 'a',         ctrl: true,               label: 'Select All',     handler: handleSelectAll },
  { key: 'g',         ctrl: true,               label: 'Group',          handler: handleGroup },
  { key: 'g',         ctrl: true, shift: true,  label: 'Ungroup',        handler: handleUngroupSelected },
  { key: 'Delete',                              label: 'Delete Selected', handler: handleDeleteSelected },
  { key: 'Backspace',                           label: 'Delete Selected', handler: handleDeleteSelected },
  { key: 'a',         shift: true,              label: 'Add Fixture',    handler: () => { addDialogOpen.value = true } },
  { key: 'p',         shift: true,              label: 'Save as Preset', handler: () => fixtureSidebarRef.value?.quickSave() },
  { key: 's',         ctrl: true,               label: 'Force Snapshot', handler: () => triggerSaveSnapshot() },
])
</script>

<template>
  <SidebarProvider>
    <div class="flex h-full w-full bg-background overflow-hidden text-foreground font-sans m-0 p-0">
      <FixtureSidebar
        ref="fixtureSidebarRef"
        class="shrink-0"
        :nodes="sceneNodes"
        :selected-ids="selectedIds"
        :fixtures="flatFixtures"
        :effects="engine.modifiers"
        @select="handleSelect"
        @group="handleGroup"
        @ungroup="handleUngroup"
        @zoom-to="handleZoomTo"
        @edit-type="handleEditFixtureType"
        @request-add-fixture="addDialogOpen = true"
        @delete-node="handleDeleteNode"
        @select-fixtures="handleSelectFixtures"
        @open-properties-tab="handleOpenPropertiesTab"
      />
      <main class="flex-1 relative flex min-w-0 overflow-hidden">
        <FixtureWorkspace
          v-show="viewportMode === '2d'"
          ref="workspaceRef"
          class="flex-1 min-w-0"
          @quick-save="() => fixtureSidebarRef?.quickSave()"
          @overwrite-active-preset="() => fixtureSidebarRef?.overwriteActivePreset()"
          @create-preset-from-selection="(ids) => fixtureSidebarRef?.createPresetFromSelection(ids)"
          @edit-type="handleEditFixtureType"
        />
        <UniverseInspector
          v-show="viewportMode === 'raw'"
          :active="viewportMode === 'raw'"
          class="flex-1 min-w-0"
        />
        <Viewport3D
          v-if="threeDActivated"
          v-show="viewportMode === '3d'"
          :active="viewportMode === '3d'"
          class="flex-1 min-w-0"
        />
        <ViewportModeSwitcher v-model="viewportMode" />
        <div class="w-12 shrink-0" />
        <FixturePropertiesSidebar
          ref="propertiesSidebarRef"
          :selected-ids="selectedIds"
          :fixtures="flatFixtures"
          :nodes="sceneNodes"
        />
      </main>
    </div>
  </SidebarProvider>

  <AddFixtureDialog v-model:open="addDialogOpen" @add="handleAddOflFixtures" />

  <DeleteConfirmDialog
    v-model:open="deleteDialogOpen"
    :node-name="nodesPendingDelete[0]?.name ?? ''"
    :count="nodesPendingDelete.length"
    @confirm="confirmDelete"
  />

  <CustomFixtureEditorDialog
    v-model:open="customFixtureEditorOpen"
    :fixture-to-edit="editFixtureDefinition"
    @update-type="handleUpdateFixtureType"
  />
</template>
