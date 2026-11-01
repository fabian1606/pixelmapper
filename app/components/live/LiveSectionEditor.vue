<script setup lang="ts">
import { computed, ref } from 'vue';
import { GripVertical, RefreshCw, Trash2 } from 'lucide-vue-next';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useEngineStore } from '~/stores/engine-store';
import { useHistory } from '~/components/engine/composables/use-history';
import {
  RemoveLiveSectionCommand,
  UpdateLiveSectionCommand,
} from '~/components/engine/commands/live-widget-commands';
import type { LiveSection, SectionColorEntry, SectionSource, SectionTrigger } from '~/utils/live/types';
import { resolveSectionSource } from '~/utils/live/sections';
import { SECTION_TRIGGER_LABELS, sectionTrigger } from '~/utils/live/button-actions';
import { TRIGGER_ICONS } from './action-icons';
import { getPresetNaturalRGB, growColorVariants, type RGB } from '~/utils/live/color-utils';

/**
 * Editor for one live section: name, member assignment mode, what fills the
 * buttons, curated preset list, color palette and the trigger. Used both when a whole
 * section is selected and inline under a button whose action is "Section".
 */
const props = defineProps<{
  section: LiveSection;
}>();

const store = useLiveModeStore();
const engineStore = useEngineStore();
const history = useHistory();

/** Applies a patch to the edited section through the history. */
function updateSection(patch: Partial<Omit<LiveSection, 'id' | 'members'>>) {
  if (!store.activePageId) return;
  history.execute(new UpdateLiveSectionCommand(store.activePageId, props.section.id, patch));
}

function updateSectionName(name: string) {
  updateSection({ name });
}

function updateSectionTrigger(trigger: SectionTrigger) {
  updateSection({ trigger });
}

const trigger = computed(() => sectionTrigger(props.section));
const TriggerIcon = computed(() => TRIGGER_ICONS[trigger.value]);
const TRIGGER_HINTS: Record<SectionTrigger, string> = {
  press: 'The pressed button becomes active. Only one can be active, because only one preset can be.',
  hold: 'Plays while held, then goes back to the preset from before.',
  toggle: 'Press to activate. Press the lit button again to go back to the preset from before.',
};

/** Natural RGB of the active preset — the base for color-variant palettes. */
function activePresetRGB(): RGB | null {
  return engineStore.selectedPresetId
    ? getPresetNaturalRGB(engineStore.selectedPresetId, engineStore.savedPresets, engineStore.flatFixtures)
    : null;
}

/** Preset IDs the 'all-presets' source would currently surface, in its order. */
function allPresetIds(): string[] {
  return resolveSectionSource('all-presets', {
    savedPresets: engineStore.savedPresets,
    selectedPresetId: engineStore.selectedPresetId,
  }).map(s => s.preset.id);
}

function updateSectionSource(source: SectionSource) {
  const sec = props.section;
  const patch: Partial<Omit<LiveSection, 'id' | 'members'>> = { source };
  // Seed a stable color palette so it doesn't shift on every recount.
  if (source === 'color-variants') {
    patch.colorVariants = growColorVariants(sec.colorVariants, sec.members.length, activePresetRGB());
  }
  // Seed the curated list from the current "all presets" set on first switch,
  // so the user starts from everything and prunes/reorders from there.
  if (source === 'selected-presets' && (!sec.selectedPresetIds || sec.selectedPresetIds.length === 0)) {
    patch.selectedPresetIds = allPresetIds();
  }
  updateSection(patch);
}

// "Fill buttons with": one sentence-like choice per source.
const SOURCE_OPTIONS: Record<SectionSource, string> = {
  'all-presets': 'All presets',
  'selected-presets': 'Presets I pick',
  'preset-variants': 'Variants of the active preset',
  'color-variants': 'Colors of the active preset',
};
/** Sources whose buttons change whenever another preset becomes active. */
const isDynamic = computed(() => props.section.source === 'preset-variants' || props.section.source === 'color-variants');

// ── Member assignment (mapping mode) ─────────────────────────────────────────

function enterSectionMappingMode() {
  store.sectionMappingMode = props.section.id;
  store.isolatedSectionId = null;
  store.isolatedGroupId = null;
  // While mapping, we surface the section directly — no individual widget
  // should appear "selected" with a blue ring on the canvas.
  store.selectedWidgetIds = new Set();
  store.selectedControlId = null;
  store.selectedSectionId = props.section.id;
}

const isInMappingMode = computed(() => store.sectionMappingMode === props.section.id);

function deleteSection() {
  if (!store.activePageId) return;
  history.execute(new RemoveLiveSectionCommand(store.activePageId, props.section.id));
}

// ── Selected-presets list editor ─────────────────────────────────────────────

/** Ordered entries for the selected-presets editor (preset may be null if deleted). */
const selectedPresetEntries = computed(() => {
  if (props.section.source !== 'selected-presets') return [];
  const byId = new Map(engineStore.savedPresets.map(p => [p.id, p]));
  return (props.section.selectedPresetIds ?? []).map(id => ({ id, preset: byId.get(id) ?? null }));
});

