<script setup lang="ts">
/**
 * `pm.xyInput` replacement: a 2D pad (x = pan, left → right; y = tilt,
 * top → bottom), values normalized 0–1. A drag emits one
 * `scrubStart`…`scrubEnd` bracket. `bounds` (if given) is drawn as the
 * allowed area. `size: 'lg'` fills the container (live widgets).
 */
import { computed, ref } from 'vue';
import type { Vec2, XyInputEmits, XyInputProps } from '@pixelmapper/extension-api';

const props = withDefaults(defineProps<XyInputProps>(), { disabled: false, size: 'md' });
const emit = defineEmits<XyInputEmits>();

const padRef = ref<HTMLElement | null>(null);
/** Point under the pointer during a drag (local preview). */
const preview = ref<Vec2 | null>(null);
let dragging = false;

const padClass = computed(() => ({
  sm: 'w-32 h-32',
  md: 'w-48 h-48',
  lg: 'w-full h-full',
})[props.size]);

/** Pointer → normalized point, clamped to the pad. */
function pointAt(e: PointerEvent): Vec2 {
  const r = padRef.value!.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
    y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
  };
}

function onPointerDown(e: PointerEvent) {
  if (props.disabled || e.button !== 0 || !padRef.value) return;
  e.preventDefault();
  padRef.value.setPointerCapture?.(e.pointerId);
  dragging = true;
  emit('scrubStart');
  set(pointAt(e));
}

function onPointerMove(e: PointerEvent) {
  if (dragging) set(pointAt(e));
}

function onPointerUp() {
  if (!dragging) return;
  dragging = false;
  preview.value = null;
  emit('scrubEnd');
}

function set(p: Vec2) {
  preview.value = p;
  emit('update:modelValue', p);
}

const shown = computed(() => preview.value ?? props.modelValue);
const handleStyle = computed(() => ({ left: `${shown.value.x * 100}%`, top: `${shown.value.y * 100}%` }));
const boundsStyle = computed(() => {
  const b = props.bounds;
  if (!b) return null;
  return {
    left: `${b.min.x * 100}%`,
    top: `${b.min.y * 100}%`,
    width: `${(b.max.x - b.min.x) * 100}%`,
    height: `${(b.max.y - b.min.y) * 100}%`,
  };
});
</script>

<template>
  <div class="flex flex-col items-center gap-2 w-full h-full" :class="disabled && 'opacity-50 pointer-events-none'">
    <div v-if="label" class="self-start text-xs text-muted-foreground">{{ label }}</div>
    <div
      ref="padRef"
      class="relative rounded-xl bg-accent border border-border cursor-crosshair touch-none select-none shadow-inner shrink-0"
      :class="padClass"
      role="slider"
      :aria-label="label ?? axisLabels?.join(' / ') ?? 'XY'"
      :aria-valuetext="`${Math.round(shown.x * 100)}% / ${Math.round(shown.y * 100)}%`"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <!-- Grid lines for visual guidance -->
      <div class="absolute inset-0 pointer-events-none opacity-30">
        <div class="absolute top-1/2 left-0 right-0 h-px bg-foreground/20" />
        <div class="absolute left-1/2 top-0 bottom-0 w-px bg-foreground/20" />
        <div class="absolute top-1/4 left-0 right-0 h-px bg-foreground/5" />
        <div class="absolute top-3/4 left-0 right-0 h-px bg-foreground/5" />
        <div class="absolute left-1/4 top-0 bottom-0 w-px bg-foreground/5" />
        <div class="absolute left-3/4 top-0 bottom-0 w-px bg-foreground/5" />
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1/2 h-1/2 rounded-full border border-foreground/10" />
      </div>
      <!-- Allowed area -->
      <div v-if="boundsStyle" class="absolute border border-primary/40 bg-primary/5 pointer-events-none" :style="boundsStyle" />
      <!-- Handle -->
      <div
        class="absolute w-6 h-6 -ml-3 -mt-3 rounded-full border border-background shadow-md pointer-events-none bg-primary flex items-center justify-center"
        :style="handleStyle"
      >
        <div class="w-2 h-2 rounded-full bg-background/80" />
      </div>
      <div v-if="axisLabels" class="absolute bottom-1 inset-x-0 flex justify-between px-2 text-[9px] text-muted-foreground pointer-events-none">
        <span>{{ axisLabels[0] }}</span><span>{{ axisLabels[1] }}</span>
      </div>
    </div>
  </div>
</template>
