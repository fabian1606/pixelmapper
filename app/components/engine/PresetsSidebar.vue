<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Effect } from '~/utils/engine/types';
import { usePresets, extractCategories } from '~/components/engine/composables/use-presets';
import { resolvePreset } from '~/components/engine/composables/preset-resolve';
import { useHistory } from '~/components/engine/composables/use-history';
import type { SceneNode } from '~/utils/engine/core/group';
import { useShortcuts } from '~/components/engine/composables/use-shortcuts';
import { SavePresetCommand, DeletePresetCommand, OverwritePresetCommand } from '~/components/engine/commands/preset-commands';
import type { Preset, PresetCategory, PresetCategoryType } from '~/utils/engine/preset-types';
import { CHANNEL_CATEGORIES } from '~/utils/engine/channel-categories';
import {
  Settings,
  Save,
  X,
  Check,
  Trash2,
  Play,
  Square,
  GitFork,
  Zap,
  Activity,
  Layers,
} from 'lucide-vue-next';
import { useGlobalContextMenu, type ContextMenuItemOption } from '~/composables/useGlobalContextMenu';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { AccordionHeader } from 'reka-ui';
import { Input } from '@/components/ui/input';


// ─── Props & Emits ────────────────────────────────────────────────────────────

const props = defineProps<{
  fixtures: Fixture[];
  /** Live reactive effects array from EffectEngine.effects */
  effects: Effect[];
  nodes?: SceneNode[];
}>();

const emit = defineEmits<{
  /** Called when a preset subgroup is clicked — selects those fixture IDs */
  (e: 'selectFixtures', ids: (string | number)[]): void;
  /** Called when a category item is clicked — opens that tab in the properties panel */
  (e: 'openPropertiesTab', tab: string, isModifier?: boolean, effectId?: string): void;
}>();

// ─── Preset state ─────────────────────────────────────────────────────────────

const {
  savedPresets,
  selectedPresetId,
  getUnsavedChanges,
  applyPreset,
  renamePreset,
  stopPreset,
  getActivePresetResolved,
} = usePresets();

const history = useHistory();

// Shortcuts
useShortcuts([
  { key: 'P', shift: true, label: 'Save Preset', handler: () => quickSave() },
  { key: 'S', shift: true, label: 'Overwrite Preset', handler: () => overwriteActivePreset() }
]);

// ─── Unsaved changes (reactive, recomputed on fixture changes) ────────────────

// Remove the channelWriteVersion since we are relying on deep reactivity now.
const unsavedChanges = computed(() => {
  history.version.value;         // Re-evaluate on undo/redo
  return getUnsavedChanges(props.fixtures, props.effects, props.nodes);
});
const hasUnsaved = computed(() => unsavedChanges.value.length > 0);

const basePresets = computed(() => {
  return savedPresets.value.filter(p => !p.basePresetId);
});

function getVariants(baseId: string) {
  return savedPresets.value.filter(p => p.basePresetId === baseId);
}

const activeBaseId = computed(() => {
  if (!selectedPresetId.value) return null;
  const p = savedPresets.value.find(p => p.id === selectedPresetId.value);
  return p?.basePresetId || p?.id || null;
});

// ─── Save preset ─────────────────────────────────────────────────────────────

function quickSave() {
  const name = `Preset ${savedPresets.value.length + 1}`;
  // Capture ALL currently programmed channels (null = no diff, full snapshot)
  const categories = extractCategories(props.fixtures, props.effects, null, props.nodes);
  const id = `preset-${Date.now()}`;
  const preset: Preset = {
    id,
    name,
    createdAt: new Date().toISOString(),
    categories,
  };
  history.execute(new SavePresetCommand(
    preset,
    () => savedPresets.value,
    (presets) => { savedPresets.value = presets; },
    () => selectedPresetId.value,
    (id) => { selectedPresetId.value = id; }
  ));
  nextTick(() => startRename(preset));
}

// ... handleOverwrite remains unchanged
function handleOverwrite(preset: Preset) {
  const oldCats = preset.categories;
  
  let diffBase: Preset | null = null;
  if (preset.basePresetId) {
    const rawBase = savedPresets.value.find(p => p.id === preset.basePresetId);
    if (rawBase) {
      diffBase = resolvePreset(rawBase, savedPresets.value);
    }
  }

  const newCats = extractCategories(props.fixtures, props.effects, diffBase, props.nodes);
  
  history.execute(new OverwritePresetCommand(
    preset.id,
    preset.name,
    oldCats,
    newCats,
    () => savedPresets.value,
    (presets) => { savedPresets.value = presets; }
  ));
}

