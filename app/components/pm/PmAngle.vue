<script setup lang="ts">
/**
 * Core default of `pm.angle` (ADR §5.4): a dial for an angle in radians.
 * Drag around the center to set the direction; 0 = right (+X), π/2 = down.
 */
import { computed } from 'vue';
import type { AngleEmits, AngleProps } from '@pixelmapper/extension-api';
import { usePointerScrub } from './use-pointer-scrub';

const props = withDefaults(defineProps<AngleProps>(), { disabled: false, size: 'md' });
const emit = defineEmits<AngleEmits>();

/** Angle from the element center to the pointer, normalized to [0, 2π). */
function angleAt(e: PointerEvent, el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  const a = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  return (a + Math.PI * 2) % (Math.PI * 2);
}

const scrub = usePointerScrub({
  onStart: (e, el) => { emit('scrubStart'); emit('update:modelValue', angleAt(e, el)); },
  onMove: (e, el) => emit('update:modelValue', angleAt(e, el)),
  onEnd: () => emit('scrubEnd'),
}, () => props.disabled);

const degrees = computed(() => Math.round((props.modelValue * 180) / Math.PI));
const px = computed(() => ({ sm: 28, md: 40, lg: 56 })[props.size]);
</script>

<template>
  <div class="inline-flex items-center gap-2" :class="disabled && 'opacity-50 pointer-events-none'">
    <div
      class="relative rounded-full border border-border bg-muted/30 cursor-grab touch-none"
      :style="{ width: `${px}px`, height: `${px}px` }"
      role="slider"
      :aria-label="label ?? 'Angle'"
      :aria-valuenow="degrees"
      aria-valuemin="0"
      aria-valuemax="360"
      v-bind="scrub.bind"
    >
      <span
        class="absolute left-1/2 top-1/2 h-px origin-left bg-primary"
        :style="{ width: `${px / 2 - 3}px`, transform: `rotate(${modelValue}rad)` }"
      />
      <span class="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" />
    </div>
    <span class="text-xs font-mono text-muted-foreground">{{ label ? `${label} ` : '' }}{{ degrees }}°</span>
  </div>
</template>
