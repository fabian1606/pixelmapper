<script setup lang="ts">
/**
 * Hover preview of one version-history entry: shows what is special about
 * the version compared with its previous one (`highlights`, migration 015).
 * The most significant change is the default view (`highlight-ranking.ts`);
 * chips switch between the changed categories:
 *   live view → miniature of the affected live page (changed widgets marked),
 *   effect    → layout with the effect animated on its targets (preview pool),
 *   preset    → layout in the preset's colours,
 *   fixtures  → layout with added / moved / changed fixtures ringed.
 * First version / settings only / older server → plain layout. Loads on
 * mount and cancels the request on unmount (the panel mounts the card only
 * while the entry is shown), which also stops any animation.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { SnapshotListEntry } from '~/utils/sync/remote-api-snapshots';
import { absoluteTime, relativeTime } from '~/utils/sync/relative-time';
import { formatSummary, snapshotBadge } from '~/utils/sync/version-history';
import { fixtureMarks, highlightRings } from '~/utils/sync/version-preview/highlight-map';
import { fixturesCaption, planPreview, type PreviewView } from '~/utils/sync/version-preview/highlight-ranking';
import type { VersionPreview } from '~/utils/sync/version-preview/preview-controller';
import VersionEffectPreview from '~/components/sync/VersionEffectPreview.vue';
import VersionLayoutPreview from '~/components/sync/VersionLayoutPreview.vue';
import VersionLivePagePreview from '~/components/sync/VersionLivePagePreview.vue';
import VersionPresetPreview from '~/components/sync/VersionPresetPreview.vue';
import { LoaderCircle } from 'lucide-vue-next';

const props = withDefaults(defineProps<{
  preview: VersionPreview;
  entry: SnapshotListEntry;
  now: number;
  /** Diff base: the next older list entry (null → the server picks the neighbour). */
  compareToId?: string | null;
  /** `svg` skips the WebGL renderer (tests, forced fallback). */
  renderer?: 'auto' | 'svg';
}>(), { compareToId: null, renderer: 'auto' });

/** Preview viewport in CSS px. */
const WIDTH = 320;
const HEIGHT = 200;

const state = computed(() => props.preview.state(props.entry.id).value);
const model = computed(() => state.value.model);
const highlights = computed(() => state.value.highlights);
const plan = computed(() => planPreview(highlights.value));

/** Chip picked by the user (null = default view of the plan). */
const picked = ref<PreviewView | null>(null);
const view = computed<PreviewView>(() => picked.value ?? plan.value.view);
/** Last render time in ms (data attribute for measurements). */
const renderMs = ref<number | null>(null);
const renderMode = ref<'pending' | 'canvas' | 'svg'>('pending');

/** Rings of the fixtures view. */
const rings = computed(() => (view.value === 'fixtures' && model.value && highlights.value
  ? highlightRings(model.value, fixtureMarks(highlights.value.fixtures), WIDTH, HEIGHT)
  : []));

/** First effect highlight (added before changed, server order). */
const effect = computed(() => highlights.value?.effects.items[0] ?? null);

/** Text under the viewport of the layout-based views. */
const note = computed(() => {
  const h = highlights.value;
  if (view.value === 'none') return 'No changes to the project content.';
  if (plan.value.first) return 'First version';
  if (view.value === 'fixtures') return fixturesCaption(h?.categories.fixtures);
  if (view.value === 'effect' && !effect.value && h) {
    const removed = h.effects.removed.length;
    return removed ? `${removed} ${removed === 1 ? 'effect' : 'effects'} removed` : 'Effect details not available.';
  }
  if (view.value === 'layout') return plan.value.settingsNote;
  return '';
});

const caption = computed(() => {
  const ms = Date.parse(props.entry.createdAt);
  return {
    badge: snapshotBadge(props.entry.label).text,
    when: relativeTime(ms, props.now),
    absolute: absoluteTime(ms),
    summary: formatSummary(props.entry.summary),
  };
});

