<script setup lang="ts">
import { computed } from 'vue';
import type { LiveWidget } from '~/utils/live/types';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useHistory } from '~/components/engine/composables/use-history';
import { MoveResizeLiveWidgetCommand } from '~/components/engine/commands/live-widget-commands';
import LiveButtonWidget from './LiveButtonWidget.vue';
import LiveSliderWidget from './LiveSliderWidget.vue';
import LiveXYPadWidget from './LiveXYPadWidget.vue';
import LiveLabelWidget from './LiveLabelWidget.vue';

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

// Position/size from grid coordinates
const style = computed(() => ({
  position: 'absolute' as const,
  left: `${props.widget.gridX * props.gridSize}px`,
  top: `${props.widget.gridY * props.gridSize}px`,
  width: `${props.widget.gridW * props.gridSize}px`,
  height: `${props.widget.gridH * props.gridSize}px`,
}));

// ── Drag (move) ──────────────────────────────────────────────────────────────

function onMouseDown(e: MouseEvent) {
  if (!props.editMode) return;
  if (e.button !== 0) return;
  e.stopPropagation();
  store.selectedWidgetIds = new Set([props.widget.id]);

  const startClientX = e.clientX;
  const startClientY = e.clientY;
  const originGridX = props.widget.gridX;
  const originGridY = props.widget.gridY;

  // Convert screen-pixel delta → grid-cell delta. Divide by canvasScale
  // because the widget lives inside a `transform: scale(s)` canvas.
  const pxPerCell = props.gridSize * props.canvasScale;

  const onMove = (mv: MouseEvent) => {
    const dx = Math.round((mv.clientX - startClientX) / pxPerCell);
    const dy = Math.round((mv.clientY - startClientY) / pxPerCell);
    const newX = Math.max(0, originGridX + dx);
    const newY = Math.max(0, originGridY + dy);
    store.moveResizeWidget(props.pageId, props.widget.id, newX, newY, props.widget.gridW, props.widget.gridH);
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (props.widget.gridX !== originGridX || props.widget.gridY !== originGridY) {
      history.execute(new MoveResizeLiveWidgetCommand(
        props.pageId, props.widget.id,
        props.widget.gridX, props.widget.gridY,
        props.widget.gridW, props.widget.gridH,
      ));
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
    class="absolute select-none"
    :class="{ 'cursor-move': editMode }"
    @mousedown="onMouseDown"
  >
    <!-- Edit-mode selection ring -->
    <div
      v-if="editMode"
      class="absolute inset-0 rounded pointer-events-none z-10 transition-colors"
      :class="isSelected ? 'ring-2 ring-primary ring-offset-0' : 'ring-1 ring-white/10'"
    />

    <LiveButtonWidget v-if="widget.type === 'button'" :widget="widget" :page-id="pageId" :edit-mode="editMode" />
    <LiveSliderWidget v-else-if="widget.type === 'slider'" :widget="widget" :page-id="pageId" :edit-mode="editMode" />
    <LiveXYPadWidget v-else-if="widget.type === 'xy-pad'" :widget="widget" :page-id="pageId" :edit-mode="editMode" />
    <LiveLabelWidget v-else-if="widget.type === 'label'" :widget="widget" :edit-mode="editMode" />
    <div v-else class="w-full h-full flex items-center justify-center text-xs text-muted-foreground border border-dashed border-white/20 rounded">
      {{ widget.type }}
    </div>

    <!-- Resize handles (edit mode + selected) -->
    <template v-if="editMode && isSelected">
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
