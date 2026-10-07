<script setup lang="ts">
/**
 * Modifier stack of the selected fixtures (ADR §6.3). Each card shows one
 * content-plugin instance: the plugin selector (compatible plugins only),
 * target channels, the plugin's params (`ParamForm`, rendered from the
 * manifest schema) and the host-owned generic fields.
 */
import { computed, ref } from 'vue';
import { Plus, Trash2, ChevronDown, Star, Code2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import type { ChannelType, ModifierInstance } from '~/utils/engine/types';
import type { PinnedModifier } from '~/stores/pinned-modifiers-store';
import { getManifest, listPlugins } from '~/utils/plugins/plugin-store';
import ModifierGenericFields from './ModifierGenericFields.vue';
import ParamForm from '~/components/plugin-host/ParamForm.vue';
import ModifierPreview from '~/components/plugin-host/ModifierPreview.vue';
import NewModifierDialog from '~/components/plugin-host/NewModifierDialog.vue';
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
}>();

const emit = defineEmits<{
  (e: 'select-modifier', effect: ModifierInstance | null): void;
  (e: 'remove-modifier', effect: ModifierInstance): void;
  (e: 'toggle-target-channel', effect: ModifierInstance, type: ChannelType): void;
  (e: 'update-modifier', effect: ModifierInstance, key: string, value: any): void;
  (e: 'update-modifier-properties', effect: ModifierInstance, updates: Partial<ModifierInstance>, description: string): void;
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

/** Plugins a card can switch to: those supporting its signature. */
function compatiblePlugins(modifier: ModifierInstance) {
  return modifierPlugins.value.filter(p => p.hash === modifier.plugin || p.manifest.signatures.includes(modifier.signature));
}

/** Display name of a plugin hash (falls back to a short hash). */
function pluginName(hash: string): string {
  return getManifest(hash)?.name ?? `Unknown (${hash.slice(7, 15)})`;
}

/** The params schema of an instance (empty when the plugin is unknown). */
function paramSchema(modifier: ModifierInstance) {
  return getManifest(modifier.plugin)?.params ?? [];
}

/** "New from code" dialog. */
const newFromCodeOpen = ref(false);

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
      class="border rounded-lg bg-card shadow-sm overflow-hidden flex flex-col cursor-pointer transition-colors"
      :class="[
        activeModifier === modifier ? 'border-primary ring-1 ring-primary' : 'border-border/60 hover:border-primary/50',
        dragFromIndex !== null && dragOverIndex === i && dragFromIndex !== i ? 'ring-2 ring-primary/60' : '',
      ]"
      @click="emit('select-modifier', modifier)"
    >
      <!-- Modifier Header -->
      <div
        class="flex items-center justify-between p-3 border-b border-border/60 bg-muted/20"
        :class="dragFromIndex === i ? 'cursor-grabbing' : 'cursor-grab'"
        @mousedown="onDragHandleMousedown($event, i)"
      >
        <Select
          :model-value="modifier.plugin"
          @update:model-value="(v: any) => { if (v && v !== modifier.plugin) emit('switch-modifier-type', modifier, String(v)); }"
        >
          <SelectTrigger class="w-[150px] h-8 text-xs font-medium border-0 shadow-none focus:ring-0 px-2 bg-transparent hover:bg-muted/50 transition-colors" @click.stop>
            <SelectValue placeholder="Select Modifier">{{ pluginName(modifier.plugin) }}</SelectValue>
          </SelectTrigger>
          <SelectContent @pointerdown.stop>
            <SelectItem v-for="p in compatiblePlugins(modifier)" :key="p.hash" :value="p.hash" class="text-xs">
              {{ p.manifest.name }}
            </SelectItem>
          </SelectContent>
        </Select>
        <!-- Extension slots: modifiers/modifier:badges|actions -->
        <div class="ml-auto flex items-center gap-1 empty:hidden" @mousedown.stop><component :is="Badges" /><component :is="Actions" /></div>
        <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-yellow-400" @click.stop="emit('pin-modifier', modifier)">
          <Star class="h-4 w-4" :class="pinnedEffectIds.has(modifier.id) ? 'fill-yellow-400 text-yellow-400' : ''" />
        </Button>
        <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" @click.stop="emit('remove-modifier', modifier)">
          <Trash2 class="h-4 w-4" />
        </Button>
      </div>

      <div class="p-3 space-y-4" @click.stop>
        <!-- One-cycle preview (main-thread preview pool) -->
        <ModifierPreview :modifier="modifier" />

        <!-- Target Channels -->
        <div class="space-y-2">
          <Label class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Target Channels</Label>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="type in availableChannelTypes"
              :key="type"
              @click.stop="emit('toggle-target-channel', modifier, type)"
              class="px-2.5 py-1 text-[11px] font-medium rounded-md border transition-all"
              :class="[
                modifier.targetChannels.includes(type)
                  ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20'
                  : 'bg-transparent text-muted-foreground border-border hover:border-muted-foreground/50 hover:bg-muted/30',
                (modifier.targetChannels.includes(type) && modifier.targetChannels.length <= 1) ? 'opacity-50 cursor-not-allowed' : ''
              ]"
              :disabled="modifier.targetChannels.includes(type) && modifier.targetChannels.length <= 1"
            >
              {{ type }}
            </button>
          </div>
        </div>

        <!-- Plugin params (schema-driven) -->
        <div v-if="paramSchema(modifier).length" class="pt-3 border-t border-border/40">
          <ParamForm
            :schema="paramSchema(modifier)"
            :model-value="modifier.params"
            @update:model-value="v => emit('update-modifier', modifier, 'params', v)"
            @scrub-end="emit('handle-modifier-drag-end', 'Update Modifier Params')"
          />
        </div>

        <!-- Host-owned fields -->
        <div class="pt-3 border-t border-border/40">
          <ModifierGenericFields
            :modifier="modifier"
            @update="(k, v) => emit('update-modifier', modifier, k, v)"
            @update-properties="(u, d) => emit('update-modifier-properties', modifier, u, d)"
            @drag-end="d => emit('handle-modifier-drag-end', d)"
            @dropdown-open-change="v => emit('dropdown-open-change', v)"
          />
        </div>
      </div>
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
            <DropdownMenuItem v-for="p in modifierPlugins" :key="p.hash" @click="emit('add-modifier', p.hash)">
              {{ p.manifest.name }}
            </DropdownMenuItem>
          </PmMenuGroup>
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
  </PmPanel>
</template>