/** Top-level presets not yet in the curated list — candidates for the add picker. */
const addablePresets = computed(() => {
  if (props.section.source !== 'selected-presets') return [];
  const have = new Set(props.section.selectedPresetIds ?? []);
  return resolveSectionSource('all-presets', {
    savedPresets: engineStore.savedPresets,
    selectedPresetId: engineStore.selectedPresetId,
  }).map(s => s.preset).filter(p => !have.has(p.id));
});

function setSelectedPresetIds(ids: string[]) {
  updateSection({ selectedPresetIds: ids });
}

// Drag-to-reorder state for the selected-presets list.
const dragFromIdx = ref<number | null>(null);
const dragOverIdx = ref<number | null>(null);

function onSelectedPresetDrop(toIdx: number) {
  const from = dragFromIdx.value;
  dragFromIdx.value = null;
  dragOverIdx.value = null;
  if (from === null || from === toIdx) return;
  const ids = [...(props.section.selectedPresetIds ?? [])];
  const [moved] = ids.splice(from, 1);
  if (moved === undefined) return;
  ids.splice(toIdx, 0, moved);
  setSelectedPresetIds(ids);
}

function removeSelectedPreset(index: number) {
  const ids = [...(props.section.selectedPresetIds ?? [])];
  ids.splice(index, 1);
  setSelectedPresetIds(ids);
}

function addSelectedPreset(id: string) {
  if (!id) return;
  const ids = [...(props.section.selectedPresetIds ?? [])];
  if (ids.includes(id)) return;
  ids.push(id);
  setSelectedPresetIds(ids);
}

// ── Color-variants palette editor ────────────────────────────────────────────

/** Update a single slot's stored color (slot 0 is always preset-natural and not user-editable). */
function setColorVariantSlot(index: number, rgb: RGB) {
  if (index <= 0) return;
  const sec = props.section;
  const current = growColorVariants(sec.colorVariants, sec.members.length, activePresetRGB());
  const next: SectionColorEntry[] = current.map((e, i) => i === index ? { ...rgb } : e);
  updateSection({ colorVariants: next });
}

function regenerateColorVariants() {
  updateSection({ colorVariants: growColorVariants(undefined, props.section.members.length, activePresetRGB()) });
}

