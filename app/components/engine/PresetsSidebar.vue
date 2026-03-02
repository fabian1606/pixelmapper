<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Effect } from '~/utils/engine/types';
import { usePresets } from '~/components/engine/composables/use-presets';
import type { Preset, PresetCategory, PresetCategoryType } from '~/utils/engine/preset-types';
import { CHANNEL_CATEGORIES } from '~/utils/engine/channel-categories';
import {
  Settings,
  Save,
  X,
  Check,
  Pencil,
  Trash2,
  Play,
  Square,
} from 'lucide-vue-next';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
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
}>();

const emit = defineEmits<{
  /** Called when a preset subgroup is clicked — selects those fixture IDs */
  (e: 'selectFixtures', ids: (string | number)[]): void;
  /** Called when a category item is clicked — opens that tab in the properties panel */
  (e: 'openPropertiesTab', tab: string): void;
}>();

// ─── Preset state ─────────────────────────────────────────────────────────────

const {
  savedPresets,
  selectedPresetId,
  getUnsavedChanges,
  savePreset,
  applyPreset,
  deletePreset,
  renamePreset,
  stopPreset, // Added stopPreset
} = usePresets();

// ─── Unsaved changes (reactive, recomputed on fixture changes) ────────────────

const unsavedChanges = computed(() => getUnsavedChanges(props.fixtures, props.effects));
const hasUnsaved = computed(() => unsavedChanges.value.length > 0);

// ─── Save preset ─────────────────────────────────────────────────────────────

function quickSave() {
  const name = `Preset ${savedPresets.value.length + 1}`;
  const preset = savePreset(name, props.fixtures, props.effects);
  // Immediately start rename on the newly created preset
  nextTick(() => startRename(preset));
}

// ─── Rename state ─────────────────────────────────────────────────────────────

const renamingId = ref<string | null>(null);
const renameValue = ref('');

function startRename(preset: Preset) {
  renamingId.value = preset.id;
  renameValue.value = preset.name;
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
  confirmRename();
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
  if (id && openPreset.value !== id) openPreset.value = id;
});

function togglePresetApply(preset: Preset) {
  if (selectedPresetId.value === preset.id) {
    stopPreset(preset, props.fixtures, props.effects);
  } else {
    applyPreset(preset, props.fixtures, props.effects);
    openPreset.value = preset.id;
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
  applyPreset(preset, props.fixtures, props.effects);
  emit('selectFixtures', category.fixtureIds);
  emit('openPropertiesTab', categoryTypeToTab[category.type] ?? 'control');
}

function handleUnsavedCategoryClick(category: PresetCategory) {
  emit('selectFixtures', category.fixtureIds);
  emit('openPropertiesTab', categoryTypeToTab[category.type] ?? 'control');
}

defineExpose({ quickSave });
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
      <!-- ─── Unsaved Changes Section ──────────────────────────────────────── -->
      <div class="border-b border-border shrink-0">
        <!-- Unsaved Changes header -->

        <!-- Unsaved changes list (max ~5 items before scroll) -->
        <div class="max-h-40 overflow-y-auto pb-5" >
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
                class="size-3.5 shrink-0 text-muted-foreground"
              />
              <span class="flex-1 truncate text-muted-foreground group-hover/ucat:text-foreground transition-colors">
                {{ category.label }}
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
            v-for="preset in savedPresets"
            :key="preset.id"
            :value="preset.id"
            class="rounded-md overflow-hidden !border-b border border-border/50 bg-background/20"
          >
            <!-- Custom header: rename/delete + accordion trigger -->
            <ContextMenu>
              <ContextMenuTrigger as-child>
                <AccordionHeader class="w-full">
                  <AccordionTrigger
                    class="flex-1 px-3 py-2 text-xs font-medium hover:no-underline border-border/40
                           transition-colors [&>svg]:hidden flex items-center justify-between w-full"
                    :class="selectedPresetId === preset.id ? 'text-primary' : 'text-foreground'"
                  >
                    <div class="flex items-center gap-2 flex-1 min-w-0 w-full" @dblclick.stop="startRename(preset)">
                      <!-- Name or rename input -->
                      <template v-if="renamingId === preset.id">
                        <Input
                          v-model="renameValue"
                          class="h-5 text-xs px-1 py-0 flex-1 min-w-0"
                          @keydown="handleRenameKeydown"
                          @blur="handleRenameBlur"
                          @click.stop
                          autofocus
                        />
                      </template>
                      <template v-else>
                        <span class="flex-1 text-left truncate">{{ preset.name }}</span>
                      </template>
                    </div>

                    <!-- Play / Stop button -->
                    <button
                       class="flex items-center justify-center pl-3 py-1 text-xs font-medium hover:opacity-80 transition-opacity"
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
                  </AccordionTrigger>
                </AccordionHeader>
              </ContextMenuTrigger>

              <ContextMenuContent class="w-48">
                <ContextMenuItem @click="togglePresetApply(preset)">
                  <template v-if="selectedPresetId === preset.id">
                    <Square class="mr-2 size-4 text-destructive" /> Stop
                  </template>
                  <template v-else>
                    <Play class="mr-2 size-4" /> Play
                  </template>
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem @click="startRename(preset)">
                  <Pencil class="mr-2 size-4" /> Rename
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem @click="deletePreset(preset.id)" class="text-destructive focus:bg-destructive focus:text-destructive-foreground">
                  <Trash2 class="mr-2 size-4" /> Delete Preset
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>


            <!-- Categories inside the preset -->
            <AccordionContent class="pb-0">
              <div class="py-1 px-1 border-t border-border/30">
                <button
                  v-for="(category, idx) in preset.categories"
                  :key="idx"
                  class="flex items-center gap-2 w-full px-2 py-1.5 rounded-sm text-xs
                         hover:bg-accent/60 transition-colors group/cat text-left"
                  @click="handleCategoryClick(category, preset)"
                >
                  <component
                    :is="getCategoryIcon(category.type)"
                    class="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span class="flex-1 truncate text-muted-foreground group-hover/cat:text-foreground transition-colors">
                    {{ category.label }}
                  </span>
                  <span class="text-[9px] text-muted-foreground/50 shrink-0 tabular-nums">
                    {{ category.fixtureIds.length }} fixture{{ category.fixtureIds.length !== 1 ? 's' : '' }}
                  </span>
                </button>
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
          >
            <Save class="size-3" />
            Save as Preset
          </Button>
        </div>
      </div>
    </div>
</template>
