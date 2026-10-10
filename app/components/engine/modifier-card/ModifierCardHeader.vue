<script setup lang="ts">
/**
 * Header of a modifier card (plan M5.6): title "<plugin> · <recipe | Custom>",
 * extension badges/actions, plugin switch (menu), pin and delete. The header
 * is the drag handle for reordering (the parent handles `mousedown`).
 */
import { computed } from 'vue';
import { Repeat2, Star, Trash2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { Component } from 'vue';
import type { ModifierInstance } from '~/utils/engine/types';
import { getManifest, listPlugins } from '~/utils/plugins/plugin-store';
import { activePreset } from '~/utils/engine/recipes';
import { modifierName } from '~/utils/engine/modifiers';

const props = defineProps<{
  modifier: ModifierInstance;
  pinned: boolean;
  /** Extension slot outlets (modifiers/modifier:badges|actions). */
  badges: Component;
  actions: Component;
}>();

const emit = defineEmits<{
  switch: [plugin: string];
  pin: [];
  remove: [];
  'dropdown-open-change': [open: boolean];
}>();

const manifest = computed(() => getManifest(props.modifier.plugin));

/** "Wave · Chase" (recipe or Custom) for plugins with recipes, else the plain name. */
const title = computed(() => {
  const m = manifest.value;
  if (!m) return `Unknown (${props.modifier.plugin.slice(7, 15)})`;
  if (!m.presets?.length) return modifierName(props.modifier);
  return `${m.name} · ${activePreset(props.modifier, m)?.label ?? 'Custom'}`;
});

/** Plugins this card can switch to (same signature). */
const compatible = computed(() => listPlugins().filter(p => p.manifest.kind === 'modifier' && p.hash !== props.modifier.plugin && p.manifest.signatures.includes(props.modifier.signature)));
</script>

<template>
  <div class="flex items-center gap-1 px-3 py-2 border-b border-border/60 bg-muted/20 min-w-0 cursor-grab active:cursor-grabbing">
    <span class="flex-1 min-w-0 truncate text-xs font-medium" :title="title" data-card-title>{{ title }}</span>
    <div class="flex items-center gap-1 empty:hidden" @mousedown.stop><component :is="badges" /><component :is="actions" /></div>
    <DropdownMenu @update:open="v => emit('dropdown-open-change', v)">
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="icon" class="h-7 w-7 text-muted-foreground" title="Switch modifier" @mousedown.stop @click.stop>
          <Repeat2 class="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" @pointerdown.stop>
        <DropdownMenuLabel class="text-[10px] text-muted-foreground">Switch to</DropdownMenuLabel>
        <DropdownMenuItem v-if="!compatible.length" disabled class="text-xs">No other modifiers</DropdownMenuItem>
        <DropdownMenuItem v-for="p in compatible" :key="p.hash" class="text-xs" @click="emit('switch', p.hash)">{{ p.manifest.name }}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Button variant="ghost" size="icon" class="h-7 w-7 text-muted-foreground hover:text-yellow-400" title="Pin" @mousedown.stop @click.stop="emit('pin')">
      <Star class="h-4 w-4" :class="pinned ? 'fill-yellow-400 text-yellow-400' : ''" />
    </Button>
    <Button variant="ghost" size="icon" class="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10" title="Delete" @mousedown.stop @click.stop="emit('remove')">
      <Trash2 class="h-4 w-4" />
    </Button>
  </div>
</template>