function quickSaveVariant(basePreset: Preset) {
  const existingVariants = getVariants(basePreset.id || basePreset.basePresetId!);
  const name = `Variant ${existingVariants.length + 1}`;
  const resolvedBase = resolvePreset(basePreset, savedPresets.value);
  const categories = extractCategories(props.fixtures, props.effects, resolvedBase, props.nodes);
  const id = `preset-${Date.now()}`;
  const preset: Preset = {
    id,
    name,
    basePresetId: basePreset.basePresetId || basePreset.id,
    type: 'normal',
    createdAt: new Date().toISOString(),
    categories,
  };
  history.execute(new SavePresetCommand(
    preset,
    () => savedPresets.value,
    (presets) => { savedPresets.value = presets; },
    () => selectedPresetId.value,
    (id) => { selectedPresetId.value = id; }
  ));
  nextTick(() => startRename(preset));
}

import type { OverwriteTarget, PresetType } from '~/utils/engine/preset-types';

function setPresetType(preset: Preset, type: PresetType, target: OverwriteTarget | undefined = undefined) {
  preset.type = type;
  if (target) preset.overwriteTarget = target;
  else preset.overwriteTarget = undefined;
}

function getVariantTypeDescription(variant: Preset) {
  if (variant.type === 'flash') return 'Flash: Active only while triggered';
  if (variant.type === 'overwrite') return `Overwrite: Replaces the global ${variant.overwriteTarget || 'FX'} button`;
  return 'Normal: Standard preset variant';
}

function handleDeletePreset(preset: Preset) {
  history.execute(new DeletePresetCommand(
    preset,
    () => savedPresets.value,
    (presets) => { savedPresets.value = presets; },
    () => selectedPresetId.value,
    (id) => { selectedPresetId.value = id; }
  ));
}

// ─── Rename state ─────────────────────────────────────────────────────────────

const renamingId = ref<string | null>(null);
const renameValue = ref('');
const renameInputRef = ref<any[]>([]);

function startRename(preset: Preset) {
  renamingId.value = preset.id;
  renameValue.value = preset.name;
  nextTick(() => {
    // Attempt focus on all rendered refs (only one should actually be rendered at a time anyway)
    renameInputRef.value.forEach(el => {
      if (!el) return;
      const inputEl = el?.$el || el;
      if (inputEl && typeof inputEl.focus === 'function') {
        inputEl.focus();
        if (typeof inputEl.select === 'function') {
          inputEl.select();
        }
      } else if (inputEl && inputEl.querySelector) {
        const inner = inputEl.querySelector('input');
        if (inner) {
          inner.focus();
          inner.select();
        }
      }
    });
  });
}

function confirmRename() {
  if (!renamingId.value) return;
  renamePreset(renamingId.value, renameValue.value.trim() || 'Untitled');
  renamingId.value = null;
}

function handleRenameKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') confirmRename();
  if (e.key === 'Escape') renamingId.value = null;
}

function handleRenameBlur() {
  if (renamingId.value) {
    confirmRename();
  }
}

// ─── Category icons ───────────────────────────────────────────────────────────

function getCategoryIcon(type: PresetCategoryType) {
  if (type === 'other') return Settings;
  // Map PresetCategoryType to ChannelCategoryKey where the names differ slightly
  const typeMap: Record<PresetCategoryType, string> = {
    color: 'color',
    movement: 'position',
    beam: 'beam',
    dimmer: 'intensity',
    other: 'control',
  };
  const key = typeMap[type];
  const cat = CHANNEL_CATEGORIES.find(c => c.id === key);
  return cat?.icon || Settings;
}

// ─── Accordion state ──────────────────────────────────────────────────────────

/** Track which preset is open in the accordion (single-open) */
const openPreset = ref<string | undefined>(undefined);

watch(selectedPresetId, (id) => {
  const activeBase = activeBaseId.value;
  if (activeBase && openPreset.value !== activeBase) openPreset.value = activeBase;
});

watch(activeBaseId, (baseId) => {
  if (baseId && openPreset.value !== baseId) openPreset.value = baseId;
});

function togglePresetApply(preset: Preset) {
  if (selectedPresetId.value === preset.id) {
    stopPreset(preset, props.fixtures, props.effects);
  } else {
    applyPreset(preset, props.fixtures, props.effects);
    openPreset.value = preset.basePresetId || preset.id;
  }
}

