<script setup lang="ts">
/**
 * One modifier card (plan M5.6, revised after review). Order: header ·
 * live strip (every modifier) · recipes (every modifier) · editors and
 * primary params · "More" (advanced params, blend mode) · distribution ·
 * channels (only with several channel types) · strength and speed last.
 */
import { computed, onBeforeUnmount, shallowRef } from 'vue';
import { AlertTriangle, Loader2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import type { Component } from 'vue';
import type { BlendMode, ChannelType, ModifierInstance } from '~/utils/engine/types';
import { getManifest, getPackage, pluginStatus } from '~/utils/plugins/plugin-store';
import { resolveDistribution } from '~/utils/engine/distribution/resolve';
import { useModifierPhase } from '~/composables/engine/use-modifier-phase';
import { useEngineStore } from '~/stores/engine-store';
import type { Fixture } from '~/utils/engine/core/fixture';
import { fixtureBaseColor, hueSat } from '~/utils/engine/fixture-color';
import { previewRevision, renderTraces } from '~/utils/plugins/preview-pool';
import type { SelectionShape } from '~/utils/engine/distribution/selection-shape';
import { distributionForParams } from '~/utils/engine/option-distribution';
import type { ParamValue } from '@pixelmapper/extension-api';
import ModifierCardHeader from './ModifierCardHeader.vue';
import ModifierCardMore from './ModifierCardMore.vue';
import ModifierGenericFields from '../ModifierGenericFields.vue';
import DistributionSection from '../distribution/DistributionSection.vue';
import ParamForm from '~/components/plugin-host/ParamForm.vue';
import RecipeBar from '~/components/plugin-host/RecipeBar.vue';
import EndlessStrip from '~/components/plugin-host/EndlessStrip.vue';
import PluginIframePanel from '~/components/plugin-host/PluginIframePanel.vue';

const props = defineProps<{
  modifier: ModifierInstance;
  availableChannelTypes: ChannelType[];
  pinned: boolean;
  selectionShape?: SelectionShape;
  badges: Component;
  actions: Component;
}>();

const emit = defineEmits<{
  /** Several fields changed as one step (`continuous` edits are coalesced). */
  patch: [updates: Partial<ModifierInstance>, description: string, continuous?: boolean];
  /** One field changed continuously (params, speed, strength). */
  update: [key: string, value: unknown];
  dragEnd: [description: string];
  toggleChannel: [type: ChannelType];
  switch: [plugin: string];
  pin: [];
  remove: [];
  retry: [];
  'dropdown-open-change': [open: boolean];
  /** Mousedown on the header (drag to reorder). */
  dragStart: [event: MouseEvent];
}>();

const engineStore = useEngineStore();
const manifest = computed(() => getManifest(props.modifier.plugin));
const status = computed(() => pluginStatus(props.modifier.plugin));
const resolved = computed(() => resolveDistribution(props.modifier, engineStore.flatFixtures));
const { position, timePhase } = useModifierPhase(() => props.modifier);

/** Custom panel of the plugin, if it ships one. */
const panel = computed(() => {
  const uiJs = getPackage(props.modifier.plugin)?.uiJs;
  return manifest.value?.ui && uiJs ? { manifest: manifest.value, uiJs, placement: manifest.value.ui.placement ?? 'below-params' } : null;
});

/** Raw traces of the instance for the noise history editor (preview pool). */
const traces = (count: number, points: number, cycles: number) => {
  void previewRevision.value;
  return renderTraces(props.modifier, count, points, cycles);
};

/** Hue of the first targeted fixture's programmed color (hue strip center). */
const baseHue = computed(() => {
  const f = resolved.value.targeted[0];
  const c = f ? fixtureBaseColor(f as Fixture) : null;
  return c ? Math.round(hueSat(c).hue) : 0;
});
/** Recipe under the pointer in the preset list: shown in the live strip and on the fixtures, never saved. */
const recipePreview = shallowRef<ModifierInstance | null>(null);
function onRecipePreview(m: ModifierInstance | null) {
  recipePreview.value = m;
  engineStore.setModifierPreview(m);
}
onBeforeUnmount(() => { if (recipePreview.value) engineStore.setModifierPreview(null); });

/**
 * A param edit; when it picks an option that needs another distribution
 * (manifest `optionDistribution`), both change as one step.
 */
function onParams(v: Record<string, ParamValue>) {
  const d = manifest.value && distributionForParams(manifest.value, props.modifier.params, v, props.modifier.distribution, props.selectionShape);
  if (d) emit('patch', { params: v, distribution: d }, 'Update Modifier Params');
  else emit('update', 'params', v);
}

const beats = computed(() => (props.modifier.speed.mode === 'beat' ? props.modifier.speed.beatValue : 0));
</script>

<template>
  <div class="flex flex-col">
    <ModifierCardHeader
      :modifier="modifier" :pinned="pinned" :badges="badges" :actions="actions"
      @switch="p => emit('switch', p)" @pin="emit('pin')" @remove="emit('remove')"
      @dropdown-open-change="v => emit('dropdown-open-change', v)"
      @mousedown="(e: MouseEvent) => emit('dragStart', e)"
    />
    <div class="p-3 flex flex-col gap-4">
      <div v-if="status.state === 'pending'" class="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 class="h-3.5 w-3.5 animate-spin" /> Loading plugin…
      </div>
      <div v-else-if="status.state === 'error'" class="flex items-start gap-2 text-xs text-destructive">
        <AlertTriangle class="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span class="flex-1">Plugin unavailable: {{ (status as { error: string }).error }}</span>
        <Button variant="outline" size="sm" class="h-6 text-[11px]" @click="emit('retry')">Retry</Button>
      </div>
      <template v-if="manifest">
        <EndlessStrip :modifier="recipePreview ?? modifier" :rank-count="resolved.ticks" />
        <RecipeBar
          :modifier="modifier" :manifest="manifest" :rank-count="resolved.ticks" :selection-shape="selectionShape"
          @preview="onRecipePreview" @dropdown-open-change="v => emit('dropdown-open-change', v)"
          @apply="(next, p) => emit('patch', { params: next.params, speed: next.speed, distribution: next.distribution, strength: next.strength }, `Recipe: ${p.label}`)"
        />
        <PluginIframePanel
          v-if="panel && panel.placement === 'above-params'"
          :modifier="modifier" :manifest="panel.manifest" :ui-js="panel.uiJs"
          @update:params="v => emit('update', 'params', v)" @scrub-end="emit('dragEnd', 'Update Modifier Params')"
        />
        <ParamForm
          v-if="panel?.placement !== 'replace-params'"
          :schema="manifest.params" :model-value="modifier.params" :editors="manifest.editors"
          :more-key="manifest.alias" :distribution-mode="modifier.distribution.mode"
          :ticks="resolved.ticks" :beats="beats" :playhead="position" :time-phase="modifier.speed.mode === 'infinite' ? null : timePhase"
          :editor-context="{ rankCount: resolved.ticks, baseHue, traces }"
          @update:model-value="onParams" @scrub-end="emit('dragEnd', 'Update Modifier Params')"
        >
          <template #more>
            <ModifierCardMore :blend-mode="modifier.blendMode" @update="(b: BlendMode) => emit('patch', { blendMode: b }, 'Change Blend Mode')" @dropdown-open-change="v => emit('dropdown-open-change', v)" />
          </template>
        </ParamForm>
        <PluginIframePanel
          v-if="panel && panel.placement !== 'above-params'"
          :modifier="modifier" :manifest="panel.manifest" :ui-js="panel.uiJs"
          @update:params="v => emit('update', 'params', v)" @scrub-end="emit('dragEnd', 'Update Modifier Params')"
        />
      </template>
      <div class="pt-3 border-t border-border/40">
        <DistributionSection
          :modifier-id="modifier.id" :distribution="modifier.distribution" :options="manifest?.distribution" :selection-axis="selectionShape?.axis"
          @update="(d, desc) => emit('patch', { distribution: d }, desc)"
          @dropdown-open-change="v => emit('dropdown-open-change', v)"
        />
      </div>
      <div v-if="availableChannelTypes.length > 1" class="flex flex-col gap-2 pt-3 border-t border-border/40" data-card-channels>
        <span class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Channels</span>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="type in availableChannelTypes" :key="type" type="button"
            class="px-2.5 py-1 text-[11px] font-medium rounded-md border transition-all"
            :class="[
              modifier.targetChannels.includes(type) ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20' : 'bg-transparent text-muted-foreground border-border hover:border-muted-foreground/50 hover:bg-muted/30',
              (modifier.targetChannels.includes(type) && modifier.targetChannels.length <= 1) ? 'opacity-50 cursor-not-allowed' : '',
            ]"
            :disabled="modifier.targetChannels.includes(type) && modifier.targetChannels.length <= 1"
            @click.stop="emit('toggleChannel', type)"
          >
            {{ type }}
          </button>
        </div>
      </div>
      <div class="pt-3 border-t border-border/40" data-card-tempo>
        <ModifierGenericFields
          :modifier="modifier"
          @update="(k, v) => emit('update', k, v)"
          @update-properties="(u, d) => emit('patch', u, d)"
          @drag-end="d => emit('dragEnd', d)"
          @dropdown-open-change="v => emit('dropdown-open-change', v)"
        />
      </div>
    </div>
  </div>
</template>
