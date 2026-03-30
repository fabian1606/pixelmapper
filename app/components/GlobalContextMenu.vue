<script setup lang="ts">
import { useGlobalContextMenu, type ContextMenuItemOption } from '~/composables/useGlobalContextMenu';
import { onMounted, onUnmounted } from 'vue';
import { Separator } from '@/components/ui/separator';

const { isOpen, position, options, closeMenu } = useGlobalContextMenu();

/**
 * Close menu when clicking outside or pressing Escape.
 */
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeMenu();
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

function handleAction(action?: () => void) {
  closeMenu();
  // Run action after menu closes to avoid event conflicts
  if (action) setTimeout(action, 0);
}
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop: clicking outside closes the menu -->
    <div
      v-if="isOpen"
      class="fixed inset-0 z-[200]"
      @mousedown.self="closeMenu"
      @contextmenu.prevent
    >
      <!-- Menu panel anchored at cursor position -->
      <div
        class="absolute z-[201] min-w-[12rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        :style="{
          left: `${position.x}px`,
          top: `${position.y}px`,
        }"
        @mousedown.stop
        @contextmenu.prevent.stop
      >
        <template v-for="(item, index) in options" :key="index">
          <!-- Separator -->
          <div v-if="item.isSeparator" class="my-1 -mx-1 h-px bg-border" />

          <!-- Normal item -->
          <button
            v-else
            :disabled="item.disabled"
            class="relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors w-full text-left"
            :class="[
              item.disabled
                ? 'opacity-50 pointer-events-none'
                : item.variant === 'destructive'
                  ? 'text-destructive hover:bg-destructive hover:text-destructive-foreground focus:bg-destructive focus:text-destructive-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground focus:bg-accent',
            ]"
            @click="handleAction(item.action)"
          >
            <component :is="item.icon" v-if="item.icon" class="size-4 shrink-0" />
            <span class="flex-1">{{ item.label }}</span>
            <span v-if="item.shortcut" class="ml-auto text-xs tracking-widest text-muted-foreground">
              {{ item.shortcut }}
            </span>
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>
