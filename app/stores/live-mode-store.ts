import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { LivePage, LiveWidget } from '~/utils/live/types';

export const useLiveModeStore = defineStore('live-mode', () => {
  const pages = ref<LivePage[]>([]);
  const activePageId = ref<string | null>(null);
  const editMode = ref(true);
  const selectedWidgetIds = ref<Set<string>>(new Set());
  // Clipboard: deep-cloned widget snapshots from the last copy/cut.
  const clipboard = ref<LiveWidget[]>([]);

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
  }

  function setActivePage(id: string) {
    if (pages.value.some(p => p.id === id)) activePageId.value = id;
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

  function updateWidgetMapping(pageId: string, widgetId: string, patch: Partial<Pick<LiveWidget, 'mapping' | 'label' | 'color'>>) {
    const page = pages.value.find(p => p.id === pageId);
    const widget = page?.widgets.find(w => w.id === widgetId);
    if (widget) Object.assign(widget, patch);
  }

  return {
    pages,
    activePageId,
    editMode,
    selectedWidgetIds,
    clipboard,
    activePage,
    loadPages,
    reset,
    setActivePage,
    addPage,
    removePage,
    updatePage,
    addWidget,
    removeWidget,
    moveResizeWidget,
    updateWidgetMapping,
  };
});
