<script setup lang="ts">
/**
 * Core default of `pm.curve` v2 (plan M2): a curve editor with programmatic
 * shapes whose args are handles (`CurveShapeHandles`), free points
 * (`CurveFreePoints`), a shape bar, fixture/beat ticks, a playhead and an
 * optional endless-strip slot. Visual language of the former WaveformEditor.
 */
import { computed, ref, watch } from 'vue';
import { isFreeCurve, isShapeCurve, type CurveEmits, type CurvePointV2, type CurveProps, type CurveShapeValue } from '@pixelmapper/extension-api';
import { clampArgs, defaultArgs, domainT, evaluateCurve, getShape, shapeToPoints } from '~/utils/params/curve-shapes';
import { ACCENT, HEIGHTS, PAD_Y, SVG_H, SVG_W, polylineOf, svgY, tickPositions } from './curve/curve-geometry';
import CurveShapeBar from './curve/CurveShapeBar.vue';
import CurveShapeHandles from './curve/CurveShapeHandles.vue';
import CurveFreePoints from './curve/CurveFreePoints.vue';
import CurveArgSteppers from './curve/CurveArgSteppers.vue';

const props = withDefaults(defineProps<CurveProps>(), {
  disabled: false, size: 'md', yMax: 1, allowFree: true, domain: 'cycle', axis: 'none', ticks: 0, range: 'unipolar', playhead: null, strip: false,
});
const emit = defineEmits<CurveEmits>();

const boxRef = ref<HTMLElement | null>(null);
const getRect = () => boxRef.value?.getBoundingClientRect();

const ctx = computed(() => ({ ticks: props.ticks ?? 0 }));
const shapeValue = computed<CurveShapeValue | null>(() => (isShapeCurve(props.modelValue) ? props.modelValue : null));
const freePoints = computed<CurvePointV2[]>(() => (isFreeCurve(props.modelValue) ? props.modelValue.points : Array.isArray(props.modelValue) ? props.modelValue : []));
const offered = computed(() => props.shapes ?? []);

/** Last programmatic value (session state) for "Back to shape". */
const lastShape = ref<CurveShapeValue | null>(shapeValue.value);
watch(shapeValue, (v) => { if (v) lastShape.value = v; });

const tickXs = computed(() => tickPositions(props.axis, props.domain, props.ticks ?? 0));
const polyline = computed(() => polylineOf(props.domain, x => evaluateCurve(props.modelValue, x, ctx.value, props.domain)));

/** Shaded region of hold-like shapes (the `pause` at the end of the cycle). */
const inactive = computed(() => {
  const v = shapeValue.value;
  const pause = v && getShape(v.shape)?.args.some(a => a.key === 'pause') ? clampArgs(getShape(v.shape)!, v.args).pause! : 0;
  return pause > 0 ? { x: (1 - pause) * SVG_W, w: pause * SVG_W } : null;
});

/** Emits a discrete change as one undo step. */
function commit(v: CurveProps['modelValue']) {
  emit('scrubStart');
  emit('update:modelValue', v);
  emit('scrubEnd');
}

/** Switches to a shape, keeping peak/floor and args with the same key. */
function selectShape(id: string) {
  const def = getShape(id);
  if (!def) return;
  const prev = shapeValue.value?.args ?? lastShape.value?.args ?? {};
  const args = defaultArgs(def);
  for (const k of Object.keys(args)) if (k in prev) args[k] = prev[k]!;
  commit({ shape: id, args });
}

/** Converts the current curve to free points. */
function toFree() {
  if (!shapeValue.value) return;
  commit({ points: shapeToPoints(props.modelValue, ctx.value, props.domain) });
}

/** Restores the last programmatic value. */
function backToShape() {
  if (lastShape.value) commit(lastShape.value);
}

const updateArgs = (args: Record<string, number>) => emit('update:modelValue', { shape: shapeValue.value!.shape, args });
const updatePoints = (points: CurvePointV2[]) => emit('update:modelValue', { points });
</script>

