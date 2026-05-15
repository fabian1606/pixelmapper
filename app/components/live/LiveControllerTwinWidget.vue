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
import { SetSectionMembersCommand } from '~/components/engine/commands/live-widget-commands';
import { useHistory } from '~/components/engine/composables/use-history';
import { findBoundPreset, sectionPress, sectionRelease } from '~/composables/live-ops/use-section-binding';
import { getPresetMainColor } from '~/utils/engine/preset-color';
import { memberKey, findSectionFor } from '~/utils/live/sections';
import { setActivePreset } from '~/components/engine/composables/preset-activation';
import type { ControlInputEvent, ControllerControl } from '~/utils/controllers/types';

const props = defineProps<{
  widget: LiveWidget;
  pageId: string;
  editMode: boolean;
}>();

const store = useLiveModeStore();
const liveBus = useLiveBusStore();
const engineStore = useEngineStore();
const history = useHistory();
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
    setActivePreset(mapping.presetId);
  } else if (mapping.type === 'channel' && mapping.fixtureId != null && mapping.channelOffset != null) {
    const fixture = engineStore.flatFixtures.find((f: any) => f.id === mapping.fixtureId);
    const ch = fixture?.channels[mapping.channelOffset];
    if (ch) {
      (ch as any).stepValues = [value !== undefined ? Math.round(value * 255) : (active ? 255 : 0)];
      engineStore.triggerCanvasSync?.();
    }
  } else if (mapping.type === 'page-switch' && mapping.targetPageId && active) {
    store.setActivePage(mapping.targetPageId);
  }
}

// ── SVG element registry (populated after v-html mounts) ───────────────────
type ButtonRig = {
  kind: 'button';
  el: SVGGraphicsElement;
  origFill: string;
  labelEl?: SVGTextElement;
  labelPosition: 'inside' | 'below';
};
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

function boundPresetFor(controlId: string) {
  const page = store.activePage;
  if (!page) return null;
  return findBoundPreset(
    page,
    props.widget.id,
    controlId,
    engineStore.savedPresets,
    engineStore.selectedPresetId,
  );
}

// Section the control belongs to (independent of whether a preset is bound).
function sectionFor(controlId: string): { sectionId: string } | null {
  const page = store.activePage;
  if (!page) return null;
  const m = findSectionFor(page, props.widget.id, controlId);
  return m ? { sectionId: m.section.id } : null;
}

function isSectionActive(controlId: string): boolean {
  const bound = boundPresetFor(controlId);
  if (!bound) return false;
  const key = memberKey({ widgetId: props.widget.id, controlId });
  return store.activeSectionMembers.get(bound.membership.section.id)?.has(key) ?? false;
}

/**
 * Pick the "bound color" for a control: section slot's color override wins
 * (auto-color-variants), then the preset's natural colour, then child override.
 */
function boundColorFor(id: string): string | null {
  const bound = boundPresetFor(id);
  if (bound) {
    const c = bound.colorOverride;
    if (c) return `rgb(${c.r}, ${c.g}, ${c.b})`;
    return getPresetMainColor(bound.preset);
  }
  return getChild(id)?.color ?? null;
}

