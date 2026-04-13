<script setup lang="ts">
import { computed } from 'vue';

/**
 * Renders an uploaded SVG inside a foreignObject so that regular HTML/CSS rendering
 * applies. Using v-html + foreignObject (instead of inline SVG DOM manipulation)
 * ensures that inline `style` attributes with CSS custom-properties like
 * `hsl(var(--primary))` are resolved by the browser at render time.
 *
 * All highlighting is baked into the serialized SVG string inside the computed,
 * then re-emitted as reactive HTML via v-html.
 */

const props = defineProps<{
  cx: number;
  cy: number;
  wPx: number;
  hPx: number;
  customSvgData: string;
  highlightedElementIds: string[];
  activeHeadKey: string;
  headToElementMap: Record<string, string>;
  hoveredElementId?: string | null;
  hoveredHeadKey?: string | null;
  errorMessage?: string | null;
  isPreviewingMapping?: boolean;
  suggestedMappingIds?: string[];
}>();

const emit = defineEmits<{
  (e: 'update:hoveredElementId', id: string | null): void;
  (e: 'assignElementToActiveHead', id: string): void;
}>();

// ── Style helpers ────────────────────────────────────────────────────────────

/**
 * Merges stroke-related style properties into an existing SVG element's style
 * attribute, preserving non-stroke properties.
 */
function applyStroke(
  el: Element,
  stroke: string,
  strokeWidth: string,
  strokeDasharray: string = '',
) {
  const existing = el.getAttribute('style') || '';
  // Strip only stroke-related declarations to avoid duplicates
  const base = existing
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('stroke'))
    .join('; ');

  const dash = strokeDasharray ? `; stroke-dasharray: ${strokeDasharray}` : '';
  el.setAttribute(
    'style',
    `${base}${base ? '; ' : ''}stroke: ${stroke}; stroke-width: ${strokeWidth}${dash}`,
  );
}

// ── Computed SVG string with baked-in highlights ─────────────────────────────

const processedSvgData = computed((): string | null => {
  if (!props.customSvgData) return null;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(props.customSvgData, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return props.customSvgData;

    const activeElementId = props.headToElementMap[props.activeHeadKey] ?? null;

    // 1. Assigned (but not active) — thin, dimmer stroke so they don't compete with the active element
    for (const id of props.highlightedElementIds) {
      if (id === activeElementId) continue; // Active handled separately below
      const el = doc.getElementById(id);
      if (el) applyStroke(el, '#4d4d4d', '1.5px'); // blue-400, lighter = less prominent
    }

    // 2. Active head element — thick solid bright stroke so selection is unambiguous
    if (activeElementId) {
      const el = doc.getElementById(activeElementId);
      if (el) applyStroke(el, '#3b82f6', '3.5px'); // blue-500, thick
    }

    // 3. Auto-map preview — dashed blue shown while hovering the Auto-Map button
    if (props.isPreviewingMapping && props.suggestedMappingIds) {
      for (const id of props.suggestedMappingIds) {
        const el = doc.getElementById(id);
        if (el) applyStroke(el, '#3b82f6', '2px', '5 3');
      }
    }

    // 4. Hover state — element under cursor OR element mapped to the hovered head row
    //    Applied last so it always overrides other states
    const sidebarHoverTarget = props.hoveredHeadKey
      ? (props.headToElementMap[props.hoveredHeadKey] ?? null)
      : null;
    const hoverTargetId = props.hoveredElementId || sidebarHoverTarget;

    if (hoverTargetId) {
      const el = doc.getElementById(hoverTargetId);
      if (el) {
        const isActive = hoverTargetId === activeElementId;
        const isAssigned = props.highlightedElementIds.includes(hoverTargetId);
        if (isActive) {
          // Brighten the already-thick active element slightly on hover
          applyStroke(el, '#2563eb', '4px'); // blue-600, slightly darker/thicker
        } else if (isAssigned) {
          // Bring assigned-but-not-active into full prominence on hover
          applyStroke(el, '#3b82f6', '2.5px');
        } else {
          // Unassigned: dashed gray outline — hints that it can be assigned
          applyStroke(el, '#6b7280', '2px', '4 2');
        }
      }
    }

    return new XMLSerializer().serializeToString(doc.documentElement);
  } catch {
    return props.customSvgData;
  }
});

// ── Event handling ────────────────────────────────────────────────────────────

/** Bubble mouseover events from inside v-html up as typed emissions. */
function handleMouseOver(e: MouseEvent) {
  const target = e.target as SVGElement;
  if (!target?.id) return;
  const tag = target.tagName.toLowerCase();
  if (['path', 'circle', 'rect', 'polygon', 'ellipse', 'line', 'polyline'].includes(tag)) {
    emit('update:hoveredElementId', target.id);
  }
}

function handleMouseLeave() {
  emit('update:hoveredElementId', null);
}

/** Click-to-assign: clicking a shape assigns it to the currently active head. */
function handleClick(e: MouseEvent) {
  const target = e.target as SVGElement;
  if (!target?.id) return;
  const tag = target.tagName.toLowerCase();
  if (['path', 'circle', 'rect', 'polygon', 'ellipse', 'line', 'polyline'].includes(tag)) {
    emit('assignElementToActiveHead', target.id);
  }
}
</script>

<template>
  <!-- foreignObject lets us use full browser HTML/CSS rendering inside the SVG canvas,
       which means CSS custom properties in inline style attrs resolve correctly. -->
  <g v-if="processedSvgData">
    <foreignObject :x="cx - wPx / 2" :y="cy - hPx / 2" :width="wPx" :height="hPx">
      <div
        xmlns="http://www.w3.org/1999/xhtml"
        class="w-full h-full custom-svg-container"
        v-html="processedSvgData"
        @mouseover="handleMouseOver"
        @mouseleave="handleMouseLeave"
        @click="handleClick"
      />
    </foreignObject>
  </g>

  <g v-if="errorMessage">
    <rect
      :x="cx - wPx / 2"
      :y="cy - hPx / 2"
      :width="wPx"
      :height="hPx"
      rx="6"
      fill="rgba(220,38,38,0.08)"
      stroke="rgba(220,38,38,0.35)"
    />
    <text
      :x="cx"
      :y="cy"
      text-anchor="middle"
      dominant-baseline="middle"
      fill="rgba(254,202,202,0.95)"
      font-size="12"
    >
      {{ errorMessage }}
    </text>
  </g>
</template>

<style>
/* Ensure the SVG fills the foreignObject container */
.custom-svg-container svg {
  width: 100%;
  height: 100%;
  pointer-events: all;
}
/* Show pointer cursor when hovering over interactive shapes */
.custom-svg-container *:not(svg):hover {
  cursor: pointer;
}
</style>