/** Hex string ("#rrggbb") for a slot's effective color, used in the editor swatches. */
function slotHex(index: number): string {
  const baseRGB = activePresetRGB();
  const entries = growColorVariants(props.section.colorVariants, props.section.members.length, baseRGB);
  const rgb = entries[index] ?? baseRGB;
  if (!rgb) return '#000000';
  const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function hexToRGB(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return { r: parseInt(m[1]!, 16), g: parseInt(m[2]!, 16), b: parseInt(m[3]!, 16) };
}

function onSlotColorInput(index: number, value: string) {
  const rgb = hexToRGB(value);
  if (rgb) setColorVariantSlot(index, rgb);
}

/** Visible slot indices for the color editor (matches the section's member count). */
const colorVariantSlots = computed<number[]>(() => {
  if (props.section.source !== 'color-variants') return [];
  return Array.from({ length: props.section.members.length }, (_, i) => i);
});
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Mapping mode banner -->
    <div
      v-if="isInMappingMode"
      class="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-violet-500/20 ring-1 ring-violet-400/50"
    >
      <span class="text-[10px] text-violet-300 leading-snug">Click = toggle membership</span>
      <button
        type="button"
        class="shrink-0 px-2 py-1 rounded text-[11px] font-medium bg-violet-500 hover:bg-violet-400 text-white transition-colors"
        @click="store.exitSectionMappingMode()"
      >
        Done
      </button>
    </div>

    <div class="flex gap-1.5">
      <input
        type="text"
        class="flex-1 min-w-0 text-xs bg-background border border-border rounded px-2 py-1.5"
        placeholder="Section name"
        :value="section.name ?? ''"
        @change="(e) => updateSectionName((e.target as HTMLInputElement).value)"
      />
      <button
        type="button"
        class="shrink-0 px-2 py-1.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap"
        :class="isInMappingMode
          ? 'bg-violet-500 hover:bg-violet-400 text-white'
          : 'bg-accent hover:bg-accent/80'"
        title="Assign buttons to this section"
        @click="enterSectionMappingMode"
      >
        Assign
      </button>
    </div>

    <div class="flex flex-col gap-1">
      <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Fill buttons with</span>
      <select
        class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
        :value="section.source"
        @change="(e) => updateSectionSource((e.target as HTMLSelectElement).value as SectionSource)"
      >
        <option v-for="(label, key) in SOURCE_OPTIONS" :key="key" :value="key">{{ label }}</option>
      </select>
      <span v-if="isDynamic" class="flex items-center gap-1 text-[10px] text-violet-300">
        <RefreshCw class="size-3" /> changes with the active preset
      </span>
    </div>

    <!-- Selected-presets editor: reorder, remove, add -->
    <div v-if="section.source === 'selected-presets'" class="flex flex-col gap-1.5">
      <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Selected presets</span>
      <div v-if="selectedPresetEntries.length === 0" class="text-[10px] text-muted-foreground/70 leading-snug">
        No presets selected. Add some below.
      </div>
      <div v-else class="flex flex-col gap-1">
        <div
          v-for="(entry, i) in selectedPresetEntries"
          :key="entry.id"
          class="group/row flex items-center gap-1 text-[11px] rounded"
          :class="dragOverIdx === i ? 'border-t-2 border-primary' : ''"
          draggable="true"
          @dragstart="dragFromIdx = i"
          @dragover.prevent="dragOverIdx = i"
          @drop="onSelectedPresetDrop(i)"
          @dragend="dragFromIdx = null; dragOverIdx = null"
        >
          <GripVertical class="size-3 shrink-0 text-muted-foreground/40 cursor-grab active:cursor-grabbing" />
          <span class="text-muted-foreground/60 w-4 tabular-nums shrink-0">{{ i + 1 }}</span>
          <span class="flex-1 min-w-0 truncate" :class="{ 'text-destructive italic': !entry.preset }">
            {{ entry.preset?.name ?? '(deleted preset)' }}
          </span>
          <button
            type="button"
            class="shrink-0 p-1 rounded hover:bg-destructive/20 text-destructive opacity-0 group-hover/row:opacity-100"
            title="Remove from list"
            @click="removeSelectedPreset(i)"
          >
            <Trash2 class="size-3" />
          </button>
        </div>
      </div>
      <select
        v-if="addablePresets.length > 0"
        class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
        @change="(e) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v) addSelectedPreset(v);
          (e.target as HTMLSelectElement).value = '';
        }"
      >
        <option value="">+ Add preset…</option>
        <option v-for="p in addablePresets" :key="p.id" :value="p.id">{{ p.name ?? p.id }}</option>
      </select>
    </div>

    <!-- Color Variants editor: stable, editable palette -->
    <div v-if="section.source === 'color-variants'" class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between">
        <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Colors</span>
        <button
          type="button"
          class="text-[9px] text-muted-foreground/70 hover:text-muted-foreground underline-offset-2 hover:underline"
          title="Regenerate evenly distributed colors"
          @click="regenerateColorVariants"
        >
          Regenerate
        </button>
      </div>
      <div class="flex flex-col gap-1">
        <div
          v-for="i in colorVariantSlots"
          :key="i"
          class="flex items-center gap-2 text-[10px]"
        >
          <span class="text-muted-foreground/60 w-5 tabular-nums">{{ i + 1 }}</span>
          <template v-if="i === 0">
            <div
              class="w-5 h-5 rounded border border-border shrink-0"
              :style="{ backgroundColor: slotHex(i) }"
            />
            <span class="text-muted-foreground/70">Preset (auto)</span>
          </template>
          <template v-else>
            <input
              type="color"
              class="w-5 h-5 rounded border border-border shrink-0 cursor-pointer bg-transparent p-0"
              :value="slotHex(i)"
              @input="(e) => onSlotColorInput(i, (e.target as HTMLInputElement).value)"
            />
            <span class="text-muted-foreground/70 font-mono">{{ slotHex(i) }}</span>
          </template>
        </div>
      </div>
    </div>

    <!-- Trigger: how a section button reacts (same header as an action card) -->
    <div class="border border-border/60 rounded-lg bg-card shadow-sm overflow-hidden flex flex-col">
      <div class="flex items-center gap-1 px-3 py-1 border-b border-border/60 bg-muted/20 min-w-0">
        <component :is="TriggerIcon" class="size-3.5 shrink-0 text-primary" />
        <select
          class="flex-1 min-w-0 h-7 text-xs font-medium bg-transparent border border-transparent hover:border-border rounded px-1 cursor-pointer"
          :value="trigger"
          aria-label="Trigger"
          @change="(e) => updateSectionTrigger((e.target as HTMLSelectElement).value as SectionTrigger)"
        >
          <option v-for="(label, key) in SECTION_TRIGGER_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
      </div>
      <p class="p-3 text-[10px] text-muted-foreground leading-snug">{{ TRIGGER_HINTS[trigger] }}</p>
    </div>

    <!-- Extra actions supplied by the host (e.g. "Remove from section") -->
    <div class="flex gap-1.5 mt-1">
      <slot name="actions" />
      <button
        type="button"
        class="px-2 py-1.5 rounded text-[11px] font-medium bg-destructive/15 hover:bg-destructive/25 text-destructive transition-colors"
        :class="{ 'flex-1': !$slots.actions }"
        @click="deleteSection"
      >
        Delete section
      </button>
    </div>
  </div>
</template>
