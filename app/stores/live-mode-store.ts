import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { LivePage, LiveWidget, ControllerChildBinding, LiveSection, SectionMember, LiveControllerInstance } from '~/utils/live/types';

export const useLiveModeStore = defineStore('live-mode', () => {
  const pages = ref<LivePage[]>([]);
  const activePageId = ref<string | null>(null);
  const editMode = ref(true);
  const selectedWidgetIds = ref<Set<string>>(new Set());
  // Clipboard: deep-cloned widget snapshots from the last copy/cut.
  const clipboard = ref<LiveWidget[]>([]);
  // Isolation: when set, the user has "entered" a group via double-click.
  // While isolated, clicks select individual group members instead of the
  // whole group, like Figma/Sketch group editing.
  const isolatedGroupId = ref<string | null>(null);
  // When a controller-twin is selected, this holds the controlId currently
  // being edited in the right sidebar (or null = no per-control focus).
  const selectedControlId = ref<string | null>(null);
  // Section ID the user is currently editing in the sidebar (clicking a member
  // selects both the widget and surfaces its section here).
  const selectedSectionId = ref<string | null>(null);
  // When set, the user has "entered" a section via double-click — clicks on
  // section members select the individual widget, like group isolation.
  const isolatedSectionId = ref<string | null>(null);
  // When set to a sectionId, the canvas is in section-mapping mode: clicking a
  // widget toggles its membership in that section.
  const sectionMappingMode = ref<string | null>(null);
  // Runtime-only: which member(s) inside a section are currently "active".
  // Map<sectionId, Set<memberKey>>. Cleared on reset / page switch.
  const activeSectionMembers = ref<Map<string, Set<string>>>(new Map());
  /** Controller instances persisted with the project. Auto-connect on load. */
  const liveControllers = ref<LiveControllerInstance[]>([]);

  const activePage = computed(() => pages.value.find(p => p.id === activePageId.value) ?? null);

  function loadPages(incoming: LivePage[]) {
    pages.value = incoming;
    activePageId.value = incoming[0]?.id ?? null;
  }

  function reset() {
    pages.value = [];
    activePageId.value = null;
    editMode.value = true;
    selectedWidgetIds.value = new Set();
    isolatedGroupId.value = null;
    selectedControlId.value = null;
    selectedSectionId.value = null;
    isolatedSectionId.value = null;
    sectionMappingMode.value = null;
    activeSectionMembers.value = new Map();
    liveControllers.value = [];
  }

  function addLiveController(instance: LiveControllerInstance) {
    if (!liveControllers.value.some(c => c.id === instance.id)) {
      liveControllers.value = [...liveControllers.value, instance];
    }
  }

  function removeLiveController(instanceId: string) {
    liveControllers.value = liveControllers.value.filter(c => c.id !== instanceId);
  }

  function loadLiveControllers(incoming: LiveControllerInstance[]) {
    liveControllers.value = incoming.filter(c => c && typeof c === 'object' && typeof c.id === 'string');
  }

  function exitIsolation() {
    isolatedGroupId.value = null;
  }

  function exitSectionIsolation() {
    isolatedSectionId.value = null;
  }

  function exitSectionMappingMode() {
    sectionMappingMode.value = null;
  }

  function setActivePage(id: string) {
    if (pages.value.some(p => p.id === id)) {
      activePageId.value = id;
      isolatedGroupId.value = null;
      selectedWidgetIds.value = new Set();
      selectedControlId.value = null;
      selectedSectionId.value = null;
      isolatedSectionId.value = null;
      sectionMappingMode.value = null;
    }
  }

  function addPage(page: LivePage) {
    pages.value.push(page);
    if (!activePageId.value) activePageId.value = page.id;
  }

  function removePage(pageId: string) {
    const idx = pages.value.findIndex(p => p.id === pageId);
    if (idx === -1) return;
    pages.value.splice(idx, 1);
    if (activePageId.value === pageId) {
      activePageId.value = pages.value[Math.max(0, idx - 1)]?.id ?? null;
    }
  }

  function updatePage(pageId: string, changes: Partial<Omit<LivePage, 'id' | 'widgets'>>) {
    const page = pages.value.find(p => p.id === pageId);
    if (page) Object.assign(page, changes);
  }

  function addWidget(pageId: string, widget: LiveWidget) {
    const page = pages.value.find(p => p.id === pageId);
    if (page) page.widgets.push(widget);
  }

  function removeWidget(pageId: string, widgetId: string) {
    const page = pages.value.find(p => p.id === pageId);
    if (!page) return;
    const idx = page.widgets.findIndex(w => w.id === widgetId);
    if (idx !== -1) page.widgets.splice(idx, 1);
  }

  function moveResizeWidget(pageId: string, widgetId: string, gridX: number, gridY: number, gridW: number, gridH: number) {
    const page = pages.value.find(p => p.id === pageId);
    const widget = page?.widgets.find(w => w.id === widgetId);
    if (widget) Object.assign(widget, { gridX, gridY, gridW, gridH });
  }

  function updateWidgetMapping(pageId: string, widgetId: string, patch: Partial<Pick<LiveWidget, 'mapping' | 'label' | 'color' | 'controllerInstanceId'>>) {
    const page = pages.value.find(p => p.id === pageId);
    const widget = page?.widgets.find(w => w.id === widgetId);
    if (widget) Object.assign(widget, patch);
  }

  function setWidgetGroupId(pageId: string, widgetId: string, groupId: string | null) {
    const page = pages.value.find(p => p.id === pageId);
    const widget = page?.widgets.find(w => w.id === widgetId);
    if (!widget) return;
    if (groupId === null) delete widget.groupId;
    else widget.groupId = groupId;
  }

  function addSection(pageId: string, section: LiveSection) {
    const page = pages.value.find(p => p.id === pageId);
    if (!page) return;
    if (!page.sections) page.sections = [];
    page.sections.push(section);
  }

  function removeSection(pageId: string, sectionId: string) {
    const page = pages.value.find(p => p.id === pageId);
    if (!page?.sections) return;
    const idx = page.sections.findIndex(s => s.id === sectionId);
    if (idx !== -1) page.sections.splice(idx, 1);
  }

  function updateSection(pageId: string, sectionId: string, changes: Partial<Omit<LiveSection, 'id' | 'members'>>) {
    const page = pages.value.find(p => p.id === pageId);
    const section = page?.sections?.find(s => s.id === sectionId);
    if (section) Object.assign(section, changes);
  }

  function setSectionMembers(pageId: string, sectionId: string, members: SectionMember[]) {
    const page = pages.value.find(p => p.id === pageId);
    const section = page?.sections?.find(s => s.id === sectionId);
    if (section) section.members = members.map(m => ({ ...m }));
  }

  function updateControllerChildMapping(
    pageId: string,
    twinId: string,
    controlId: string,
    patch: Partial<Pick<ControllerChildBinding, 'mapping' | 'label' | 'color'>>,
  ) {
    const page = pages.value.find(p => p.id === pageId);
    const twin = page?.widgets.find(w => w.id === twinId);
    if (!twin) return;
    if (!twin.controllerChildren) twin.controllerChildren = [];
    let child = twin.controllerChildren.find(c => c.controlId === controlId);
    if (!child) {
      child = { controlId, mapping: { type: 'none' } };
      twin.controllerChildren.push(child);
    }
    if ('mapping' in patch && patch.mapping) child.mapping = patch.mapping;
    if ('label' in patch) child.label = patch.label;
    if ('color' in patch) child.color = patch.color;
  }

  return {
    pages,
    activePageId,
    editMode,
    selectedWidgetIds,
    clipboard,
    isolatedGroupId,
    selectedControlId,
    selectedSectionId,
    isolatedSectionId,
    sectionMappingMode,
    activeSectionMembers,
    liveControllers,
    activePage,
    loadPages,
    reset,
    addLiveController,
    removeLiveController,
    loadLiveControllers,
    exitIsolation,
    exitSectionIsolation,
    exitSectionMappingMode,
    setActivePage,
    addPage,
    removePage,
    updatePage,
    addWidget,
    removeWidget,
    moveResizeWidget,
    updateWidgetMapping,
    setWidgetGroupId,
    addSection,
    removeSection,
    updateSection,
    setSectionMembers,
    updateControllerChildMapping,
  };
});
