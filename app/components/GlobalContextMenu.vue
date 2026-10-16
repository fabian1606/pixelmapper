<script setup lang="ts">
import { useGlobalContextMenu, type ContextMenuItemOption } from '~/composables/useGlobalContextMenu';
import { onMounted, onUnmounted } from 'vue';
import { Separator } from '@/components/ui/separator';
import type { ScopeName } from '@pixelmapper/extension-api';
import PmPanel from '~/components/primitives/PmPanel.vue';
import PmMenuGroup from '~/components/primitives/PmMenuGroup.vue';
import { provideScope } from '~/composables/extensions/provide-scope';

const { isOpen, position, options, extensionContext, closeMenu } = useGlobalContextMenu();

// Re-provide the opener's (non-global) scopes so contributed menu items see
// the fixture/channel/modifier the menu was opened on.
const OPENER_SCOPES: ScopeName[] = ['fixture', 'channel', 'signature', 'modifier', 'preset', 'liveWidget', 'livePage'];
for (const name of OPENER_SCOPES) {
  provideScope(name, () => extensionContext.value?.scopes?.[name] as never);
}

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
      data-overlay-root
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
        <!-- Extension slots: context-menu/<id>:items -->
        <PmPanel v-if="extensionContext" id="context-menu" as="div" :manual="['header', 'before', 'after']">
          <PmMenuGroup :id="extensionContext.id" as="fragment">
            <template #item="{ item: ext, run, disabled }">
              <button
                :disabled="disabled"
                class="relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors w-full text-left hover:bg-accent hover:text-accent-foreground focus:bg-accent disabled:opacity-50"
                @click="closeMenu(); run()"
              >
                <span class="flex-1">{{ ext.label }}</span>
                <span v-if="ext.shortcut" class="ml-auto text-xs tracking-widest text-muted-foreground">{{ ext.shortcut }}</span>
              </button>
            </template>
          </PmMenuGroup>
        </PmPanel>
      </div>
    </div>
  </Teleport>
</template>
