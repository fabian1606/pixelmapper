<script setup lang="ts">
/**
 * Preset row of a modifier card (plan M5.2, revised after review): one line
 * "Preset ▾ Name" like the preset menus of Resolume or Ableton. The list
 * shows every recipe with a thin animated strip and a "2D" badge when it
 * spreads on the stage. Hovering or arrowing through the list previews the
 * recipe (live strip and fixtures, nothing saved); click / Enter applies it
 * as one undo step, Esc or leaving restores. After an edit the row reads
 * "Name · modified" with ↺ back to the recipe.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Check, ChevronDown, RotateCcw } from 'lucide-vue-next';
import type { ContentPluginManifest, ManifestPreset } from '@pixelmapper/plugin-toolchain/types';
import type { ModifierInstance } from '~/utils/engine/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { activePreset, applyPreset, applyPresetOnSelection, cardPresets } from '~/utils/engine/recipes';
import type { SelectionShape } from '~/utils/engine/distribution/selection-shape';
import { previewRgb, renderStrip } from '~/utils/plugins/preview-pool';
import { sampleClock } from '~/composables/engine/use-modifier-phase';

const props = defineProps<{
  modifier: ModifierInstance;
  manifest: ContentPluginManifest;
  rankCount?: number;
  /** Current selection (recipes that change the mode are placed on it). */
  selectionShape?: SelectionShape;
}>();

const emit = defineEmits<{
  apply: [next: ModifierInstance, preset: ManifestPreset];
  /** The recipe under the pointer / keyboard (null = none): shown, not saved. */
  preview: [next: ModifierInstance | null];
  'dropdown-open-change': [open: boolean];
}>();

const COLS = 24;
const presets = computed(() => cardPresets(props.manifest));
const active = computed(() => activePreset(props.modifier, props.manifest));
/** The recipe the instance last matched or got applied (for "modified" and revert). */
const lastApplied = ref<string | null>(null);
watch(active, (p) => { if (p) lastApplied.value = p.id; }, { immediate: true });
const base = computed(() => active.value ?? presets.value.find(p => p.id === lastApplied.value) ?? null);
const modified = computed(() => !active.value && !!base.value);

const open = ref(false);
const highlighted = ref(-1);
const canvases = ref<HTMLCanvasElement[]>([]);
let raf = 0;
let last = 0;

/** Spreads on the stage (linear / radial / conical). */
const is2d = (p: ManifestPreset) => ['linear', 'radial', 'conical'].includes(p.distribution?.mode ?? '') && p.distribution?.scope !== 'within';
/** The instance with a recipe applied on the current selection. */
const applied = (p: ManifestPreset) => applyPresetOnSelection(props.modifier, props.manifest, p, props.selectionShape);

/** Thumbnail instance of a recipe (own preview id so state is not shared). */
function thumbInstance(p: ManifestPreset): ModifierInstance {
  return { ...applyPreset(props.modifier, props.manifest, p), id: `${props.modifier.id}:recipe:${p.id}`, strength: p.strength ?? 1 };
}

/** Draws the list's strips (~15 fps while open). */
function frame(now: number) {
  raf = requestAnimationFrame(frame);
  if (now - last < 1000 / 15) return;
  last = now;
  const c = sampleClock();
  presets.value.forEach((p, i) => {
    const g = canvases.value[i]?.getContext('2d');
    const r = g ? renderStrip(thumbInstance(p), COLS, { timeMs: c.timeMs, bpm: c.bpm, rankCount: props.rankCount || 8 }) : null;
    if (!g || !r) return;
    const img = g.createImageData(COLS, 1);
    for (let k = 0; k < COLS; k++) {
      const [red, green, blue] = previewRgb(r, k);
      img.data.set([red, green, blue, 255], k * 4);
    }
    g.putImageData(img, 0, 0);
  });
}

/** Previews the recipe at index i (−1 ends the preview). */
function highlight(i: number) {
  highlighted.value = i;
  const p = presets.value[i];
  emit('preview', p ? applied(p) : null);
}

/** Applies a recipe (one undo step) and closes the list. */
function choose(p: ManifestPreset) {
  lastApplied.value = p.id;
  emit('preview', null);
  emit('apply', applied(p), p);
  open.value = false;
}

/** ↺: back to the recipe the edits started from. */
function revert() {
  if (base.value) choose(base.value);
}

/** Arrow keys move the preview, Enter applies. */
function onKey(e: KeyboardEvent) {
  const n = presets.value.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const cur = highlighted.value >= 0 ? highlighted.value : presets.value.findIndex(p => p.id === base.value?.id);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    highlight(cur < 0 ? (step > 0 ? 0 : n - 1) : (cur + step + n) % n);
  }
  else if (e.key === 'Enter' && highlighted.value >= 0) {
    e.preventDefault();
    choose(presets.value[highlighted.value]!);
  }
}

watch(open, async (v) => {
  emit('dropdown-open-change', v);
  if (v) {
    highlighted.value = -1;
    await nextTick();
    raf = requestAnimationFrame(frame);
  }
  else {
    cancelAnimationFrame(raf);
    emit('preview', null);
  }
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  if (open.value) emit('preview', null);
});
</script>

<template>
  <div class="flex items-center gap-2" data-recipe-bar>
    <span class="w-14 shrink-0 text-[11px] text-muted-foreground">Preset</span>
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <button
          type="button"
          class="flex h-7 flex-1 min-w-0 items-center gap-1.5 rounded-md border border-input bg-transparent px-2 text-xs hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label="Preset" data-recipe-trigger
        >
          <span class="truncate" data-recipe-active>{{ base?.label ?? 'Custom' }}</span>
          <span v-if="modified" class="shrink-0 text-[10px] text-muted-foreground" data-recipe-modified>· modified</span>
          <ChevronDown class="ml-auto h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" :side-offset="4" class="w-[var(--reka-popover-trigger-width)] min-w-56 p-1" @keydown="onKey">
        <div role="listbox" aria-label="Presets" @pointerleave="highlight(-1)">
          <button
            v-for="(p, i) in presets"
            :key="p.id"
            type="button" role="option"
            class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors"
            :class="highlighted === i ? 'bg-muted' : 'hover:bg-muted/60'"
            :aria-selected="active?.id === p.id"
            :title="p.description ?? p.label"
            :data-recipe="p.id"
            @pointerenter="highlight(i)"
            @focus="highlight(i)"
            @click.stop="choose(p)"
          >
            <canvas :ref="el => { if (el) canvases[i] = el as HTMLCanvasElement }" :width="COLS" height="1" class="block w-14 h-3 shrink-0 rounded-sm bg-black" style="image-rendering: pixelated" aria-hidden="true" />
            <span class="flex-1 truncate">{{ p.label }}</span>
            <span v-if="is2d(p)" class="shrink-0 rounded border border-border/60 px-1 text-[9px] leading-tight text-muted-foreground" title="Spreads on the stage (Spatial 2D)">2D</span>
            <Check class="h-3.5 w-3.5 shrink-0" :class="active?.id === p.id ? 'opacity-100' : 'opacity-0'" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
    <button
      v-if="modified" type="button"
      class="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50"
      :title="`Back to ${base?.label}`" aria-label="Revert to preset" data-recipe-revert
      @click.stop="revert"
    >
      <RotateCcw class="h-3.5 w-3.5" />
    </button>
  </div>
</template>
