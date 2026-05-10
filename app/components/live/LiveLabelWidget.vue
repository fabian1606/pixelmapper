<script setup lang="ts">
import type { LiveWidget } from '~/utils/live/types';

defineProps<{
  widget: LiveWidget;
  editMode: boolean;
}>();
</script>

<template>
  <div
    class="w-full h-full flex items-center px-2 text-sm font-medium text-white/60 truncate border-b border-white/10"
    :style="{ color: widget.color ?? undefined }"
  >
    {{ widget.label || 'Label' }}
  </div>
</template>
