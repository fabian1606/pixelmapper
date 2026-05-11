<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { LiveWidget, LiveMapping } from '~/utils/live/types';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { useEngineStore } from '~/stores/engine-store';
import { useControllerStore } from '~/stores/controller-store';
import { getControllerDefinition } from '~/utils/controllers/catalog';
import { onWidgetTrigger, onWidgetSlide } from '~/composables/live-ops/live-widget-ops';
import { registerTwinState } from '~/composables/live-ops/twin-state-hub';
import { applyPreset } from '~/components/engine/composables/preset-apply';
import { resolvePreset } from '~/components/engine/composables/preset-resolve';
import type { ControlInputEvent, ControllerControl } from '~/utils/controllers/types';

const props = defineProps<{
  widget: LiveWidget;
  pageId: string;
  editMode: boolean;
}>();

const store = useLiveModeStore();
const liveBus = useLiveBusStore();
const engineStore = useEngineStore();
const controllerStore = useControllerStore();

const definition = computed(() =>
  props.widget.controllerKey ? getControllerDefinition(props.widget.controllerKey) : null,
);
const isSelectedTwin = computed(() => store.selectedWidgetIds.has(props.widget.id));

const host = ref<HTMLDivElement | null>(null);

// ── Reactive state ─────────────────────────────────────────────────────────
const pressedControls = ref<Set<string>>(new Set());
const faderValues     = ref<Map<string, number>>(new Map());

function setPressed(id: string, active: boolean) {
  const next = new Set(pressedControls.value);
  if (active) next.add(id); else next.delete(id);
  pressedControls.value = next;
}
function setFaderValue(id: string, v: number) {
  const next = new Map(faderValues.value);
  next.set(id, Math.max(0, Math.min(1, v)));
  faderValues.value = next;
}
function getChild(id: string) {
  return props.widget.controllerChildren?.find(c => c.controlId === id);
}

// ── Mapping dispatch ────────────────────────────────────────────────────────
function applyMapping(mapping: LiveMapping, active: boolean, value?: number) {
  if (mapping.type === 'preset' && mapping.presetId && active) {
    const presets = engineStore.savedPresets;
    const preset = presets.find((p: any) => p.id === mapping.presetId);
    if (preset) {
      const resolved = resolvePreset(preset, presets);
      applyPreset(resolved, engineStore.flatFixtures, engineStore.activeEffects);
      engineStore.triggerCanvasSync?.();
    }
  } else if (mapping.type === 'channel' && mapping.fixtureId != null && mapping.channelOffset != null) {
    const fixture = engineStore.flatFixtures.find((f: any) => f.id === mapping.fixtureId);
    const ch = fixture?.channels[mapping.channelOffset];
    if (ch) {
      ch.stepValues = [value !== undefined ? Math.round(value * 255) : (active ? 255 : 0)];
      engineStore.triggerCanvasSync?.();
    }
  } else if (mapping.type === 'page-switch' && mapping.targetPageId && active) {
    store.setActivePage(mapping.targetPageId);
  }
}

// ── SVG element registry (populated after v-html mounts) ───────────────────
type ButtonRig = { kind: 'button'; el: SVGGraphicsElement; origFill: string };
type SliderRig = {
  kind: 'slider';
  group: SVGGElement;
  knob: SVGGraphicsElement;
  rangeTopY: number;        // svg coords
  rangeBottomY: number;
  knobOriginY: number;
  knobHeight: number;
};
type Rig = ButtonRig | SliderRig;

const rigs = new Map<string, Rig>();
const cleanupFns: Array<() => void> = [];

function readFill(el: SVGGraphicsElement): string {
  return el.style.fill || el.getAttribute('fill') || '';
}

function applyButtonFill(id: string) {
  const rig = rigs.get(id);
  if (!rig || rig.kind !== 'button') return;
  if (pressedControls.value.has(id)) {
    const child = getChild(id);
    rig.el.style.fill = child?.color ?? '#ffffff';
  } else {
    rig.el.style.fill = rig.origFill;
  }
}

