<script setup lang="ts">
import { computed } from 'vue';
import type { LiveWidget } from '~/utils/live/types';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useHistory } from '~/components/engine/composables/use-history';
import { MoveResizeLiveWidgetCommand, BatchMoveResizeLiveWidgetsCommand, SetSectionMembersCommand, type BatchMoveResizeUpdate } from '~/components/engine/commands/live-widget-commands';
import { findSectionFor } from '~/utils/live/sections';
import LiveButtonWidget from './LiveButtonWidget.vue';
import LiveSliderWidget from './LiveSliderWidget.vue';
import LiveXYPadWidget from './LiveXYPadWidget.vue';
import LiveLabelWidget from './LiveLabelWidget.vue';
import LiveControllerTwinWidget from './LiveControllerTwinWidget.vue';

const props = defineProps<{
  widget: LiveWidget;
  pageId: string;
  gridSize: number;
  editMode: boolean;
  canvasScale: number;
}>();

const store = useLiveModeStore();
const history = useHistory();

const isSelected = computed(() => store.selectedWidgetIds.has(props.widget.id));
// Resize handles only when exactly this one widget is selected (no multi-resize).
const showResizeHandles = computed(() => isSelected.value && store.selectedWidgetIds.size === 1);
const isGrouped = computed(() => !!props.widget.groupId);
// Whether the user is currently "inside" this widget's group (Figma-style)
const isInIsolatedGroup = computed(() =>
  !!props.widget.groupId && store.isolatedGroupId === props.widget.groupId
);
// Dim widgets that aren't in the isolated group, like Figma/Sketch
const isDimmedByIsolation = computed(() =>
  store.isolatedGroupId !== null && !isInIsolatedGroup.value
);

// Section the widget belongs to (canvas-level — no controlId)
const widgetSection = computed(() => {
  const page = store.activePage;
  if (!page) return null;
  const membership = findSectionFor(page, props.widget.id, undefined);
  return membership ? membership.section : null;
});
// Whether this widget participates in the currently-isolated section. True for
// direct canvas-level members AND for twins whose sub-controls are members.
const isInIsolatedSection = computed(() => {
  if (store.isolatedSectionId === null) return false;
  if (widgetSection.value?.id === store.isolatedSectionId) return true;
  const page = store.activePage;
  const sec = page?.sections?.find(s => s.id === store.isolatedSectionId);
  return sec?.members.some(m => m.widgetId === props.widget.id) ?? false;
});
// In section mapping mode: is this widget a member of the mapped section?
const isSectionMappingTarget = computed(() => store.sectionMappingMode !== null);
const isSectionMember = computed(() => {
  const sid = store.sectionMappingMode;
  if (!sid) return false;
  const page = store.activePage;
  if (!page) return false;
  const sec = page.sections?.find(s => s.id === sid);
  return sec?.members.some(m => m.widgetId === props.widget.id && !m.controlId) ?? false;
});
// Dim when something else is isolated (group or section) and this widget isn't in it
const isDimmedBySectionIsolation = computed(() =>
  store.isolatedSectionId !== null && !isInIsolatedSection.value
);
// Show dashed yellow highlight when this widget is a section member AND either:
//  (a) the section is currently selected as a whole on the canvas, or
//  (b) we're in mapping mode and this is a member of the mapped section.
const isSectionHighlighted = computed(() => {
  const sec = widgetSection.value;
  if (!sec) return false;
  if (isSectionMappingTarget.value) return isSectionMember.value;
  // Section selected as a whole: all canvas members are in selectedWidgetIds
  const memberIds = sec.members.filter(m => !m.controlId).map(m => m.widgetId);
  return memberIds.length > 0 && memberIds.every(id => store.selectedWidgetIds.has(id));
});

// Position/size from grid coordinates
const style = computed(() => ({
  position: 'absolute' as const,
  left: `${props.widget.gridX * props.gridSize}px`,
  top: `${props.widget.gridY * props.gridSize}px`,
  width: `${props.widget.gridW * props.gridSize}px`,
  height: `${props.widget.gridH * props.gridSize}px`,
}));