// ─── Selection helpers ────────────────────────────────────────────────────────

// Map PresetCategoryType to ChannelCategoryKey for the right properties panel
const categoryTypeToTab: Record<PresetCategoryType, string> = {
  color: 'color',
  movement: 'position',
  beam: 'beam',
  dimmer: 'intensity',
  other: 'control',
};

function handleCategoryClick(category: PresetCategory, preset: Preset) {
  if (selectedPresetId.value !== preset.id) {
    applyPreset(preset, props.fixtures, props.effects);
  }
  emit('selectFixtures', category.fixtureIds);
  const effectId = category.isModifier && category.modifiers.length > 0 ? category.modifiers[0]?.id : undefined;
  emit('openPropertiesTab', categoryTypeToTab[category.type] ?? 'control', category.isModifier, effectId);
}

function handleUnsavedCategoryClick(category: PresetCategory) {
  emit('selectFixtures', category.fixtureIds);
  const effectId = category.isModifier && category.modifiers.length > 0 ? category.modifiers[0]?.id : undefined;
  emit('openPropertiesTab', categoryTypeToTab[category.type] ?? 'control', category.isModifier, effectId);
}

function overwriteActivePreset() {
  if (selectedPresetId.value && hasUnsaved.value) {
    const preset = savedPresets.value.find(p => p.id === selectedPresetId.value);
    if (preset) handleOverwrite(preset);
  }
}

function createPresetFromSelection(selectedIds: Set<string | number>) {
  const selectedFixtures = props.fixtures.filter(f => selectedIds.has(f.id));
  if (selectedFixtures.length === 0) return;

  const name = `Preset ${savedPresets.value.length + 1}`;
  const categories = extractCategories(selectedFixtures, props.effects, null, props.nodes);
  const id = `preset-${Date.now()}`;
  const preset: Preset = {
    id,
    name,
    createdAt: new Date().toISOString(),
    categories,
  };
  history.execute(new SavePresetCommand(
    preset,
    () => savedPresets.value,
    (presets) => { savedPresets.value = presets; },
    () => selectedPresetId.value,
    (id) => { selectedPresetId.value = id; }
  ));
  nextTick(() => startRename(preset));
}

const { openMenu } = useGlobalContextMenu();

function onPresetContextMenu(e: MouseEvent, preset: Preset) {
  const isSelected = selectedPresetId.value === preset.id;
  const options: ContextMenuItemOption[] = [
    {
      label: isSelected ? 'Stop' : 'Play',
      variant: isSelected ? 'destructive' : 'default',
      action: () => togglePresetApply(preset),
    },
    { isSeparator: true },
    {
      label: 'Rename',
      action: () => startRename(preset),
    },
    { isSeparator: true },
    {
      label: preset.basePresetId ? 'Delete Variant' : 'Delete Preset',
      icon: Trash2,
      variant: 'destructive',
      shortcut: 'Del',
      action: () => handleDeletePreset(preset),
    },
  ];

  openMenu(e, options);
}

