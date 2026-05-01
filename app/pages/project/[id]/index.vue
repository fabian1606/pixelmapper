<script setup lang="ts">
import { ref, onMounted, onUnmounted, shallowRef, computed, nextTick, provide } from 'vue';
import { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import DeleteConfirmDialog from '~/components/engine/DeleteConfirmDialog.vue';
import FixtureEditor from '~/components/engine/FixtureEditor.vue';
import FixtureSidebar from '~/components/engine/FixtureSidebar.vue';
import FixturePropertiesSidebar from '~/components/engine/FixturePropertiesSidebar.vue';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useHistory } from '~/components/engine/composables/use-history';
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

definePageMeta({ layout: 'project' })

const route = useRoute()
const projectId = route.params.id as string

const engineStore = useEngineStore()
engineStore.initEngine()

const { sceneNodes, flatFixtures, selectedIds, projectLoading } = storeToRefs(engineStore)
const engine = engineStore.engine
const history = useHistory()

provide('effectEngine', engine)

onMounted(() => {
  engineStore.loadProject(projectId)
})

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

function handleSelect(id: string | number, multiple: boolean) {
  if (multiple) {
    const next = new Set(selectedIds.value)
    next.has(id) ? next.delete(id) : next.add(id)
    selectedIds.value = next
  } else {
    selectedIds.value = new Set([id])
  }
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
  { key: 'g',         ctrl: true,               label: 'Group',          handler: handleGroup },
  { key: 'g',         ctrl: true, shift: true,  label: 'Ungroup',        handler: handleUngroupSelected },
  { key: 'Delete',                              label: 'Delete Selected', handler: handleDeleteSelected },
  { key: 'Backspace',                           label: 'Delete Selected', handler: handleDeleteSelected },
  { key: 'a',         shift: true,              label: 'Add Fixture',    handler: () => { addDialogOpen.value = true } },
  { key: 'p',         shift: true,              label: 'Save as Preset', handler: () => fixtureSidebarRef.value?.quickSave() },
])
</script>

<template>
  <div v-if="projectLoading" class="flex items-center justify-center h-full text-muted-foreground text-sm">
    Loading project…
  </div>

  <SidebarProvider v-else>
    <div class="flex h-full w-full bg-background overflow-hidden text-foreground font-sans m-0 p-0">
      <FixtureSidebar
        ref="fixtureSidebarRef"
        class="shrink-0"
        :nodes="sceneNodes"
        :selected-ids="selectedIds"
        :fixtures="flatFixtures"
        :effects="engine.effects"
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
        <div
          v-show="viewportMode === '3d'"
          class="flex-1 flex items-center justify-center text-muted-foreground/40 text-sm"
        >
          3D-Ansicht — bald verfügbar
        </div>
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
