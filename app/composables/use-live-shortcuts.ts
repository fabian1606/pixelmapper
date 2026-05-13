import { useShortcuts } from '~/components/engine/composables/use-shortcuts';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useHistory } from '~/components/engine/composables/use-history';
import {
  AddLiveWidgetCommand,
  RemoveLiveWidgetCommand,
  GroupLiveWidgetsCommand,
  UngroupLiveWidgetsCommand,
} from '~/components/engine/commands/live-widget-commands';
import type { LiveWidget } from '~/utils/live/types';

/** Deep-clone a widget and assign a new ID. Controller-twin children are
 *  mapping records (not canvas widgets), so they survive the clone as-is. */
function cloneWidget(w: LiveWidget): LiveWidget {
  const copy: LiveWidget = JSON.parse(JSON.stringify(w));
  copy.id = crypto.randomUUID();
  return copy;
}

/**
 * Registers the standard live-mode keyboard shortcuts:
 *   Cmd/Ctrl+Z         → Undo
 *   Cmd/Ctrl+Shift+Z   → Redo
 *   Cmd/Ctrl+Y         → Redo
 *   Cmd/Ctrl+C         → Copy selected widgets
 *   Cmd/Ctrl+V         → Paste from clipboard
 *   Cmd/Ctrl+X         → Cut selected widgets
 *   Cmd/Ctrl+D         → Duplicate selected widgets
 *   Cmd/Ctrl+A         → Select all widgets on the active page
 *   Delete / Backspace → Delete selected widgets
 *   Escape             → Clear selection
 */
export function useLiveShortcuts() {
  const store = useLiveModeStore();
  const history = useHistory();

  function getSelectedWidgets(): LiveWidget[] {
    const page = store.activePage;
    if (!page) return [];
    return page.widgets.filter(w => store.selectedWidgetIds.has(w.id));
  }

  function copySelected() {
    if (!store.editMode) return;
    const widgets = getSelectedWidgets();
    if (widgets.length === 0) return;
    // Store clean copies (no IDs reassigned yet — that happens on paste).
    store.clipboard = widgets.map(w => JSON.parse(JSON.stringify(w)));
  }

  function paste() {
    if (!store.editMode) return;
    const page = store.activePage;
    if (!page || store.clipboard.length === 0) return;

    // Offset pasted widgets by 1 grid cell so they don't perfectly overlap.
    const offset = 1;
    const newIds = new Set<string>();
    for (const tmpl of store.clipboard) {
      const clone = cloneWidget(tmpl);
      clone.gridX = Math.max(0, clone.gridX + offset);
      clone.gridY = Math.max(0, clone.gridY + offset);
      history.execute(new AddLiveWidgetCommand(page.id, clone));
      newIds.add(clone.id);
    }
    // Update clipboard so a second paste pastes at offset+1 (matches common UX).
    store.clipboard = store.clipboard.map(w => ({
      ...JSON.parse(JSON.stringify(w)),
      gridX: Math.max(0, w.gridX + offset),
      gridY: Math.max(0, w.gridY + offset),
    }));
    store.selectedWidgetIds = newIds;
  }

  function duplicateSelected() {
    if (!store.editMode) return;
    const page = store.activePage;
    if (!page) return;
    const widgets = getSelectedWidgets();
    if (widgets.length === 0) return;

    const offset = 1;
    const newIds = new Set<string>();
    for (const w of widgets) {
      const clone = cloneWidget(w);
      clone.gridX = Math.max(0, clone.gridX + offset);
      clone.gridY = Math.max(0, clone.gridY + offset);
      history.execute(new AddLiveWidgetCommand(page.id, clone));
      newIds.add(clone.id);
    }
    store.selectedWidgetIds = newIds;
  }

  function cutSelected() {
    if (!store.editMode) return;
    const page = store.activePage;
    if (!page) return;
    const widgets = getSelectedWidgets();
    if (widgets.length === 0) return;
    store.clipboard = widgets.map(w => JSON.parse(JSON.stringify(w)));
    for (const w of widgets) {
      history.execute(new RemoveLiveWidgetCommand(page.id, w.id));
    }
    store.selectedWidgetIds = new Set();
  }

  function deleteSelected() {
    if (!store.editMode) return;
    const page = store.activePage;
    if (!page) return;
    const widgets = getSelectedWidgets();
    if (widgets.length === 0) return;
    for (const w of widgets) {
      history.execute(new RemoveLiveWidgetCommand(page.id, w.id));
    }
    store.selectedWidgetIds = new Set();
  }

  function selectAll() {
    if (!store.editMode) return;
    const page = store.activePage;
    if (!page) return;
    store.selectedWidgetIds = new Set(page.widgets.map(w => w.id));
  }

  function clearSelection() {
    // Escape priority: section mapping mode → section isolation → group isolation → clear selection
    if (store.sectionMappingMode !== null) {
      store.sectionMappingMode = null;
      return;
    }
    if (store.isolatedSectionId !== null) {
      store.isolatedSectionId = null;
      return;
    }
    if (store.isolatedGroupId !== null) {
      store.isolatedGroupId = null;
      return;
    }
    store.selectedWidgetIds = new Set();
  }

  function groupSelected() {
    if (!store.editMode) return;
    const page = store.activePage;
    if (!page) return;
    const widgets = getSelectedWidgets();
    if (widgets.length < 2) return; // Nothing to group
    const groupId = crypto.randomUUID();
    history.execute(new GroupLiveWidgetsCommand(page.id, widgets.map(w => w.id), groupId));
  }

  function ungroupSelected() {
    if (!store.editMode) return;
    const page = store.activePage;
    if (!page) return;
    const widgets = getSelectedWidgets();
    // Pull in every widget that shares a group with any selected widget so a
    // partial selection still ungroups the whole group cleanly.
    const groupIds = new Set<string>();
    for (const w of widgets) if (w.groupId) groupIds.add(w.groupId);
    if (groupIds.size === 0) return;
    const ids: string[] = [];
    for (const w of page.widgets) {
      if (w.groupId && groupIds.has(w.groupId)) ids.push(w.id);
    }
    if (ids.length === 0) return;
    history.execute(new UngroupLiveWidgetsCommand(page.id, ids));
  }

  useShortcuts([
    { key: 'z', ctrl: true,              label: 'Undo',          handler: () => history.undo() },
    { key: 'z', ctrl: true, shift: true, label: 'Redo',          handler: () => history.redo() },
    { key: 'y', ctrl: true,              label: 'Redo',          handler: () => history.redo() },
    { key: 'c', ctrl: true,              label: 'Copy',          handler: copySelected },
    { key: 'v', ctrl: true,              label: 'Paste',         handler: paste },
    { key: 'x', ctrl: true,              label: 'Cut',           handler: cutSelected },
    { key: 'd', ctrl: true,              label: 'Duplicate',     handler: duplicateSelected },
    { key: 'a', ctrl: true,              label: 'Select All',    handler: selectAll },
    { key: 'g', ctrl: true,              label: 'Group',         handler: groupSelected },
    { key: 'g', ctrl: true, shift: true, label: 'Ungroup',       handler: ungroupSelected },
    { key: 'Delete',                     label: 'Delete',        handler: deleteSelected },
    { key: 'Backspace',                  label: 'Delete',        handler: deleteSelected },
    { key: 'Escape',                     label: 'Clear Sel.',    handler: clearSelection },
  ]);

  return {
    copySelected,
    paste,
    cutSelected,
    duplicateSelected,
    deleteSelected,
    selectAll,
    clearSelection,
    groupSelected,
    ungroupSelected,
  };
}
