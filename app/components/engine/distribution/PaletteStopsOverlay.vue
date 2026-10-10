<script setup lang="ts">
/**
 * Palette stops on the canvas (plan M7.6): the active modifier's first
 * gradient param (when visible) is drawn on the Spatial 2D handle line,
 * stop `pos` 0 at the origin and 1 at the end. Dragging a stop along the
 * line moves it (one undo step per drag); a click opens its color in a
 * popover (`pm.colorInput`, replaceable).
 */
import { computed, ref } from 'vue';
import type { GradientValue, RgbColor } from '@pixelmapper/extension-api';
import type { ModifierInstance } from '~/utils/engine/types';
import { getManifest } from '~/utils/plugins/plugin-store';
import { matchWhen } from '~/components/plugin-host/param-form-layout';
import Replaceable from '~/components/extension-host/Replaceable.vue';

const props = defineProps<{
  modifier: ModifierInstance;
  worldWidth: number;
  worldHeight: number;
  worldToViewport: (wx: number, wy: number) => { x: number; y: number };
  /** Viewport element (pointer mapping). */
  viewportEl: HTMLElement | null;
  camera: { x: number; y: number; scale: number };
}>();

const emit = defineEmits<{
  /** Live params change. */
  change: [params: ModifierInstance['params']];
  /** Commit the change as one undo step. */
  commit: [description: string];
}>();

const editing = ref<number | null>(null);

/** The visible gradient param of the modifier, if any. */
const param = computed(() => {
  const manifest = getManifest(props.modifier.plugin);
  if (!manifest) return null;
  return manifest.params.find(p => p.type === 'gradient'
    && (p.tier ?? 'primary') !== 'hidden'
    && matchWhen(p.when, manifest.params, { params: props.modifier.params, distributionMode: props.modifier.distribution.mode })) ?? null;
});
const value = computed(() => (param.value ? (props.modifier.params[param.value.key] ?? param.value.default) as GradientValue : null));

const css = (c: RgbColor) => `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;

/** Viewport positions of the stops along origin → end. */
const stops = computed(() => {
  void props.camera.scale; void props.camera.x; void props.camera.y;
  const d = props.modifier.distribution;
  return (value.value?.stops ?? []).map((s, i) => {
    const x = d.origin.x + (d.end.x - d.origin.x) * s.pos;
    const y = d.origin.y + (d.end.y - d.origin.y) * s.pos;
    return { i, color: css(s.color), ...props.worldToViewport(x * props.worldWidth, y * props.worldHeight) };
  });
});

/** Stops of the last emitted change (the prop may lag behind during a drag). */
let lastStops: GradientValue['stops'] | null = null;

/** Emits the gradient with stop `i` patched. */
function patch(i: number, change: Partial<GradientValue['stops'][number]>) {
  if (!param.value || !value.value) return;
  const stopsNext = (lastStops ?? value.value.stops).map((s, k) => (k === i ? { ...s, ...change } : s));
  lastStops = stopsNext;
  emit('change', { ...props.modifier.params, [param.value.key]: { stops: stopsNext } });
}

/** Sets the color of the stop being edited. */
function setStopColor(c: RgbColor) {
  if (editing.value === null) return;
  lastStops = null;
  patch(editing.value, { color: c });
}

/** Drag along the line; a press without movement opens the color. */
function onDown(e: MouseEvent, i: number) {
  e.preventDefault();
  e.stopPropagation();
  const x0 = e.clientX;
  const y0 = e.clientY;
  let moved = false;
  lastStops = null;
  const move = (me: MouseEvent) => {
    if (!moved && Math.hypot(me.clientX - x0, me.clientY - y0) < 3) return;
    moved = true;
    const r = props.viewportEl?.getBoundingClientRect();
    if (!r) return;
    const wx = (me.clientX - r.left - props.camera.x) / props.camera.scale / props.worldWidth;
    const wy = (me.clientY - r.top - props.camera.y) / props.camera.scale / props.worldHeight;
    const d = props.modifier.distribution;
    const dx = d.end.x - d.origin.x;
    const dy = d.end.y - d.origin.y;
    const t = ((wx - d.origin.x) * dx + (wy - d.origin.y) * dy) / Math.max(1e-9, dx * dx + dy * dy);
    patch(i, { pos: Math.round(Math.max(0, Math.min(1, t)) * 1000) / 1000 });
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    if (moved) {
      // Keep stops sorted after a drag.
      if (param.value && lastStops) emit('change', { ...props.modifier.params, [param.value.key]: { stops: [...lastStops].sort((a, b) => a.pos - b.pos) } });
      lastStops = null;
      emit('commit', 'Move Palette Stop');
    }
    else editing.value = i;
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}
</script>

<template>
  <template v-if="param && value">
    <button
      v-for="s in stops" :key="s.i" type="button"
      class="absolute z-20 w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-white shadow cursor-grab"
      :style="{ left: `${s.x}px`, top: `${s.y}px`, background: s.color }"
      :aria-label="`Palette stop ${s.i + 1}`"
      :data-palette-stop="s.i"
      @mousedown="e => onDown(e, s.i)"
    />
    <div
      v-if="editing !== null && stops[editing]"
      class="absolute z-30 w-56 rounded-md border bg-popover p-2 shadow-md"
      :style="{ left: `${stops[editing]!.x + 12}px`, top: `${stops[editing]!.y + 12}px` }"
      data-overlay-root
      @mousedown.stop
    >
      <Replaceable
        name="pm.colorInput" label="Stop color" :model-value="value.stops[editing]!.color"
        @update:model-value="setStopColor"
        @scrub-end="emit('commit', 'Change Palette Color')"
      />
      <button type="button" class="mt-2 text-[11px] text-muted-foreground hover:text-foreground" @click="editing = null; emit('commit', 'Change Palette Color')">Done</button>
    </div>
  </template>
</template>