function applyButtonFill(id: string) {
  const rig = rigs.get(id);
  if (!rig || rig.kind !== 'button') return;

  // Mapping mode override: paint section members solid yellow regardless of binding.
  if (props.editMode && store.sectionMappingMode) {
    const page = store.activePage;
    const sec = page?.sections?.find(s => s.id === store.sectionMappingMode);
    const isMember = sec?.members.some(m => m.widgetId === props.widget.id && m.controlId === id) ?? false;
    if (isMember) {
      rig.el.style.fill = '#facc15';
      rig.el.style.opacity = '1';
      rig.el.style.filter = '';
      return;
    }
  }

  const physicallyPressed = pressedControls.value.has(id);
  const sectionActive = isSectionActive(id);
  const active = physicallyPressed || sectionActive;
  const color = boundColorFor(id);
  if (color) {
    // Always show the bound color. Inactive = dimmed, active = full + glow.
    rig.el.style.fill = color;
    rig.el.style.opacity = active ? '1' : '0.35';
    rig.el.style.filter = active ? `drop-shadow(0 0 3px ${color})` : '';
  } else {
    // No section / no child color → restore the SVG's intrinsic look.
    rig.el.style.fill = rig.origFill;
    rig.el.style.opacity = '';
    rig.el.style.filter = '';
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

// The section to draw a bounding box around. Highlights in two cases:
//  (a) mapping mode → the section being mapped
//  (b) section is "selected" in the sidebar (selectedSectionId set)
function activeHighlightSectionId(): string | null {
  if (!props.editMode) return null;
  if (store.sectionMappingMode) return store.sectionMappingMode;
  if (store.selectedSectionId) return store.selectedSectionId;
  return null;
}

const SECTION_BBOX_ID = 'section-hl-bbox';

function applySectionBoundingBox() {
  const svg = host.value?.querySelector('svg') as SVGSVGElement | null;
  if (!svg) return;
  let rect = svg.getElementById(SECTION_BBOX_ID) as SVGRectElement | null;

  const sectionId = activeHighlightSectionId();
  const page = store.activePage;
  const sec = sectionId ? page?.sections?.find(s => s.id === sectionId) : null;
  if (!sec) { rect?.remove(); return; }

  // Collect bboxes of section-member rigs that live in this twin.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;
  for (const m of sec.members) {
    if (m.widgetId !== props.widget.id || !m.controlId) continue;
    const rig = rigs.get(m.controlId);
    if (!rig) continue;
    const el = rig.kind === 'button' ? rig.el : rig.group;
    const bb = el.getBBox();
    if (bb.width === 0 && bb.height === 0) continue;
    minX = Math.min(minX, bb.x);
    minY = Math.min(minY, bb.y);
    maxX = Math.max(maxX, bb.x + bb.width);
    maxY = Math.max(maxY, bb.y + bb.height);
    count++;
  }

  if (count === 0) { rect?.remove(); return; }

  if (!rect) {
    rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.id = SECTION_BBOX_ID;
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', '#facc15');
    rect.setAttribute('pointer-events', 'none');
    rect.setAttribute('rx', '2');
    rect.setAttribute('ry', '2');
    svg.appendChild(rect);
  }

  const vbW = svg.viewBox?.baseVal?.width || svg.clientWidth;
  const scale = svg.clientWidth > 0 ? vbW / svg.clientWidth : 1;
  const pad = 2.5 * scale;
  rect.setAttribute('x', (minX - pad).toString());
  rect.setAttribute('y', (minY - pad).toString());
  rect.setAttribute('width', (maxX - minX + pad * 2).toString());
  rect.setAttribute('height', (maxY - minY + pad * 2).toString());
  rect.setAttribute('stroke-width', (1.5 * scale).toString());
  rect.setAttribute('stroke-dasharray', `${3 * scale} ${2 * scale}`);
  rect.setAttribute('stroke-opacity', '0.9');
}

function applyAllSectionHighlights() {
  applySectionBoundingBox();
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
  applyAllSectionHighlights();
}

function cssEscape(s: string): string {
  // Minimal escape for IDs starting with digits (we'd already prefixed with _)
  // Keep CSS.escape if available, fall back to identity.
  // Wrapped in template since we use [id="..."] selector with quotes.
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Where the label sits relative to the control:
 * - Pads / scene-row buttons are large enough to fit text inside.
 * - Tiny utility buttons (track / scene side / shift) get the label below.
 */
function pickLabelPosition(ctrl: ControllerControl): 'inside' | 'below' {
  return ctrl.rect.w >= 25 && ctrl.rect.h >= 14 ? 'inside' : 'below';
}

/**
 * Label content for a control. Only surfaces a label when something is
 * actually bound — the definition's default ("Pad 0,0") is not shown so
 * unbound buttons stay clean. Manual child-label override is honored.
 */
function resolveLabelText(controlId: string, _ctrl: ControllerControl): string {
  const bound = boundPresetFor(controlId);
  if (bound) return bound.label ?? bound.preset.name ?? '';
  return getChild(controlId)?.label ?? '';
}

interface LabelMetrics {
  fontSize: number;
  lineHeight: number;
  maxLines: number;
  maxWidth: number;
}

function labelMetrics(ctrl: ControllerControl, position: 'inside' | 'below'): LabelMetrics {
  if (position === 'inside') {
    const fontSize = Math.min(ctrl.rect.h * 0.45, 7);
    const lineHeight = fontSize * 1.05;
    // How many full lines fit within the pad (with 2 SVG units of padding).
    const maxLines = Math.max(1, Math.floor((ctrl.rect.h - 2) / lineHeight));
    return { fontSize, lineHeight, maxLines, maxWidth: ctrl.rect.w - 2 };
  }
  // Below: small single line, allowed to spill slightly beyond the pad width.
  return { fontSize: 3.5, lineHeight: 4, maxLines: 1, maxWidth: ctrl.rect.w + 6 };
}

/**
 * Greedy word-wrap. Returns at most `maxLines` lines; the last line gets an
 * ellipsis if more text was dropped or a single line is still wider than
 * maxWidth (long unbreakable word).
 */
function wrapLines(text: SVGTextElement, raw: string, maxWidth: number, maxLines: number): string[] {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? current + ' ' + w : w;
    text.textContent = candidate;
    let len = 0;
    try { len = text.getComputedTextLength(); } catch { return [raw]; }
    if (len <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);

  const truncated = lines.length > maxLines;
  if (truncated) lines.length = maxLines;

  // Ellipsize any line that's wider than maxWidth, plus the last line when
  // text was dropped due to maxLines.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const needsEllipsis = truncated && i === lines.length - 1;
    text.textContent = line;
    let w = 0;
    try { w = text.getComputedTextLength(); } catch { continue; }
    if (w <= maxWidth && !needsEllipsis) continue;
    let lo = 0, hi = line.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      text.textContent = line.slice(0, mid) + '…';
      let mw = 0;
      try { mw = text.getComputedTextLength(); } catch { break; }
      if (mw <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    lines[i] = lo === 0 ? '…' : line.slice(0, lo) + '…';
  }
  return lines;
}

function layoutLabel(
  text: SVGTextElement,
  raw: string,
  metrics: LabelMetrics,
  cx: number,
  cy: number,
  centerVertically: boolean,
) {
  while (text.firstChild) text.removeChild(text.firstChild);
  text.textContent = '';
  if (!raw) return;

  const lines = wrapLines(text, raw, metrics.maxWidth, metrics.maxLines);
  text.textContent = '';
  text.setAttribute('dominant-baseline', centerVertically ? 'central' : 'hanging');

  // First-line y so that the block of lines is centered around cy (inside)
  // or starts at cy (below). lineHeight is between baselines.
  const firstY = centerVertically
    ? cy - ((lines.length - 1) * metrics.lineHeight) / 2
    : cy;

  const NS = 'http://www.w3.org/2000/svg';
  for (let i = 0; i < lines.length; i++) {
    const tspan = document.createElementNS(NS, 'tspan');
    tspan.setAttribute('x', cx.toString());
    tspan.setAttribute('y', (firstY + i * metrics.lineHeight).toString());
    tspan.textContent = lines[i]!;
    text.appendChild(tspan);
  }
}

function applyButtonLabel(id: string) {
  const rig = rigs.get(id);
  if (!rig || rig.kind !== 'button' || !rig.labelEl) return;
  const def = definition.value;
  const ctrl = def?.controls.find(c => c.id === id);
  if (!ctrl) return;
  const raw = resolveLabelText(id, ctrl);
  const metrics = labelMetrics(ctrl, rig.labelPosition);
  const cx = ctrl.rect.x + ctrl.rect.w / 2;
  if (rig.labelPosition === 'inside') {
    layoutLabel(rig.labelEl, raw, metrics, cx, ctrl.rect.y + ctrl.rect.h / 2, true);
  } else {
    layoutLabel(rig.labelEl, raw, metrics, cx, ctrl.rect.y + ctrl.rect.h + 4, false);
  }
}

function createButtonLabel(ctrl: ControllerControl, svg: SVGSVGElement, position: 'inside' | 'below'): SVGTextElement {
  const NS = 'http://www.w3.org/2000/svg';
  const text = document.createElementNS(NS, 'text');
  const cx = ctrl.rect.x + ctrl.rect.w / 2;
  text.setAttribute('x', cx.toString());
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('pointer-events', 'none');
  text.style.fontFamily = 'system-ui, -apple-system, sans-serif';
  text.style.fontWeight = '500';
  text.style.fill = 'rgba(255,255,255,0.85)';
  text.style.userSelect = 'none';
  if (position === 'inside') {
    const cy = ctrl.rect.y + ctrl.rect.h / 2;
    text.setAttribute('y', cy.toString());
    text.setAttribute('dominant-baseline', 'central');
    text.style.fontSize = `${Math.min(ctrl.rect.h * 0.45, 7).toFixed(2)}px`;
  } else {
    const cy = ctrl.rect.y + ctrl.rect.h + 4;
    text.setAttribute('y', cy.toString());
    text.setAttribute('dominant-baseline', 'hanging');
    text.style.fontSize = '3.5px';
  }
  svg.appendChild(text);
  return text;
}

function wireButton(ctrl: ControllerControl, el: SVGGraphicsElement, svg: SVGSVGElement) {
  el.style.cursor = 'pointer';
  const origFill = readFill(el);
  const labelPosition = pickLabelPosition(ctrl);
  const labelEl = createButtonLabel(ctrl, svg, labelPosition);
  rigs.set(ctrl.id, { kind: 'button', el, origFill, labelEl, labelPosition });
  applyButtonLabel(ctrl.id);
  applyButtonFill(ctrl.id);

  const onDown = (e: PointerEvent) => {
    if (props.editMode) return;
    e.stopPropagation();
    try { el.setPointerCapture(e.pointerId); } catch { /* noop */ }
    setPressed(ctrl.id, true);
    const sectionHandled = sectionPress({ widgetId: props.widget.id, controlId: ctrl.id });
    if (!sectionHandled) {
      const child = getChild(ctrl.id);
      if (child) applyMapping(child.mapping, true);
    }
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
    const sectionHandled = sectionRelease({ widgetId: props.widget.id, controlId: ctrl.id });
    if (!sectionHandled) {
      const child = getChild(ctrl.id);
      if (child) applyMapping(child.mapping, false);
    }
    liveBus.dispatch('widget.trigger', {
      pageId: props.pageId, widgetId: props.widget.id, active: false, controlId: ctrl.id,
    });
    sendLedFeedback(ctrl.id, false);
  };
  const onClick = (e: MouseEvent) => {
    if (!props.editMode) return;
    e.stopPropagation();

    // Mapping mode: toggle section membership for this control.
    if (store.sectionMappingMode) {
      const page = store.activePage;
      const sec = page?.sections?.find(s => s.id === store.sectionMappingMode);
      if (sec && store.activePageId) {
        const isMember = sec.members.some(m => m.widgetId === props.widget.id && m.controlId === ctrl.id);
        const next = isMember
          ? sec.members.filter(m => !(m.widgetId === props.widget.id && m.controlId === ctrl.id))
          : [...sec.members, { widgetId: props.widget.id, controlId: ctrl.id }];
        history.execute(new SetSectionMembersCommand(store.activePageId, sec.id, next));
      }
      return;
    }

    store.selectedWidgetIds = new Set([props.widget.id]);
    const inSec = sectionFor(ctrl.id);
    const alreadyIsolated = !!inSec && store.isolatedSectionId === inSec.sectionId;

    if (inSec && !alreadyIsolated) {
      store.selectedControlId = null;
      store.selectedSectionId = inSec.sectionId;
    } else {
      store.selectedControlId = ctrl.id;
      store.selectedSectionId = null;
      store.isolatedSectionId = null;
    }
  };

  const onDblClick = (e: MouseEvent) => {
    if (!props.editMode) return;
    e.stopPropagation();
    const inSec = sectionFor(ctrl.id);
    if (inSec) store.isolatedSectionId = inSec.sectionId;
    store.selectedWidgetIds = new Set([props.widget.id]);
    store.selectedControlId = ctrl.id;
    store.selectedSectionId = null;
  };

  el.addEventListener('pointerdown',  onDown);
  el.addEventListener('pointerup',    onUp);
  el.addEventListener('pointerleave', onUp);
  el.addEventListener('click',        onClick);
  el.addEventListener('dblclick',     onDblClick);
  cleanupFns.push(() => {
    el.removeEventListener('pointerdown',  onDown);
    el.removeEventListener('pointerup',    onUp);
    el.removeEventListener('pointerleave', onUp);
    el.removeEventListener('click',        onClick);
    el.removeEventListener('dblclick',     onDblClick);
    el.style.fill = origFill;
    el.style.opacity = '';
    el.style.filter = '';
    el.style.cursor = '';
    el.classList.remove('ctrl-selected');
    labelEl.remove();
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

    if (store.sectionMappingMode) {
      const page = store.activePage;
      const sec = page?.sections?.find(s => s.id === store.sectionMappingMode);
      if (sec && store.activePageId) {
        const isMember = sec.members.some(m => m.widgetId === props.widget.id && m.controlId === ctrl.id);
        const next = isMember
          ? sec.members.filter(m => !(m.widgetId === props.widget.id && m.controlId === ctrl.id))
          : [...sec.members, { widgetId: props.widget.id, controlId: ctrl.id }];
        history.execute(new SetSectionMembersCommand(store.activePageId, sec.id, next));
      }
      return;
    }

    store.selectedWidgetIds = new Set([props.widget.id]);
    const inSec = sectionFor(ctrl.id);
    const alreadyIsolated = !!inSec && store.isolatedSectionId === inSec.sectionId;
    if (inSec && !alreadyIsolated) {
      store.selectedControlId = null;
      store.selectedSectionId = inSec.sectionId;
    } else {
      store.selectedControlId = ctrl.id;
      store.selectedSectionId = null;
    }
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
  // Color / label of a child override changed → repaint that button.
  for (const id of rigs.keys()) {
    const rig = rigs.get(id);
    if (rig?.kind !== 'button') continue;
    applyButtonFill(id);
    applyButtonLabel(id);
  }
}, { deep: true });

// Section state changed (single/multi-select latching, or membership/source
// dynamic update) → re-render fills + labels + LEDs for every wired button so
// latched "active" state reflects in the SVG / on hardware even without a
// press event.
watch(
  [
    () => store.activeSectionMembers,
    () => store.activePage?.sections,
    () => engineStore.savedPresets,
    () => store.sectionMappingMode,
    () => props.editMode,
  ],
  () => {
    for (const id of rigs.keys()) {
      const rig = rigs.get(id);
      if (rig?.kind !== 'button') continue;
      applyButtonFill(id);
      applyButtonLabel(id);
      sendLedFeedback(id);
    }
  },
  { deep: true },
);

watch(
  [() => props.editMode, () => store.selectedControlId, isSelectedTwin],
  () => applySelectionHighlight(),
);

watch(
  [
    () => store.sectionMappingMode,
    () => store.selectedSectionId,
    () => store.activePage?.sections,
    () => props.editMode,
  ],
  () => applyAllSectionHighlights(),
  { deep: true },
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
  const driver = controllerStore.getBindingFor(props.widget.controllerInstanceId ?? '');
  if (!driver) return;
  offDriverInput = driver.onInput((ev: ControlInputEvent) => {
    if (ev.type === 'press') {
      setPressed(ev.controlId, true);
      const sectionHandled = sectionPress({ widgetId: props.widget.id, controlId: ev.controlId });
      if (!sectionHandled) {
        const child = getChild(ev.controlId);
        if (child) applyMapping(child.mapping, true);
      }
      liveBus.dispatch('widget.trigger', { pageId: props.pageId, widgetId: props.widget.id, active: true, controlId: ev.controlId });
      sendLedFeedback(ev.controlId, true);
    } else if (ev.type === 'release') {
      setPressed(ev.controlId, false);
      const sectionHandled = sectionRelease({ widgetId: props.widget.id, controlId: ev.controlId });
      if (!sectionHandled) {
        const child = getChild(ev.controlId);
        if (child) applyMapping(child.mapping, false);
      }
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

function sendLedFeedback(controlId: string, _active?: boolean) {
  const instanceId = props.widget.controllerInstanceId;
  const driver = instanceId ? controllerStore.getBindingFor(instanceId) : null;
  if (!driver) return;
  const physicallyPressed = pressedControls.value.has(controlId);
  const sectionActive = isSectionActive(controlId);
  const active = physicallyPressed || sectionActive;
  const bound = boundPresetFor(controlId);
  // LED feedback needs hex so it can be parsed downstream — emit hex for override RGB too.
  const sectionColor = bound
    ? (bound.colorOverride
        ? '#' + [bound.colorOverride.r, bound.colorOverride.g, bound.colorOverride.b]
            .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
        : getPresetMainColor(bound.preset))
    : null;
  const childColor = getChild(controlId)?.color;
  const color = sectionColor ?? childColor;
  if (color) {
    const rgb = parseHexColor(color);
    if (rgb) {
      if (active) {
        driver.sendFeedback({ controlId, state: { type: 'rgb', ...rgb } });
      } else {
        // Dimmed inactive state (~20% brightness), matching on-screen opacity 0.35.
        driver.sendFeedback({ controlId, state: { type: 'rgb', r: Math.round(rgb.r * 0.2), g: Math.round(rgb.g * 0.2), b: Math.round(rgb.b * 0.2) } });
      }
      return;
    }
  }
  driver.sendFeedback({ controlId, state: active ? 'on' : 'off' });
}
function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return { r: parseInt(m[1]!, 16), g: parseInt(m[2]!, 16), b: parseInt(m[3]!, 16) };
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
// Re-attach when the bound instance changes or the driver for that instance changes.
watch(() => controllerStore.drivers.get(props.widget.controllerInstanceId ?? ''), attachDriver);
watch(() => props.widget.controllerInstanceId, attachDriver);
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
