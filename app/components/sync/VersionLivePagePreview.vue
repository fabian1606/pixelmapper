<script setup lang="ts">
/**
 * Live page miniature for the version-history hover preview: draws the most
 * changed live page (read-only, scaled to fit) with added widgets outlined in
 * emerald and changed ones in amber; unchanged widgets are dimmed. An added
 * page gets an emerald frame instead of per-widget outlines. Removed widgets
 * and pages are listed as text; several pages can be switched with arrows.
 */
import { computed, ref, watch } from 'vue';
import type { LivePageHighlight, RemovedEntity } from '~/utils/sync/version-preview/highlight-types';
import { layoutLivePage, livePageSummary, pickLivePages, removedPagesText, removedWidgetsText } from '~/utils/sync/version-preview/live-page-preview';
import { pageName } from '~/utils/sync/version-preview/live-page-text';
import VersionLiveWidgetGlyph from '~/components/sync/VersionLiveWidgetGlyph.vue';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';

const props = withDefaults(defineProps<{
  pages: LivePageHighlight[];
  removedPages?: RemovedEntity[];
  width?: number;
  height?: number;
}>(), { removedPages: () => [], width: 320, height: 200 });

/** Header / footer line heights reserved above / below the miniature. */
const HEADER = 16;
const FOOTER = 14;

const ordered = computed(() => pickLivePages(props.pages));
const index = ref(0);
watch(ordered, () => { index.value = 0; });
const current = computed(() => ordered.value[index.value] ?? null);

const removedText = computed(() => (current.value ? removedWidgetsText(current.value.removedWidgets) : ''));
const removedPages = computed(() => removedPagesText(props.removedPages));
const footerLines = computed(() => [removedText.value, removedPages.value].filter(Boolean));

/** Miniature area between header and footer. */
const area = computed(() => ({
  top: HEADER,
  height: Math.max(20, props.height - HEADER - FOOTER * Math.max(1, footerLines.value.length)),
}));

const layout = computed(() => (current.value
  ? layoutLivePage(current.value.page, props.width, area.value.height, current.value, 4)
  : null));

/** Per-widget outlines only for changed pages. */
const highlightWidgets = computed(() => current.value?.status === 'changed');

const summary = computed(() => {
  const parts = current.value ? [livePageSummary(current.value)] : [];
  if (removedPages.value) parts.push(removedPages.value);
  return parts.join('. ') || 'Live view changed';
});

/** Outline + glow classes by status. */
function statusClass(status: string): string {
  if (!highlightWidgets.value) return '';
  if (status === 'added') return 'z-10 outline outline-[1.5px] outline-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]';
  if (status === 'changed') return 'z-10 outline outline-[1.5px] outline-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]';
  return 'opacity-60';
}

/** Cycles pages (wraps around). */
function step(delta: number): void {
  const n = ordered.value.length;
  if (n > 1) index.value = (index.value + delta + n) % n;
}
</script>

<template>
  <div
    class="relative overflow-hidden bg-zinc-950 text-[11px] text-zinc-300"
    :style="{ width: `${width}px`, height: `${height}px` }"
    role="img"
    :aria-label="summary"
    data-testid="version-live-preview"
    :data-page-index="index"
  >
    <!-- Header: page name, status, pager -->
    <div class="absolute inset-x-1 top-0 flex h-4 items-center gap-1" aria-hidden="true">
      <span class="truncate font-medium text-zinc-200" data-testid="version-live-page-name">{{ current ? pageName(current) : 'Live view' }}</span>
      <span v-if="current" class="shrink-0 text-[10px]" :class="current.status === 'added' ? 'text-emerald-400' : 'text-amber-400'">{{ current.status }}</span>
      <span class="ml-auto flex shrink-0 items-center gap-1.5 text-[9px] text-zinc-400">
        <template v-if="highlightWidgets">
          <span class="flex items-center gap-0.5"><span class="size-1.5 rounded-full bg-emerald-400" />Added</span>
          <span class="flex items-center gap-0.5"><span class="size-1.5 rounded-full bg-amber-400" />Changed</span>
        </template>
      </span>
      <span v-if="ordered.length > 1" class="flex shrink-0 items-center text-[10px] text-zinc-400" data-testid="version-live-pager">
        <button type="button" class="pointer-events-auto rounded hover:text-zinc-100" aria-label="Previous page" tabindex="-1" @click.stop="step(-1)"><ChevronLeft :size="12" /></button>
        {{ index + 1 }}/{{ ordered.length }}
        <button type="button" class="pointer-events-auto rounded hover:text-zinc-100" aria-label="Next page" tabindex="-1" @click.stop="step(1)"><ChevronRight :size="12" /></button>
      </span>
    </div>

    <!-- Miniature (decorative, no interaction) -->
    <div class="pointer-events-none absolute inset-x-0" :style="{ top: `${area.top}px`, height: `${area.height}px` }" aria-hidden="true">
      <div
        v-if="layout"
        class="absolute overflow-hidden rounded-sm"
        :class="current?.status === 'added' ? 'ring-1 ring-emerald-400/80' : 'ring-1 ring-white/10'"
        :style="{ left: `${layout.offsetX}px`, top: `${layout.offsetY}px`, width: `${layout.width}px`, height: `${layout.height}px`, backgroundColor: layout.background }"
      >
        <div
          v-for="w in layout.widgets"
          :key="w.id"
          class="absolute rounded-[2px]"
          :class="statusClass(w.status)"
          :style="{ left: `${w.x}px`, top: `${w.y}px`, width: `${w.width}px`, height: `${w.height}px` }"
          :data-status="w.status"
          data-testid="version-live-widget"
        >
          <VersionLiveWidgetGlyph :widget="w" :font-px="layout.fontPx" />
        </div>
      </div>
      <p v-if="layout && !layout.widgets.length" class="absolute inset-0 flex items-center justify-center text-zinc-500">Empty page</p>
    </div>

    <!-- Footer: removed widgets / pages -->
    <div class="absolute inset-x-1 bottom-0" aria-hidden="true">
      <p v-for="line in footerLines" :key="line" class="h-3.5 truncate leading-[14px] text-rose-300/90" data-testid="version-live-removed">{{ line }}</p>
    </div>
  </div>
</template>