function onRendered(ms: number, mode: 'canvas' | 'svg'): void {
  renderMs.value = ms;
  renderMode.value = mode;
}

/** Selects the next / previous chip (keyboard: arrow keys on the focused entry). */
function cycle(delta: number): void {
  const kinds = plan.value.chips.map(c => c.kind);
  if (kinds.length < 2) return;
  const at = kinds.indexOf(view.value as typeof kinds[number]);
  picked.value = kinds[(at + delta + kinds.length) % kinds.length]!;
}

defineExpose({ cycle });

watch(() => props.compareToId, id => void props.preview.load(props.entry.id, id ?? null));
onMounted(() => { void props.preview.load(props.entry.id, props.compareToId ?? null); });
onBeforeUnmount(() => props.preview.cancel(props.entry.id));
</script>

<template>
  <div
    class="w-[338px] rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
    role="tooltip"
    :aria-label="`Preview of the version from ${caption.absolute}`"
    data-testid="version-preview-card"
    :data-render-ms="renderMs !== null ? renderMs.toFixed(1) : undefined"
    :data-render-mode="renderMode"
    :data-view="model ? view : undefined"
  >
    <div v-if="model && plan.chips.length" class="mb-1.5 flex flex-wrap gap-1" role="group" aria-label="Changes in this version">
      <button
        v-for="chip in plan.chips"
        :key="chip.kind"
        type="button"
        class="rounded-full border px-2 py-0.5 text-[10px] leading-4 transition-colors"
        :class="view === chip.kind ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'"
        :aria-pressed="view === chip.kind"
        :data-testid="`version-preview-chip-${chip.kind}`"
        @click="picked = chip.kind"
      >
        {{ chip.label }} <span class="tabular-nums opacity-70">{{ chip.count }}</span>
      </button>
    </div>

    <template v-if="model && highlights && view === 'live'">
      <VersionLivePagePreview :pages="highlights.live.pages" :removed-pages="highlights.live.removed" :width="WIDTH" :height="HEIGHT" />
    </template>
    <template v-else-if="model && highlights && view === 'effect' && effect">
      <VersionEffectPreview :model="model" :highlight="effect" :fixture-index="highlights.fixtureIndex" :width="WIDTH" :height="HEIGHT" />
      <p v-if="highlights.effects.items.length > 1" class="truncate text-[11px] text-muted-foreground">
        +{{ highlights.effects.items.length - 1 }} more changed effects
      </p>
    </template>
    <template v-else-if="model && highlights && view === 'preset'">
      <VersionPresetPreview
        :model="model"
        :items="highlights.presets.items"
        :removed="highlights.presets.removed"
        :fixture-index="highlights.fixtureIndex"
        :renderer="renderer"
      />
    </template>
    <template v-else>
      <div class="relative flex h-[200px] w-[320px] items-center justify-center overflow-hidden rounded bg-zinc-950">
        <VersionLayoutPreview v-if="model" :model="model" :renderer="renderer" :rings="rings" @rendered="onRendered" />
        <p v-else-if="state.status === 'offline'" class="text-[11px] text-zinc-400" data-testid="version-preview-offline">Preview needs a connection.</p>
        <p v-else-if="state.status === 'error'" class="text-[11px] text-zinc-400" data-testid="version-preview-error">{{ state.error }}</p>
        <LoaderCircle v-else :size="16" class="animate-spin text-zinc-400" aria-label="Loading preview" />
      </div>
    </template>
    <p v-if="model && note" class="mt-1 truncate text-[11px] text-muted-foreground" data-testid="version-preview-note">{{ note }}</p>
    <p v-if="model && highlights?.truncated" class="truncate text-[11px] text-muted-foreground">Some changes are not shown.</p>

    <p class="mt-1.5 truncate text-[11px] font-medium">{{ caption.badge }} · {{ caption.when }}</p>
    <p class="truncate text-[11px] text-muted-foreground">
      {{ caption.summary }}<template v-if="model?.hidden"> · {{ model.hidden }} more not shown</template>
    </p>
  </div>
</template>