<template>
  <div class="flex flex-col gap-1.5" :class="disabled && 'opacity-50 pointer-events-none'">
    <div v-if="label" class="flex items-center justify-between text-xs text-muted-foreground">
      <span class="truncate">{{ label }}</span>
      <span v-if="axis === 'fixtures' && ticks" class="text-[10px] shrink-0">ticks = fixtures</span>
      <span v-else-if="yMax !== 1" class="font-mono text-[10px] shrink-0">0–{{ yMax }}</span>
    </div>
    <CurveShapeBar
      v-if="offered.length"
      :shapes="offered" :active="shapeValue?.shape ?? null" :allow-free="allowFree"
      :domain="domain" :ticks="ticks ?? 0" :disabled="disabled"
      @select="selectShape" @free="toFree"
    />
    <div ref="boxRef" class="relative rounded-md border border-border/60 bg-muted/10 select-none" :style="{ height: `${HEIGHTS[size]}px` }">
      <svg :viewBox="`0 0 ${SVG_W} ${SVG_H}`" preserveAspectRatio="none" class="absolute inset-0 w-full h-full block" role="img" :aria-label="label ?? 'Curve'">
        <line v-if="range === 'bipolar' || domain === 'signed'" :x1="range === 'bipolar' ? 0 : SVG_W / 2" :y1="range === 'bipolar' ? svgY(0.5) : PAD_Y" :x2="range === 'bipolar' ? SVG_W : SVG_W / 2" :y2="range === 'bipolar' ? svgY(0.5) : SVG_H - PAD_Y" stroke="currentColor" stroke-opacity="0.1" stroke-width="1" vector-effect="non-scaling-stroke" />
        <line v-for="t in tickXs" :key="t" :x1="domainT(domain, t) * SVG_W" :y1="SVG_H - 3" :x2="domainT(domain, t) * SVG_W" :y2="SVG_H" stroke="currentColor" stroke-opacity="0.25" stroke-width="1" vector-effect="non-scaling-stroke" />
        <rect v-if="inactive" :x="inactive.x" y="0" :width="inactive.w" :height="SVG_H" fill="currentColor" fill-opacity="0.04" />
        <polyline :points="polyline" fill="none" :stroke="ACCENT" stroke-opacity="0.9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
        <line v-if="playhead != null" :x1="domainT(domain, playhead) * SVG_W" y1="0" :x2="domainT(domain, playhead) * SVG_W" :y2="SVG_H" stroke="currentColor" stroke-opacity="0.5" stroke-width="1" vector-effect="non-scaling-stroke" data-playhead />
      </svg>
      <CurveShapeHandles
        v-if="shapeValue"
        :value="shapeValue" :domain="domain" :ticks="tickXs" :get-rect="getRect" :disabled="disabled"
        @update="updateArgs" @scrub-start="emit('scrubStart')" @scrub-end="emit('scrubEnd')"
      />
      <CurveFreePoints
        v-else
        :points="freePoints" :domain="domain" :ticks="tickXs" :get-rect="getRect" :disabled="disabled"
        @update="updatePoints" @scrub-start="emit('scrubStart')" @scrub-end="emit('scrubEnd')"
      />
    </div>
    <div v-if="shapeValue || (lastShape && allowFree)" class="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
      <CurveArgSteppers v-if="shapeValue" :value="shapeValue" :disabled="disabled" @update="a => commit({ shape: shapeValue!.shape, args: a })" />
      <button v-if="shapeValue && allowFree && !offered.length" type="button" class="underline-offset-2 hover:underline" @click="toFree">Edit points</button>
      <button v-if="!shapeValue && lastShape" type="button" class="underline-offset-2 hover:underline" @click="backToShape">Back to shape</button>
    </div>
    <slot v-if="strip" name="strip" />
  </div>
</template>