// ── Double-click: enter group or section isolation (Figma-style) ────────────
function onDoubleClick(e: MouseEvent) {
  if (!props.editMode) return;
  e.stopPropagation();
  // Section isolation takes priority over group (a section member that's also
  // grouped enters its section first; double-clicking again enters the group).
  const sec = widgetSection.value;
  if (sec && store.isolatedSectionId !== sec.id) {
    store.isolatedSectionId = sec.id;
    store.isolatedGroupId = null;
    store.selectedWidgetIds = new Set([props.widget.id]);
    return;
  }
  if (props.widget.groupId) {
    store.isolatedGroupId = props.widget.groupId;
    store.isolatedSectionId = null;
    store.selectedWidgetIds = new Set([props.widget.id]);
  }
}

// ── Drag (move) — supports multi-selection ──────────────────────────────────

function getActiveWidgetIds(includeGroup: boolean): Set<string> {
  // Returns the effective selection given the clicked widget's group.
  const page = store.activePage;
  if (!page) return new Set([props.widget.id]);
  const ids = new Set<string>([props.widget.id]);
  if (includeGroup && props.widget.groupId) {
    for (const w of page.widgets) {
      if (w.groupId === props.widget.groupId) ids.add(w.id);
    }
  }
  return ids;
}

function onMouseDown(e: MouseEvent) {
  if (!props.editMode) return;
  if (e.button !== 0) return;
  e.stopPropagation();

  const cmd = e.metaKey || e.ctrlKey;
  const shift = e.shiftKey;
  const page = store.activePage;
  if (!page) return;

  // ── Section mapping mode: clicks toggle section membership ───────────────
  if (store.sectionMappingMode) {
    const sectionId = store.sectionMappingMode;
    const sec = page.sections?.find(s => s.id === sectionId);
    if (!sec || !store.activePageId) return;
    // Only plain canvas widgets (non-twin) can be members at this level.
    if (props.widget.type === 'controller-twin') return;
    const isCurrentMember = sec.members.some(m => m.widgetId === props.widget.id && !m.controlId);
    let next;
    if (isCurrentMember) {
      next = sec.members.filter(m => !(m.widgetId === props.widget.id && !m.controlId));
    } else {
      next = [...sec.members, { widgetId: props.widget.id }];
    }
    history.execute(new SetSectionMembersCommand(store.activePageId, sectionId, next));
    return; // no drag in mapping mode
  }

  // Clear per-control / surfaced-section state from a previous twin click.
  // Sub-control clicks stopPropagation before reaching here, so this only fires
  // for clicks on a twin frame or any non-twin widget.
  store.selectedSectionId = null;
  store.selectedControlId = null;

  // ── Selection logic ──────────────────────────────────────────────────────
  // Exit any active isolation when clicking outside it.
  const insideIsolatedGroup = !!props.widget.groupId && store.isolatedGroupId === props.widget.groupId;
  const insideIsolatedSection = isInIsolatedSection.value;

  if (store.isolatedGroupId !== null && !insideIsolatedGroup) {
    store.isolatedGroupId = null;
  }
  if (store.isolatedSectionId !== null && !insideIsolatedSection) {
    store.isolatedSectionId = null;
  }

  // Section-level selection: plain click on a section member selects the whole
  // section, unless we're already isolated inside it.
  const sec = widgetSection.value;
  if (sec && !insideIsolatedSection && !cmd && !shift) {
    const sectionWidgetIds = sec.members
      .filter(m => !m.controlId)
      .map(m => m.widgetId);
    const allSelected = sectionWidgetIds.every(id => store.selectedWidgetIds.has(id));
    if (!allSelected) {
      store.selectedWidgetIds = new Set(sectionWidgetIds);
    }
    // Still fall through to drag setup below (don't return early).
  } else {
    // Group-isolation rules (Figma-style):
    //  - When isolated INTO this widget's group, clicks select the individual widget.
    //  - When not isolated: plain click selects whole group; cmd-click bypasses.
    const expandToGroup = !insideIsolatedGroup;
    const groupMembers = expandToGroup && props.widget.groupId
      ? page.widgets.filter(w => w.groupId === props.widget.groupId).map(w => w.id)
      : [props.widget.id];

    if (shift) {
      const next = new Set(store.selectedWidgetIds);
      const allSelected = groupMembers.every(id => next.has(id));
      for (const id of groupMembers) {
        if (allSelected) next.delete(id); else next.add(id);
      }
      store.selectedWidgetIds = next;
    } else if (cmd) {
      const next = new Set(store.selectedWidgetIds);
      if (next.has(props.widget.id)) next.delete(props.widget.id);
      else next.add(props.widget.id);
      store.selectedWidgetIds = next;
    } else {
      const alreadySelected = groupMembers.every(id => store.selectedWidgetIds.has(id));
      if (!alreadySelected) {
        store.selectedWidgetIds = new Set(groupMembers);
      }
    }
  }

  // ── Drag setup ───────────────────────────────────────────────────────────
  // Capture origin positions for ALL currently-selected widgets so multi-drag
  // moves them together.
  const selectedIds = Array.from(store.selectedWidgetIds);
  if (!selectedIds.includes(props.widget.id)) {
    // Widget got deselected by the modifier-click → no drag.
    return;
  }

  const origins = new Map<string, { gridX: number; gridY: number; gridW: number; gridH: number }>();
  for (const id of selectedIds) {
    const w = page.widgets.find(x => x.id === id);
    if (w) origins.set(id, { gridX: w.gridX, gridY: w.gridY, gridW: w.gridW, gridH: w.gridH });
  }

  const startClientX = e.clientX;
  const startClientY = e.clientY;
  const pxPerCell = props.gridSize * props.canvasScale;

  // Clamp delta so no widget can be pushed past the top/left edge.
  let minOriginX = Infinity;
  let minOriginY = Infinity;
  for (const o of origins.values()) {
    if (o.gridX < minOriginX) minOriginX = o.gridX;
    if (o.gridY < minOriginY) minOriginY = o.gridY;
  }

  let movedAtAll = false;

  const onMove = (mv: MouseEvent) => {
    let dx = Math.round((mv.clientX - startClientX) / pxPerCell);
    let dy = Math.round((mv.clientY - startClientY) / pxPerCell);
    if (minOriginX + dx < 0) dx = -minOriginX;
    if (minOriginY + dy < 0) dy = -minOriginY;
    if (dx === 0 && dy === 0 && !movedAtAll) return;
    movedAtAll = true;
    for (const [id, o] of origins) {
      store.moveResizeWidget(props.pageId, id, o.gridX + dx, o.gridY + dy, o.gridW, o.gridH);
    }
  };

  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (!movedAtAll) return;

    const updates: BatchMoveResizeUpdate[] = [];
    const beforeUpdates: BatchMoveResizeUpdate[] = [];
    const pageNow = store.activePage;
    if (!pageNow) return;
    let changed = false;
    for (const id of origins.keys()) {
      const w = pageNow.widgets.find(x => x.id === id);
      const o = origins.get(id)!;
      if (!w) continue;
      if (w.gridX !== o.gridX || w.gridY !== o.gridY) changed = true;
      updates.push({ widgetId: id, gridX: w.gridX, gridY: w.gridY, gridW: w.gridW, gridH: w.gridH });
      beforeUpdates.push({ widgetId: id, gridX: o.gridX, gridY: o.gridY, gridW: o.gridW, gridH: o.gridH });
    }
    if (!changed) return;

    if (updates.length === 1) {
      const u = updates[0];
      const b = beforeUpdates[0];
      history.execute(new MoveResizeLiveWidgetCommand(
        props.pageId, u.widgetId, u.gridX, u.gridY, u.gridW, u.gridH,
        { gridX: b.gridX, gridY: b.gridY, gridW: b.gridW, gridH: b.gridH },
      ));
    } else {
      history.execute(new BatchMoveResizeLiveWidgetsCommand(props.pageId, updates, beforeUpdates));
    }
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// ── Resize ────────────────────────────────────────────────────────────────────

type ResizeAnchor = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const MIN_W = 1;
const MIN_H = 1;

function onResizeMouseDown(e: MouseEvent, anchor: ResizeAnchor) {
  if (!props.editMode) return;
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  store.selectedWidgetIds = new Set([props.widget.id]);

  const startClientX = e.clientX;
  const startClientY = e.clientY;
  const originX = props.widget.gridX;
  const originY = props.widget.gridY;
  const originW = props.widget.gridW;
  const originH = props.widget.gridH;
  const pxPerCell = props.gridSize * props.canvasScale;

  const onMove = (mv: MouseEvent) => {
    const dCellsX = Math.round((mv.clientX - startClientX) / pxPerCell);
    const dCellsY = Math.round((mv.clientY - startClientY) / pxPerCell);

    let newX = originX;
    let newY = originY;
    let newW = originW;
    let newH = originH;

    // Horizontal handles
    if (anchor === 'e' || anchor === 'ne' || anchor === 'se') {
      newW = Math.max(MIN_W, originW + dCellsX);
    } else if (anchor === 'w' || anchor === 'nw' || anchor === 'sw') {
      // Clamp dCellsX so width never drops below MIN_W and X never < 0
      const maxDX = originW - MIN_W;
      const clampedDX = Math.min(maxDX, Math.max(-originX, dCellsX));
      newX = originX + clampedDX;
      newW = originW - clampedDX;
    }

    // Vertical handles
    if (anchor === 's' || anchor === 'sw' || anchor === 'se') {
      newH = Math.max(MIN_H, originH + dCellsY);
    } else if (anchor === 'n' || anchor === 'nw' || anchor === 'ne') {
      const maxDY = originH - MIN_H;
      const clampedDY = Math.min(maxDY, Math.max(-originY, dCellsY));
      newY = originY + clampedDY;
      newH = originH - clampedDY;
    }

    store.moveResizeWidget(props.pageId, props.widget.id, newX, newY, newW, newH);
  };

  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    const changed =
      props.widget.gridX !== originX ||
      props.widget.gridY !== originY ||
      props.widget.gridW !== originW ||
      props.widget.gridH !== originH;
    if (changed) {
      history.execute(new MoveResizeLiveWidgetCommand(
        props.pageId, props.widget.id,
        props.widget.gridX, props.widget.gridY,
        props.widget.gridW, props.widget.gridH,
        { gridX: originX, gridY: originY, gridW: originW, gridH: originH },
      ));
    }
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// Keep handle visual size constant regardless of canvas zoom
const handleVisualSize = computed(() => {
  const s = props.canvasScale > 0 ? props.canvasScale : 1;
  return 10 / s; // 10px on screen
});
</script>

<template>
  <div
    :style="style"
    class="absolute select-none transition-opacity"
    :class="[
      { 'cursor-move': editMode && !isSectionMappingTarget },
      { 'cursor-pointer': isSectionMappingTarget },
      (isDimmedByIsolation || isDimmedBySectionIsolation) ? 'opacity-40' : 'opacity-100',
    ]"
    @mousedown="onMouseDown"
    @dblclick="onDoubleClick"
  >
    <!-- Edit-mode selection ring -->
    <div
      v-if="editMode"
      class="absolute inset-0 rounded pointer-events-none z-10 transition-colors"
      :class="[
        isSectionMappingTarget
          ? 'ring-1 ring-white/20'
          : (isSelected
              ? (isGrouped ? 'ring-2 ring-amber-400' : 'ring-2 ring-primary')
              : (isInIsolatedGroup ? 'ring-1 ring-amber-400/70'
                : (isGrouped ? 'ring-1 ring-amber-400/40' : 'ring-1 ring-white/10'))),
      ]"
    />
    <!-- Mapping-mode fill: solid yellow for section members -->
    <div
      v-if="editMode && isSectionMappingTarget && isSectionMember"
      class="absolute inset-0 pointer-events-none z-[5] rounded"
      style="background-color: rgba(250, 204, 21, 0.7);"
    />
    <!-- Dashed yellow highlight for section members -->
    <div
      v-if="editMode && isSectionHighlighted"
      class="absolute pointer-events-none z-20 rounded"
      style="inset: -2px; border: 1.5px dashed rgba(250, 204, 21, 0.85);"
    />

    <LiveButtonWidget v-if="widget.type === 'button'" :widget="widget" :page-id="pageId" :edit-mode="editMode" />
    <LiveSliderWidget v-else-if="widget.type === 'slider'" :widget="widget" :page-id="pageId" :edit-mode="editMode" />
    <LiveXYPadWidget v-else-if="widget.type === 'xy-pad'" :widget="widget" :page-id="pageId" :edit-mode="editMode" />
    <LiveLabelWidget v-else-if="widget.type === 'label'" :widget="widget" :edit-mode="editMode" />
    <LiveControllerTwinWidget v-else-if="widget.type === 'controller-twin'" :widget="widget" :page-id="pageId" :edit-mode="editMode" />
    <div v-else class="w-full h-full flex items-center justify-center text-xs text-muted-foreground border border-dashed border-white/20 rounded">
      {{ widget.type }}
    </div>

    <!-- Resize handles: edit mode + single-widget selection only -->
    <template v-if="editMode && showResizeHandles">
      <!-- Corners -->
      <div
        class="absolute z-20 bg-primary border border-white rounded-sm"
        :style="{
          width: `${handleVisualSize}px`,
          height: `${handleVisualSize}px`,
          left: `${-handleVisualSize / 2}px`,
          top: `${-handleVisualSize / 2}px`,
          cursor: 'nwse-resize',
        }"
        @mousedown="onResizeMouseDown($event, 'nw')"
      />
      <div
        class="absolute z-20 bg-primary border border-white rounded-sm"
        :style="{
          width: `${handleVisualSize}px`,
          height: `${handleVisualSize}px`,
          right: `${-handleVisualSize / 2}px`,
          top: `${-handleVisualSize / 2}px`,
          cursor: 'nesw-resize',
        }"
        @mousedown="onResizeMouseDown($event, 'ne')"
      />
      <div
        class="absolute z-20 bg-primary border border-white rounded-sm"
        :style="{
          width: `${handleVisualSize}px`,
          height: `${handleVisualSize}px`,
          left: `${-handleVisualSize / 2}px`,
          bottom: `${-handleVisualSize / 2}px`,
          cursor: 'nesw-resize',
        }"
        @mousedown="onResizeMouseDown($event, 'sw')"
      />
      <div
        class="absolute z-20 bg-primary border border-white rounded-sm"
        :style="{
          width: `${handleVisualSize}px`,
          height: `${handleVisualSize}px`,
          right: `${-handleVisualSize / 2}px`,
          bottom: `${-handleVisualSize / 2}px`,
          cursor: 'nwse-resize',
        }"
        @mousedown="onResizeMouseDown($event, 'se')"
      />

      <!-- Edges -->
      <div
        class="absolute z-20"
        :style="{
          left: `${handleVisualSize / 2}px`,
          right: `${handleVisualSize / 2}px`,
          top: `${-handleVisualSize / 2}px`,
          height: `${handleVisualSize}px`,
          cursor: 'ns-resize',
        }"
        @mousedown="onResizeMouseDown($event, 'n')"
      />
      <div
        class="absolute z-20"
        :style="{
          left: `${handleVisualSize / 2}px`,
          right: `${handleVisualSize / 2}px`,
          bottom: `${-handleVisualSize / 2}px`,
          height: `${handleVisualSize}px`,
          cursor: 'ns-resize',
        }"
        @mousedown="onResizeMouseDown($event, 's')"
      />
      <div
        class="absolute z-20"
        :style="{
          top: `${handleVisualSize / 2}px`,
          bottom: `${handleVisualSize / 2}px`,
          left: `${-handleVisualSize / 2}px`,
          width: `${handleVisualSize}px`,
          cursor: 'ew-resize',
        }"
        @mousedown="onResizeMouseDown($event, 'w')"
      />
      <div
        class="absolute z-20"
        :style="{
          top: `${handleVisualSize / 2}px`,
          bottom: `${handleVisualSize / 2}px`,
          right: `${-handleVisualSize / 2}px`,
          width: `${handleVisualSize}px`,
          cursor: 'ew-resize',
        }"
        @mousedown="onResizeMouseDown($event, 'e')"
      />
    </template>
  </div>
</template>