function applyKnob(id: string) {
  const rig = rigs.get(id);
  if (!rig || rig.kind !== 'slider') return;
  const v = faderValues.value.get(id) ?? 0;
  const targetTop = rig.rangeTopY + (1 - v) * (rig.rangeBottomY - rig.rangeTopY - rig.knobHeight);
  const dy = targetTop - rig.knobOriginY;
  rig.knob.setAttribute('transform', `translate(0 ${dy.toFixed(2)})`);
}

function applySelectionHighlight() {
  for (const [id, rig] of rigs) {
    const target = rig.kind === 'button' ? rig.el : rig.group;
    if (props.editMode && isSelectedTwin.value && store.selectedControlId === id) {
      target.classList.add('ctrl-selected');
    } else {
      target.classList.remove('ctrl-selected');
    }
  }
}

// ── Pointer → SVG-space coordinate ─────────────────────────────────────────
function clientToSvg(svg: SVGSVGElement, x: number, y: number): { x: number; y: number } {
  const pt = svg.createSVGPoint();
  pt.x = x; pt.y = y;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const m = pt.matrixTransform(ctm.inverse());
  return { x: m.x, y: m.y };
}

function valueFromSvgY(rig: SliderRig, svgY: number): number {
  const usableTop = rig.rangeTopY;
  const usableBottom = rig.rangeBottomY - rig.knobHeight;
  return 1 - Math.max(0, Math.min(1, (svgY - usableTop) / (usableBottom - usableTop)));
}

// ── Setup / teardown ────────────────────────────────────────────────────────
function teardown() {
  for (const fn of cleanupFns) fn();
  cleanupFns.length = 0;
  rigs.clear();
}

async function setup() {
  teardown();
  await nextTick();
  const def = definition.value;
  const svg = host.value?.querySelector('svg') as SVGSVGElement | null;
  if (!def || !svg) return;
  // Make the SVG capture pointer events (parent class sets pointer-events: auto).
  svg.style.pointerEvents = 'auto';

  for (const ctrl of def.controls) {
    if (!ctrl.svgId) continue;
    const el = svg.querySelector(`[id="${cssEscape(ctrl.svgId)}"]`) as SVGGraphicsElement | null;
    if (!el) continue;

    if (ctrl.type === 'button') wireButton(ctrl, el, svg);
    else if (ctrl.type === 'slider') wireSlider(ctrl, el as SVGGElement, svg);
  }

  applySelectionHighlight();
}

