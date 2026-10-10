<script setup lang="ts">
/**
 * Modifier stack of the selected fixtures (ADR §6.3). Each card shows one
 * content-plugin instance: the plugin selector (compatible plugins only),
 * target channels, the plugin's params (`ParamForm`, rendered from the
 * manifest schema) and the host-owned generic fields.
 */
import { computed, ref } from 'vue';
import { Plus, ChevronDown, Star, Code2, Library } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import type { ChannelType, ModifierInstance } from '~/utils/engine/types';
import type { PinnedModifier } from '~/stores/pinned-modifiers-store';
import { listPlugins, retryResolve } from '~/utils/plugins/plugin-store';
import { useEngineStore } from '~/stores/engine-store';
import ModifierCard from './modifier-card/ModifierCard.vue';
import NewModifierDialog from '~/components/plugin-host/NewModifierDialog.vue';
import PluginLibraryDialog from '~/components/plugin-host/PluginLibraryDialog.vue';
import RecipeThumb from '~/components/plugin-host/RecipeThumb.vue';
import PmPanel from '~/components/primitives/PmPanel.vue';
import PmListItem from '~/components/primitives/PmListItem.vue';
import PmMenuGroup from '~/components/primitives/PmMenuGroup.vue';
import ScopeProvider from '~/components/extension-host/ScopeProvider.vue';
import { modifierView } from '~/utils/extensions/scope-views';

defineProps<{
  activeModifiers: ModifierInstance[];
  activeModifier: ModifierInstance | null | undefined;
  availableChannelTypes: ChannelType[];
  pinnedModifiers: PinnedModifier[];
  pinnedEffectIds: Set<string>;
  /** Main axis of the edited fixtures (default distribution handle). */
  selectionAxis?: { a: { x: number; y: number }; b: { x: number; y: number } };
}>();

const emit = defineEmits<{
  (e: 'select-modifier', effect: ModifierInstance | null): void;
  (e: 'remove-modifier', effect: ModifierInstance): void;
  (e: 'toggle-target-channel', effect: ModifierInstance, type: ChannelType): void;
  (e: 'update-modifier', effect: ModifierInstance, key: string, value: any): void;
  (e: 'update-modifier-properties', effect: ModifierInstance, updates: Partial<ModifierInstance>, description: string, continuous?: boolean): void;
  (e: 'handle-modifier-drag-end', description: string): void;
  /** Adds an instance of the plugin with this content hash. */
  (e: 'add-modifier', plugin: string): void;
  (e: 'add-pinned-modifier', snapshot: ModifierInstance): void;
  (e: 'pin-modifier', effect: ModifierInstance): void;
  /** Replaces the instance's plugin (same signature) keeping generic fields. */
  (e: 'switch-modifier-type', effect: ModifierInstance, plugin: string): void;
  (e: 'dropdown-open-change', open: boolean): void;
  (e: 'reorder-modifiers', fromIndex: number, toIndex: number): void;
}>();

// ── Extension scope ──────────────────────────────────────────────────────────

/** Projects a modifier card's instance into the `modifier` scope view. */
function modifierScope(modifier: ModifierInstance) {
  return modifierView(modifier);
}

// ── Plugins ──────────────────────────────────────────────────────────────────

/** Modifier plugins the user can add. */
const modifierPlugins = computed(() => listPlugins().filter(p => p.manifest.kind === 'modifier'));

const engineStore = useEngineStore();

/** Retries resolving a plugin that failed; re-encodes the stack on success. */
async function retry(hash: string) {
  if (await retryResolve(hash)) engineStore.flushEngineOutput();
}

/** "New from code" and plugin library dialogs. */
const newFromCodeOpen = ref(false);
const libraryOpen = ref(false);

// ── Drag-to-reorder ───────────────────────────────────────────────────────────
const dragFromIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

/** Starts a reorder drag from a card header. */
function onDragHandleMousedown(e: MouseEvent, index: number) {
  e.preventDefault();
  e.stopPropagation();
  dragFromIndex.value = index;
  dragOverIndex.value = index;

  const onMousemove = (me: MouseEvent) => {
    const cards = document.querySelectorAll('[data-modifier-card]');
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i]!.getBoundingClientRect();
      if (me.clientY >= rect.top && me.clientY <= rect.bottom) {
        dragOverIndex.value = i;
        break;
      }
    }
  };

  const onMouseup = () => {
    window.removeEventListener('mousemove', onMousemove);
    window.removeEventListener('mouseup', onMouseup);
    if (dragFromIndex.value !== null && dragOverIndex.value !== null && dragFromIndex.value !== dragOverIndex.value) {
      emit('reorder-modifiers', dragFromIndex.value, dragOverIndex.value);
    }
    dragFromIndex.value = null;
    dragOverIndex.value = null;
  };

  window.addEventListener('mousemove', onMousemove);
  window.addEventListener('mouseup', onMouseup);
}
</script>

