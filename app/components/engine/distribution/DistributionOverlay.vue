<script setup lang="ts">
/**
 * Canvas overlay of the active modifier's distribution (plan M4.3, M4.4):
 * rank numbers on fixtures (same number for clusters), grouping colors, and
 * for scope `within` arrows along each multi-head fixture in head order.
 * Display only (pointer-events: none).
 */
import { computed } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { ModifierInstance } from '~/utils/engine/types';
import { resolveDistribution } from '~/utils/engine/distribution/resolve';
import { hasGrouping, sampleDistribution } from '~/utils/engine/distribution/sample';
import { beamWorldPx } from '~/utils/kinds/kind-host';
import { GROUP_COLORS } from './group-colors';
import { getManifest } from '~/utils/plugins/plugin-store';
import { rowOf, stepsLayout } from '~/utils/engine/distribution/param-groups';

const props = defineProps<{
  fixtures: Fixture[];
  modifier: ModifierInstance;
  worldWidth: number;
  worldHeight: number;
  worldToViewport: (wx: number, wy: number) => { x: number; y: number };
  /** Camera (reactive dependency for repositioning). */
  camera: { x: number; y: number; scale: number };
}>();

const d = computed(() => props.modifier.distribution);
const resolved = computed(() => resolveDistribution(props.modifier, props.fixtures));
/** Step-grid rows of the modifier (badge colors), if it has a steps param. */
const steps = computed(() => {
  const manifest = getManifest(props.modifier.plugin);
  return manifest ? stepsLayout(manifest.params, props.modifier.params) : null;
});
const showRanks = computed(() => (d.value.scope === 'across' && d.value.mode === 'order') || (d.value.scope === 'within' && d.value.withinOffset === 'order'));

/** Badge per targeted fixture: viewport position, rank label, group color. */
const badges = computed(() => {
  void props.camera.x; void props.camera.y; void props.camera.scale;
  if (!showRanks.value && !(hasGrouping(d.value) && d.value.scope === 'across' && d.value.mode !== 'none')) return [];
  return resolved.value.targeted.map((f) => {
    const fx = f as Fixture;
    const rank = resolved.value.ranks[String(f.id)] ?? -1;
    const s = sampleDistribution(d.value, resolved.value.rankCount, { x: fx.fixturePosition.x, y: fx.fixturePosition.y, fixtureRank: rank, head: 0, headCount: 1 });
    const row = steps.value ? rowOf(rank, resolved.value.rankCount, steps.value.rows, steps.value.blocks) : -1;
    const group = s.group >= 0 ? s.group : row;
    const p = props.worldToViewport(fx.fixturePosition.x * props.worldWidth, fx.fixturePosition.y * props.worldHeight);
    return {
      id: String(f.id), x: p.x, y: p.y,
      label: showRanks.value && rank >= 0 ? String(rank + 1) : '',
      color: group >= 0 ? GROUP_COLORS[group % GROUP_COLORS.length]! : 'var(--primary)',
    };
  });
});

/** Head-order arrows (scope within): first → last head of multi-head fixtures. */
const arrows = computed(() => {
  void props.camera.scale;
  if (d.value.scope !== 'within') return [];
  return resolved.value.targeted.flatMap((f) => {
    const fx = f as Fixture;
    if (fx.beams.length < 2) return [];
    const a = beamWorldPx(fx, fx.beams[0]!);
    const b = beamWorldPx(fx, fx.beams[fx.beams.length - 1]!);
    const pa = props.worldToViewport(a.x, a.y);
    const pb = props.worldToViewport(b.x, b.y);
    return d.value.reverse ? [{ id: String(f.id), a: pb, b: pa }] : [{ id: String(f.id), a: pa, b: pb }];
  });
});
</script>

<template>
  <div class="absolute inset-0 pointer-events-none" data-distribution-overlay>
    <svg v-if="arrows.length" class="absolute inset-0 w-full h-full">
      <defs>
        <marker id="dist-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L8 4 L0 8 Z" fill="var(--primary)" />
        </marker>
      </defs>
      <line
        v-for="a in arrows" :key="a.id"
        :x1="a.a.x" :y1="a.a.y" :x2="a.b.x" :y2="a.b.y"
        stroke="var(--primary)" stroke-width="1.5" stroke-opacity="0.8" marker-end="url(#dist-arrow)"
      />
    </svg>
    <div
      v-for="b in badges" :key="b.id"
      class="absolute -translate-x-1/2 -translate-y-1/2 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold leading-4 text-center text-white shadow ring-1 ring-black/40"
      :style="{ left: `${b.x}px`, top: `${b.y - 14}px`, background: b.color }"
      :data-rank-badge="b.id"
    >
      {{ b.label }}
    </div>
  </div>
</template>