function cssEscape(s: string): string {
  // Minimal escape for IDs starting with digits (we'd already prefixed with _)
  // Keep CSS.escape if available, fall back to identity.
  // Wrapped in template since we use [id="..."] selector with quotes.
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function wireButton(ctrl: ControllerControl, el: SVGGraphicsElement, _svg: SVGSVGElement) {
  el.style.cursor = 'pointer';
  const origFill = readFill(el);
  rigs.set(ctrl.id, { kind: 'button', el, origFill });

  const onDown = (e: PointerEvent) => {
    if (props.editMode) return;
    e.stopPropagation();
    try { el.setPointerCapture(e.pointerId); } catch { /* noop */ }
    setPressed(ctrl.id, true);
    const child = getChild(ctrl.id);
    if (child) applyMapping(child.mapping, true);
    liveBus.dispatch('widget.trigger', {
      pageId: props.pageId, widgetId: props.widget.id, active: true, controlId: ctrl.id,
    });
    sendLedFeedback(ctrl.id, true);
  };
  const onUp = (e: PointerEvent) => {
    if (props.editMode) return;
    e.stopPropagation();
    if (!pressedControls.value.has(ctrl.id)) return;
    setPressed(ctrl.id, false);
    const child = getChild(ctrl.id);
    if (child) applyMapping(child.mapping, false);
    liveBus.dispatch('widget.trigger', {
      pageId: props.pageId, widgetId: props.widget.id, active: false, controlId: ctrl.id,
    });
    sendLedFeedback(ctrl.id, false);
  };
  const onClick = (e: MouseEvent) => {
    if (!props.editMode) return;
    e.stopPropagation();
    store.selectedWidgetIds = new Set([props.widget.id]);
    store.selectedControlId = ctrl.id;
  };

  el.addEventListener('pointerdown',  onDown);
  el.addEventListener('pointerup',    onUp);
  el.addEventListener('pointerleave', onUp);
  el.addEventListener('click',        onClick);
  cleanupFns.push(() => {
    el.removeEventListener('pointerdown',  onDown);
    el.removeEventListener('pointerup',    onUp);
    el.removeEventListener('pointerleave', onUp);
    el.removeEventListener('click',        onClick);
    el.style.fill = origFill;
    el.style.cursor = '';
    el.classList.remove('ctrl-selected');
  });
}

function wireSlider(ctrl: ControllerControl, group: SVGGElement, svg: SVGSVGElement) {
  const knob  = group.querySelector('g[id^="knob"], g[id*="knob"]') as SVGGraphicsElement | null;
  const range = group.querySelector('rect[id^="range"], rect[id*="range"]') as SVGGraphicsElement | null;
  if (!knob || !range) return;

  // Measure once. getBBox returns local bounds; for top-level fader groups
  // with no group transform, those equal SVG-viewBox coords.
  const knobBox  = knob.getBBox();
  const rangeBox = range.getBBox();
  const rig: SliderRig = {
    kind: 'slider',
    group,
    knob,
    rangeTopY:    rangeBox.y,
    rangeBottomY: rangeBox.y + rangeBox.height,
    knobOriginY:  knobBox.y,
    knobHeight:   knobBox.height,
  };
  rigs.set(ctrl.id, rig);
  group.style.cursor = 'ns-resize';
  // Make sure the housing path receives pointer events even on transparent areas of the group
  // (children paths already do; nothing extra needed).

  // Initial position from current state
  applyKnob(ctrl.id);

  let activePointerId: number | null = null;
  const dispatchSlide = (v: number) => {
    liveBus.dispatch('widget.slide', {
      pageId: props.pageId, widgetId: props.widget.id, controlId: ctrl.id, value: v,
    });
  };
  const onMoveDoc = (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    const { y } = clientToSvg(svg, e.clientX, e.clientY);
    const v = valueFromSvgY(rig, y);
    setFaderValue(ctrl.id, v);
    applyKnob(ctrl.id);
    const child = getChild(ctrl.id);
    if (child) applyMapping(child.mapping, true, v);
    dispatchSlide(v);
  };
  const onUpDoc = (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    document.removeEventListener('pointermove', onMoveDoc);
    document.removeEventListener('pointerup',   onUpDoc);
    document.removeEventListener('pointercancel', onUpDoc);
  };

  const onDown = (e: PointerEvent) => {
    if (props.editMode) return;
    e.stopPropagation();
    activePointerId = e.pointerId;
    const { y } = clientToSvg(svg, e.clientX, e.clientY);
    const v = valueFromSvgY(rig, y);
    setFaderValue(ctrl.id, v);
    applyKnob(ctrl.id);
    const child = getChild(ctrl.id);
    if (child) applyMapping(child.mapping, true, v);
    dispatchSlide(v);
    document.addEventListener('pointermove',   onMoveDoc);
    document.addEventListener('pointerup',     onUpDoc);
    document.addEventListener('pointercancel', onUpDoc);
  };
  const onClick = (e: MouseEvent) => {
    if (!props.editMode) return;
    e.stopPropagation();
    store.selectedWidgetIds = new Set([props.widget.id]);
    store.selectedControlId = ctrl.id;
  };

  group.addEventListener('pointerdown', onDown);
  group.addEventListener('click',       onClick);
  cleanupFns.push(() => {
    group.removeEventListener('pointerdown', onDown);
    group.removeEventListener('click',       onClick);
    document.removeEventListener('pointermove',   onMoveDoc);
    document.removeEventListener('pointerup',     onUpDoc);
    document.removeEventListener('pointercancel', onUpDoc);
    knob.removeAttribute('transform');
    group.style.cursor = '';
    group.classList.remove('ctrl-selected');
  });
}

// ── Reactive sync into the SVG ─────────────────────────────────────────────
watch(pressedControls, () => {
  for (const id of rigs.keys()) {
    const rig = rigs.get(id);
    if (rig?.kind === 'button') applyButtonFill(id);
  }
}, { deep: true });

watch(faderValues, () => {
  for (const id of rigs.keys()) {
    const rig = rigs.get(id);
    if (rig?.kind === 'slider') applyKnob(id);
  }
}, { deep: true });

watch(() => props.widget.controllerChildren, () => {
  // Color of a selected child changed → re-render any active button fills.
  for (const id of pressedControls.value) applyButtonFill(id);
}, { deep: true });

watch(
  [() => props.editMode, () => store.selectedControlId, isSelectedTwin],
  () => applySelectionHighlight(),
);

// ── Remote / physical input ────────────────────────────────────────────────
const offTrigger = onWidgetTrigger((pageId, widgetId, active, controlId) => {
  if (pageId !== props.pageId || widgetId !== props.widget.id || !controlId) return;
  setPressed(controlId, active);
});
onUnmounted(offTrigger);

const offSlide = onWidgetSlide((pageId, widgetId, value, _v2, controlId) => {
  if (pageId !== props.pageId || widgetId !== props.widget.id || !controlId) return;
  const rig = rigs.get(controlId);
  if (!rig || rig.kind !== 'slider') return;
  setFaderValue(controlId, value);
});
onUnmounted(offSlide);

let offDriverInput: (() => void) | null = null;
function attachDriver() {
  detachDriver();
  const driver = controllerStore.getBindingFor(props.widget.id);
  if (!driver) return;
  offDriverInput = driver.onInput((ev: ControlInputEvent) => {
    if (ev.type === 'press') {
      setPressed(ev.controlId, true);
      const child = getChild(ev.controlId);
      if (child) applyMapping(child.mapping, true);
      liveBus.dispatch('widget.trigger', { pageId: props.pageId, widgetId: props.widget.id, active: true, controlId: ev.controlId });
      sendLedFeedback(ev.controlId, true);
    } else if (ev.type === 'release') {
      setPressed(ev.controlId, false);
      const child = getChild(ev.controlId);
      if (child) applyMapping(child.mapping, false);
      liveBus.dispatch('widget.trigger', { pageId: props.pageId, widgetId: props.widget.id, active: false, controlId: ev.controlId });
      sendLedFeedback(ev.controlId, false);
    } else if (ev.type === 'value' && ev.value !== undefined) {
      setFaderValue(ev.controlId, ev.value);
      const child = getChild(ev.controlId);
      if (child) applyMapping(child.mapping, true, ev.value);
      liveBus.dispatch('widget.slide', {
        pageId: props.pageId, widgetId: props.widget.id, controlId: ev.controlId, value: ev.value,
      });
    }
  });
}
function detachDriver() {
  if (offDriverInput) { offDriverInput(); offDriverInput = null; }
}

function sendLedFeedback(controlId: string, active: boolean) {
  const driver = controllerStore.getBindingFor(props.widget.id);
  if (!driver) return;
  const child = getChild(controlId);
  const color = child?.color;
  if (color && active) {
    const rgb = parseHexColor(color);
    if (rgb) {
      driver.sendFeedback({ controlId, state: { type: 'rgb', ...rgb } });
      return;
    }
  }
  driver.sendFeedback({ controlId, state: active ? 'on' : 'off' });
}
function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
let offTwinState: (() => void) | null = null;
onMounted(() => {
  setup();
  attachDriver();
  offTwinState = registerTwinState({
    pageId: props.pageId,
    widgetId: props.widget.id,
    getPressed: () => Array.from(pressedControls.value),
    getFaderValues: () => Array.from(faderValues.value.entries()),
  });
});
onUnmounted(() => {
  teardown();
  detachDriver();
  offTwinState?.();
});
watch(() => definition.value?.svg, () => setup());
watch(() => controllerStore.bindings.get(props.widget.id), attachDriver);
</script>

<template>
  <div ref="host" class="w-full h-full relative overflow-hidden rounded" :class="editMode ? 'bg-neutral-900 border border-white/10' : ''">
    <div
      v-if="definition && definition.svg"
      class="absolute inset-0 svg-host"
      v-html="definition.svg"
    />
    <div
      v-else
      class="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground border border-dashed border-white/20"
    >
      <span v-if="widget.controllerKey">Missing: {{ widget.controllerKey }}</span>
      <span v-else>No controller selected</span>
    </div>
  </div>
</template>

<style scoped>
.svg-host :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
.svg-host :deep(.ctrl-selected) {
  filter: drop-shadow(0 0 1.5px #818cf8) drop-shadow(0 0 1.5px #818cf8);
}
</style>