defineExpose({
  quickSave,
  quickSaveVariant,
  overwriteActivePreset,
  createPresetFromSelection,
  hasUnsaved,
  selectedPresetId,
  basePresets,
  getVariants,
  activeBaseId
});
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
      <!-- ─── Unsaved Changes Section ──────────────────────────────────────── -->
      <div class="border-b border-border shrink-0">
        <!-- Unsaved Changes header -->

        <!-- Unsaved changes list (max ~5 items before scroll) -->
        <div class="h-40 overflow-y-auto pb-5" >
          <div v-if="!hasUnsaved" class="px-3 py-3 text-[10px] text-muted-foreground opacity-50">
            No changes in programmer
          </div>
          <div v-else class="py-1 px-1.5 space-y-0.5">
            <button
              v-for="(category, idx) in unsavedChanges"
              :key="idx"
              class="flex items-center gap-2 w-full px-2 py-1.5 rounded-sm text-xs hover:bg-accent/60 transition-colors group/ucat text-left"
              @click="handleUnsavedCategoryClick(category)"
            >
              <component
                :is="getCategoryIcon(category.type)"
                class="size-3.5 shrink-0 transition-colors"
                :class="category.isModifier ? 'text-modifier' : 'text-foreground'"
              />
              <span 
                class="flex-1 truncate transition-colors"
                :class="category.isModifier ? 'text-modifier font-medium' : 'text-foreground'"
              >
                {{ category.label }}
              </span>
              <span 
                class="opacity-0 group-hover/ucat:opacity-70 transition-opacity text-[10px] shrink-0"
                :class="category.isModifier ? 'text-modifier' : 'text-foreground'"
              >
                {{ category.isModifier ? '(Effect)' : '(Value)' }}
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- ─── Saved Presets Section ────────────────────────────────────────── -->
      <div class="h-12 flex flex-row items-center justify-between px-4 border-b border-border bg-sidebar">
        <span class="font-semibold text-xs tracking-wider uppercase text-muted-foreground">
          Presets
        </span>
        <span
          class="text-[10px] tabular-nums text-muted-foreground"
          :class="{ 'text-foreground': savedPresets.length > 0 }"
        >
          {{ savedPresets.length }}
        </span>
      </div>

      <!-- ─── Presets accordion list ──────────────────────────────────────── -->
      <div class="flex-1 overflow-y-auto min-h-0">
        <div v-if="savedPresets.length === 0" class="flex flex-col items-start p-6 gap-3 text-muted-foreground opacity-60">
          <Save class="size-6 self-center mx-auto" />
          <span class="text-sm font-semibold text-foreground w-full text-center">No Presets</span>
          <p class="text-xs text-center">Presets allow you to save and recall channel values and effects across multiple fixtures.</p>
        </div>

        <Accordion v-else v-model="openPreset" type="single" collapsible class="px-1.5 py-1.5 space-y-0.5">
          <AccordionItem
            v-for="preset in basePresets"
            :key="preset.id"
            :value="preset.id"
            class="rounded-md overflow-hidden !border-b border border-border/50 bg-background/20"
          >
            <!-- Custom header: rename/delete + accordion trigger -->
            <AccordionHeader class="w-full relative" @contextmenu.prevent="onPresetContextMenu($event, preset)">
              <AccordionTrigger
                class="flex-1 px-3 py-2 text-xs font-medium hover:no-underline border-border/40
                       transition-colors [&>svg]:hidden flex items-center justify-between w-full"
                :class="[selectedPresetId === preset.id ? 'text-primary' : 'text-foreground']"
              >
                <div class="flex items-center gap-2 flex-1 min-w-0 w-full" @dblclick.stop="startRename(preset)">
                  <!-- Name or rename input -->
                  <template v-if="renamingId === preset.id">
                    <Input
                      ref="renameInputRef"
                      v-model="renameValue"
                      class="h-5 text-xs px-1 py-0 flex-1 min-w-0"
                      @keydown.prevent.enter="confirmRename"
                      @keydown.prevent.escape="renamingId = null"
                      @blur="handleRenameBlur"
                      @click.stop
                      autofocus
                    />
                  </template>
                  <template v-else>
                    <span class="flex-1 text-left truncate">{{ preset.name }}</span>
                  </template>
                </div>

                <!-- Action buttons -->
                <div class="flex items-center">
                  <!-- Create Variant button -->
                  <button
                    type="button"
                    v-if="activeBaseId === preset.id && hasUnsaved"
                    class="flex items-center justify-center p-1.5 text-xs font-medium hover:opacity-100 opacity-60 transition-opacity text-foreground"
                    @click.stop="quickSaveVariant(preset)"
                    title="Create Variant from current changes"
                  >
                    <GitFork class="size-3.5 shrink-0" />
                  </button>

                  <!-- Overwrite button for base preset -->
                  <button
                    type="button"
                    v-if="selectedPresetId === preset.id && hasUnsaved"
                    class="flex items-center justify-center p-1.5 text-xs font-medium hover:opacity-100 opacity-60 transition-opacity"
                    @click.stop="handleOverwrite(preset)"
                    title="Overwrite Preset with current changes (Shift+S)"
                  >
                    <Save class="size-3.5 shrink-0 text-foreground" />
                  </button>

                  <!-- Play / Stop button -->
                  <button
                      type="button"
                      class="flex items-center justify-center pl-2 pr-3 py-1 text-xs font-medium hover:opacity-80 transition-opacity"
                      @click.stop="togglePresetApply(preset)"
                    >
                      <Square
                        v-if="selectedPresetId === preset.id"
                        class="size-3.5 shrink-0 fill-primary text-primary"
                      />
                      <Play
                        v-else
                        class="size-3.5 text-muted-foreground/50 hover:text-muted-foreground shrink-0 transition-colors"
                      />
                  </button>
                </div>
              </AccordionTrigger>
            </AccordionHeader>

            <!-- Categories inside the preset -->
            <AccordionContent class="pb-0">
              <div class="py-1 px-1 border-t border-border/30">
                <div v-if="preset.categories.length > 0">
                  <button
                    v-for="(category, idx) in preset.categories"
                    :key="idx"
                    class="flex items-center gap-2 w-full px-2 py-1.5 rounded-sm text-xs
                           hover:bg-accent/60 transition-colors group/cat text-left"
                    @click="handleCategoryClick(category, preset)"
                  >
                    <component
                      :is="getCategoryIcon(category.type)"
                      class="size-3.5 shrink-0 transition-colors"
                      :class="category.isModifier ? 'text-modifier' : 'text-muted-foreground group-hover/cat:text-foreground'"
                    />
                    <span 
                      class="flex-1 truncate transition-colors"
                      :class="category.isModifier ? 'text-modifier font-medium' : 'text-muted-foreground group-hover/cat:text-foreground'"
                    >
                      {{ category.label }}
                    </span>
                    <div class="relative flex items-center justify-end w-12 shrink-0">
                      <span class="group-hover/cat:opacity-0 opacity-100 text-muted-foreground/50 transition-opacity text-[9px] tabular-nums text-right w-full absolute pointer-events-none">
                        {{ category.fixtureIds.length }} fixture{{ category.fixtureIds.length !== 1 ? 's' : '' }}
                      </span>
                      <span 
                        class="opacity-0 group-hover/cat:opacity-70 transition-opacity text-[10px] tabular-nums text-right w-full"
                        :class="category.isModifier ? 'text-modifier' : 'text-muted-foreground group-hover/cat:text-foreground'"
                      >
                        {{ category.isModifier ? '(Effect)' : '(Value)' }}
                      </span>
                    </div>
                  </button>
                </div>

                <!-- Variants Loop -->
                <div v-for="variant in getVariants(preset.id)" :key="variant.id" class="relative mt-2">
                  <!-- The main branch line for this variant -->
                  <div class="absolute left-3 top-0 bottom-0 w-px bg-primary/20 pointer-events-none" />
                  
                  <!-- Variant Header -->
                  <div 
                    class="relative flex items-center justify-between w-full px-2 py-1 text-xs font-medium transition-colors group/var" 
                    :class="selectedPresetId === variant.id ? 'text-primary' : 'text-foreground'"
                    @contextmenu.prevent="onPresetContextMenu($event, variant)"
                  >
                    <!-- horizontal tick -->
                    <div class="absolute left-3 top-1/2 w-3 border-t border-primary/20 pointer-events-none" />
                    
                    <div class="flex items-center gap-2 flex-1 min-w-0 w-full pl-5" @dblclick.stop="startRename(variant)">
                        <template v-if="renamingId === variant.id">
                          <Input ref="renameInputRef" v-model="renameValue" class="h-5 text-xs px-1 py-0 flex-1 min-w-0" @keydown.prevent.enter="confirmRename" @keydown.prevent.escape="renamingId = null" @blur="handleRenameBlur" @click.stop autofocus />
                        </template>
                        <template v-else>
                          <span class="flex-1 text-left truncate">{{ variant.name }}</span>
                        </template>
                    </div>

                    <div class="flex items-center transition-opacity" :class="selectedPresetId === variant.id ? 'opacity-100' : 'opacity-80 group-hover/var:opacity-100'">
                        <!-- Preset Type Dropdown -->
                        <DropdownMenu>
                          <DropdownMenuTrigger as-child>
                            <button
                              type="button"
                              class="flex items-center justify-center p-1.5 text-xs hover:opacity-100 opacity-60 transition-opacity text-foreground"
                              :title="getVariantTypeDescription(variant)"
                              @click.stop
                            >
                              <Zap v-if="variant.type === 'flash'" class="size-3.5 shrink-0 text-yellow-500" />
                              <template v-else-if="variant.type === 'overwrite'">
                                <Activity class="size-3.5 shrink-0 text-orange-500" />
                                <span class="ml-1 text-[9px] uppercase font-bold text-orange-500">{{ variant.overwriteTarget?.substring(0, 3) || 'FX' }}</span>
                              </template>
                              <Layers v-else class="size-3.5 shrink-0" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent class="w-40">
                            <DropdownMenuItem :class="{'text-primary': !variant.type || variant.type === 'normal'}" @click.stop="setPresetType(variant, 'normal')">
                              <Layers class="mr-3 size-4 opacity-70" /> Normal
                            </DropdownMenuItem>
                            <DropdownMenuItem :class="{'text-primary': variant.type === 'flash'}" @click.stop="setPresetType(variant, 'flash')">
                              <Zap class="mr-3 size-4 opacity-70" /> Flash
                            </DropdownMenuItem>
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger :class="{'text-primary': variant.type === 'overwrite'}">
                                <Activity class="mr-3 size-4 opacity-70" /> Overwrite
                              </DropdownMenuSubTrigger>
                              <DropdownMenuPortal>
                                <DropdownMenuSubContent class="w-32">
                                  <DropdownMenuItem :class="{'text-primary': variant.type === 'overwrite' && variant.overwriteTarget === 'strobe'}" @click.stop="setPresetType(variant, 'overwrite', 'strobe')">
                                    Strobe
                                  </DropdownMenuItem>
                                  <DropdownMenuItem :class="{'text-primary': variant.type === 'overwrite' && variant.overwriteTarget === 'blind'}" @click.stop="setPresetType(variant, 'overwrite', 'blind')">
                                    Blind
                                  </DropdownMenuItem>
                                  <DropdownMenuItem :class="{'text-primary': variant.type === 'overwrite' && variant.overwriteTarget === 'blackout'}" @click.stop="setPresetType(variant, 'overwrite', 'blackout')">
                                    Blackout
                                  </DropdownMenuItem>
                                </DropdownMenuSubContent>
                              </DropdownMenuPortal>
                            </DropdownMenuSub>
                          </DropdownMenuContent>
                        </DropdownMenu>

                        <!-- Variant Overwrite -->
                        <button type="button" v-if="selectedPresetId === variant.id && hasUnsaved" class="p-1.5 text-xs hover:opacity-100 opacity-60 text-foreground" @click.stop="handleOverwrite(variant)" title="Overwrite Variant">
                          <Save class="size-3.5 shrink-0" />
                        </button>
                        
                        <!-- Variant Play/Stop -->
                        <button type="button" class="pl-2 pr-1 py-1 text-xs hover:opacity-80" @click.stop="togglePresetApply(variant)">
                          <Square v-if="selectedPresetId === variant.id" class="size-3.5 fill-primary text-primary shrink-0" />
                          <Play v-else class="size-3.5 text-muted-foreground/50 hover:text-muted-foreground shrink-0 transition-colors" />
                        </button>
                    </div>
                  </div>

                  <!-- Variant Categories -->
                  <div class="pl-6 pb-2 relative">
                    <button v-for="(cat, vIdx) in variant.categories" :key="vIdx" class="flex items-center gap-2 w-full px-2 py-1.5 rounded-sm text-xs hover:bg-accent/60 transition-colors text-left group/vcat" @click="handleCategoryClick(cat, variant)">
                        <component :is="getCategoryIcon(cat.type)" class="size-3.5 shrink-0 transition-colors" :class="cat.isModifier ? 'text-modifier' : 'text-muted-foreground group-hover/vcat:text-foreground'" />
                        <span class="flex-1 truncate transition-colors" :class="cat.isModifier ? 'text-modifier font-medium' : 'text-muted-foreground group-hover/vcat:text-foreground'">{{ cat.label }}</span>
                        <!-- Variant category info -->
                        <span 
                          class="opacity-0 group-hover/vcat:opacity-70 transition-opacity text-[10px] shrink-0"
                          :class="cat.isModifier ? 'text-modifier' : 'text-muted-foreground group-hover/vcat:text-foreground'"
                        >
                          {{ cat.isModifier ? '(Effect)' : '(Value)' }}
                        </span>
                    </button>
                  </div>
                </div>

              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <!-- Save as Preset button (always after the list) -->
        <div class="px-1.5 pb-1.5 flex justify-center">
          <Button
            variant="outline"
            class="mt-5 h-7 text-[10px] uppercase tracking-widest font-semibold gap-1.5"
            :disabled="!hasUnsaved"
            @click="quickSave"
            title="Save as new preset (Shift+P)"
          >
            <Save class="size-3" />
            Create Preset <span class="opacity-50 ml-1 font-normal capitalize tracking-normal">(Shift+P)</span>
          </Button>
        </div>
      </div>
    </div>
</template>
