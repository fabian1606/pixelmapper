<script setup lang="ts">
/**
 * Preset view of the hover preview card: the layout recoloured with the
 * preset's values (fixtures it does not touch dimmed), plus its name, swatch
 * and what it programs. Several presets → small pager.
 */
import { computed, ref } from 'vue';
import type { PresetHighlight, RemovedEntity } from '~/utils/sync/version-preview/highlight-types';
import { presetFixtureColors, recolorModel } from '~/utils/sync/version-preview/highlight-map';
import type { PreviewModel } from '~/utils/sync/version-preview/preview-model';
import { presetStatusText, presetSummary, presetSwatch } from '~/utils/sync/version-preview/preset-preview';
import VersionLayoutPreview from '~/components/sync/VersionLayoutPreview.vue';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';

const props = withDefaults(defineProps<{
  model: PreviewModel;
  items: PresetHighlight[];
  removed: RemovedEntity[];
  fixtureIndex: Record<string, number>;
  renderer?: 'auto' | 'svg';
}>(), { renderer: 'auto' });

const index = ref(0);
const item = computed(() => props.items[Math.min(index.value, props.items.length - 1)] ?? null);
/** Layout with the preset's colours (or the plain layout when only removals are known). */
const shownModel = computed(() => (item.value
  ? recolorModel(props.model, presetFixtureColors(item.value.preset, props.fixtureIndex))
  : props.model));

const removedText = computed(() => {
  if (!props.removed.length) return '';
  const names = props.removed.slice(0, 3).map(r => r.name || 'Unnamed');
  const more = props.removed.length - names.length;
  return `Removed: ${names.join(', ')}${more > 0 ? ` +${more} more` : ''}`;
});

/** Steps through the presets (wraps). */
function step(delta: number): void {
  const n = props.items.length;
  if (n > 1) index.value = (index.value + delta + n) % n;
}
</script>

<template>
  <div data-testid="version-preview-preset">
    <div class="overflow-hidden rounded bg-zinc-950">
      <VersionLayoutPreview :model="shownModel" :renderer="renderer" />
    </div>
    <div v-if="item" class="mt-1.5 flex items-center gap-1.5 text-[11px]">
      <span class="size-2.5 shrink-0 rounded-full border border-white/20" :style="{ background: presetSwatch(item.preset) }" aria-hidden="true" />
      <span class="truncate font-medium" data-testid="version-preview-preset-name">{{ item.preset.name || 'Unnamed preset' }}</span>
      <span class="shrink-0 text-muted-foreground">· {{ presetStatusText(item) }}</span>
      <span v-if="items.length > 1" class="ml-auto flex shrink-0 items-center">
        <button type="button" class="rounded p-0.5 hover:bg-muted" aria-label="Previous preset" @click="step(-1)"><ChevronLeft :size="12" /></button>
        <span class="tabular-nums text-muted-foreground">{{ index + 1 }}/{{ items.length }}</span>
        <button type="button" class="rounded p-0.5 hover:bg-muted" aria-label="Next preset" @click="step(1)"><ChevronRight :size="12" /></button>
      </span>
    </div>
    <p v-if="item" class="truncate text-[11px] text-muted-foreground">{{ presetSummary(item.preset) }}</p>
    <p v-if="removedText" class="truncate text-[11px] text-muted-foreground" data-testid="version-preview-preset-removed">{{ removedText }}</p>
  </div>
</template>