<template>
  <PmPanel id="modifiers" class="space-y-4">
    <div v-if="activeModifiers.length === 0" class="py-10 px-4 text-center flex flex-col items-center gap-2">
      <span class="text-sm text-foreground font-semibold">No Modifiers</span>
      <span class="text-xs text-muted-foreground leading-relaxed max-w-[220px]">
        Modifiers allow you to apply dynamic waveforms to override or enhance underlying step values.
      </span>
    </div>

    <ScopeProvider
      v-for="(modifier, i) in activeModifiers"
      :key="modifier.id"
      name="modifier"
      :get="() => modifierScope(modifier)"
    >
    <PmListItem
      id="modifier"
      :manual="['badges', 'actions']"
      v-slot="{ Badges, Actions }"
      data-modifier-card
      class="border rounded-lg bg-card shadow-sm overflow-hidden flex flex-col transition-colors"
      :class="[
        activeModifier === modifier ? 'border-primary ring-1 ring-primary' : 'border-border/60 hover:border-primary/50',
        dragFromIndex !== null && dragOverIndex === i && dragFromIndex !== i ? 'ring-2 ring-primary/60' : '',
        dragFromIndex === i ? 'cursor-grabbing' : '',
      ]"
      @pointerdown.capture="activeModifier !== modifier && emit('select-modifier', modifier)"
      @click.stop
    >
      <ModifierCard
          :modifier="modifier"
          :available-channel-types="availableChannelTypes"
          :pinned="pinnedEffectIds.has(modifier.id)"
          :selection-axis="selectionAxis"
          :badges="Badges"
          :actions="Actions"
          @drag-start="e => onDragHandleMousedown(e, i)"
          @patch="(u, d, c) => emit('update-modifier-properties', modifier, u, d, c)"
          @update="(k, v) => emit('update-modifier', modifier, k, v)"
          @drag-end="d => emit('handle-modifier-drag-end', d)"
          @toggle-channel="t => emit('toggle-target-channel', modifier, t)"
          @switch="p => emit('switch-modifier-type', modifier, p)"
          @pin="emit('pin-modifier', modifier)"
          @remove="emit('remove-modifier', modifier)"
          @retry="retry(modifier.plugin)"
          @dropdown-open-change="v => emit('dropdown-open-change', v)"
        />
    </PmListItem>
    </ScopeProvider>

    <!-- Add Modifier dropdown -->
    <div class="flex justify-center pt-2">
      <DropdownMenu @update:open="v => emit('dropdown-open-change', v)">
        <DropdownMenuTrigger as-child>
          <Button
            variant="outline"
            class="hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-all gap-2"
          >
            <Plus class="h-4 w-4" /> Add Modifier <ChevronDown class="h-3 w-3 ml-1 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <!-- Extension slot: modifiers/add:items -->
          <PmMenuGroup id="add" as="fragment">
            <template #item="{ item, run, disabled }">
              <DropdownMenuItem :disabled="disabled" @click="run">{{ item.label }}</DropdownMenuItem>
            </template>
            <DropdownMenuItem v-for="p in modifierPlugins" :key="p.hash" class="gap-2 max-w-[280px]" :data-add="p.manifest.alias" @click="emit('add-modifier', p.hash)">
              <RecipeThumb :plugin="p.hash" />
              <span class="flex flex-col min-w-0">
                <span class="truncate">{{ p.manifest.name }}</span>
                <span v-if="p.manifest.purpose" class="truncate text-[10px] text-muted-foreground">{{ p.manifest.purpose }}</span>
              </span>
            </DropdownMenuItem>
          </PmMenuGroup>
          <DropdownMenuItem class="gap-2" @click="libraryOpen = true">
            <Library class="h-4 w-4" /> Browse & import…
          </DropdownMenuItem>
          <DropdownMenuItem class="gap-2" @click="newFromCodeOpen = true">
            <Code2 class="h-4 w-4" /> New from code…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger class="gap-2">
              <Star class="h-4 w-4" /> Pinned
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem v-if="pinnedModifiers.length === 0" disabled class="text-muted-foreground">No pinned modifiers</DropdownMenuItem>
              <DropdownMenuItem v-for="p in pinnedModifiers" :key="p.id" @click="emit('add-pinned-modifier', p.snapshot)">
                {{ p.name }}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <NewModifierDialog v-model:open="newFromCodeOpen" @add="hash => emit('add-modifier', hash)" />
    <PluginLibraryDialog v-if="libraryOpen" v-model:open="libraryOpen" @add="hash => emit('add-modifier', hash)" />
  </PmPanel>
</template>
