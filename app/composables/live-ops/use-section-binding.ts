import { computed } from 'vue';
import type { LiveWidget, LivePage } from '~/utils/live/types';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { useEngineStore } from '~/stores/engine-store';
import { findSectionFor, resolveSectionSource, memberKey, type SectionMembership } from '~/utils/live/sections';
import { getPresetMainColor } from '~/utils/engine/preset-color';
import { setActivePreset, pressFlashPreset, releaseFlashPreset } from '~/components/engine/composables/preset-activation';
import { setColorOverride, getEffectiveRGB } from '~/composables/live-ops/color-override-ops';
import type { Preset } from '~/utils/engine/preset-types';
import type { RGB } from '~/utils/live/color-utils';
import { getPresetNaturalRGB } from '~/utils/live/color-utils';

/** RGB within ±1 per channel (rounding tolerance from HSV→RGB conversions). */
function rgbEquals(a: RGB | null, b: RGB | null): boolean {
  if (!a || !b) return false;
  return Math.abs(a.r - b.r) <= 1 && Math.abs(a.g - b.g) <= 1 && Math.abs(a.b - b.b) <= 1;
}

export interface BoundSlot {
  membership: SectionMembership;
  preset: Preset;
  colorOverride?: RGB;
  /** Slot-specific label that overrides the preset name (e.g. color name for auto-color slots). */
  label?: string;
}

/**
 * Resolve a section-bound slot for a given widget / twin-control. Pure —
 * no reactive subscription. Use inside computed() to make reactive.
 */
export function findBoundPreset(
  page: LivePage,
  widgetId: string,
  controlId: string | undefined,
  savedPresets: Preset[],
  selectedPresetId: string | null,
): BoundSlot | null {
  const membership = findSectionFor(page, widgetId, controlId);
  if (!membership) return null;
  const slots = resolveSectionSource(membership.section.source, {
    savedPresets,
    selectedPresetId,
    slotCount: membership.total,
    storedColorVariants: membership.section.colorVariants,
  });
  const slot = slots[membership.index];
  if (!slot) return null;
  return { membership, preset: slot.preset, colorOverride: slot.colorOverride, label: slot.label };
}

function setActiveSet(
  liveStore: ReturnType<typeof useLiveModeStore>,
  sectionId: string,
  next: Set<string>,
) {
  const map = new Map(liveStore.activeSectionMembers);
  map.set(sectionId, next);
  liveStore.activeSectionMembers = map;
  // Broadcast latched state so other tabs mirror single-/multi-select sections.
  // Flash-mode press+release will fire this twice (active + empty); harmless.
  // Deferred to next microtask so the LiveBus dispatch doesn't sit in the
  // synchronous click handler that just kicked off the engine flush.
  const pageId = liveStore.activePageId;
  if (pageId) {
    const keys = Array.from(next);
    queueMicrotask(() => {
      useLiveBusStore().dispatch('section.setActive', {
        pageId,
        sectionId,
        keys,
      });
    });
  }
}

/**
 * Imperatively press / release a section member. Applies the resolved preset
 * and updates the section's runtime active-set per its mode.
 *
 * Returns true if the press was section-handled (caller should skip its own
 * widget-mapping dispatch); false if the widget isn't part of any section.
 */
export function sectionPress(args: {
  widgetId: string;
  controlId?: string;
}): boolean {
  const liveStore = useLiveModeStore();
  const engineStore = useEngineStore();
  const page = liveStore.activePage;
  if (!page) return false;
  const bound = findBoundPreset(
    page,
    args.widgetId,
    args.controlId,
    engineStore.savedPresets,
    engineStore.selectedPresetId,
  );
  if (!bound) return false;

  const key = memberKey({ widgetId: args.widgetId, controlId: args.controlId });
  const cur = liveStore.activeSectionMembers.get(bound.membership.section.id) ?? new Set<string>();
  const isAutoColor = bound.membership.section.source === 'color-variants'
    || (bound.membership.section.source as string) === 'auto-color-variants';
  const isFlash = bound.membership.section.mode === 'flash' || bound.preset.type === 'flash';

  if (isAutoColor) {
    // Color-variant slots don't switch presets — they override the active preset's base color.
    setActiveSet(liveStore, bound.membership.section.id, new Set([key]));
    setColorOverride(bound.preset.id, bound.colorOverride ?? null);
  } else if (isFlash) {
    const next = new Set(cur);
    next.add(key);
    setActiveSet(liveStore, bound.membership.section.id, next);
    pressFlashPreset(key, bound.preset.id);
  } else if (bound.membership.section.mode === 'single-select') {
    setActiveSet(liveStore, bound.membership.section.id, new Set([key]));
    setActivePreset(bound.preset.id);
  } else {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setActiveSet(liveStore, bound.membership.section.id, next);
    if (next.has(key)) setActivePreset(bound.preset.id);
  }
  return true;
}

export function sectionRelease(args: {
  widgetId: string;
  controlId?: string;
}): boolean {
  const liveStore = useLiveModeStore();
  const engineStore = useEngineStore();
  const page = liveStore.activePage;
  if (!page) return false;
  const bound = findBoundPreset(page, args.widgetId, args.controlId, engineStore.savedPresets, engineStore.selectedPresetId);
  if (!bound) return true;
  const { section } = bound.membership;
  const isFlash = section.mode === 'flash' || bound.preset.type === 'flash';
  // Single/multi-select sections without a flash preset stay latched on release.
  if (!isFlash) return true;
  const key = memberKey({ widgetId: args.widgetId, controlId: args.controlId });
  const cur = liveStore.activeSectionMembers.get(section.id) ?? new Set<string>();
  const next = new Set(cur);
  next.delete(key);
  setActiveSet(liveStore, section.id, next);
  releaseFlashPreset(key);
  return true;
}

/**
 * Reactive wrapper for canvas widgets (LiveButton). Provides label/color/
 * isActive derived from the section, plus press/release.
 */
export function useSectionBinding(args: {
  widget: () => LiveWidget;
  controlId?: () => string | undefined;
}) {
  const liveStore = useLiveModeStore();
  const engineStore = useEngineStore();

  const bound = computed(() => {
    const page = liveStore.activePage;
    if (!page) return null;
    const w = args.widget();
    return findBoundPreset(
      page,
      w.id,
      args.controlId?.(),
      engineStore.savedPresets,
      engineStore.selectedPresetId,
    );
  });

  const membership = computed(() => bound.value?.membership ?? null);
  const boundPreset = computed(() => bound.value?.preset ?? null);
  const effectiveLabel = computed(() => bound.value?.label ?? boundPreset.value?.name ?? null);
  const effectiveColor = computed(() => {
    const c = bound.value?.colorOverride;
    if (c) return `rgb(${c.r}, ${c.g}, ${c.b})`;
    return boundPreset.value ? getPresetMainColor(boundPreset.value) : null;
  });

  const myKey = computed(() => {
    const w = args.widget();
    return memberKey({ widgetId: w.id, controlId: args.controlId?.() });
  });

  const isActive = computed(() => {
    const m = membership.value;
    if (!m) return false;

    // Color-variants slots: derive active-state from current fixture color, not
    // from the latched activeSectionMembers — that way preset re-activation
    // (which resets fixture state to natural) automatically un-highlights the
    // slot and re-highlights "Preset (auto)".
    const source = m.section.source as string;
    if (source === 'color-variants' || source === 'auto-color-variants') {
      const preset = boundPreset.value;
      if (!preset) return false;
      const effective = getEffectiveRGB(preset, engineStore.flatFixtures);
      const slotRGB = bound.value?.colorOverride;
      if (!slotRGB) {
        // The "Preset (auto)" slot — active when the live color is natural.
        const natural = getPresetNaturalRGB(preset.id, engineStore.savedPresets);
        return rgbEquals(effective, natural);
      }
      return rgbEquals(effective, slotRGB);
    }

    return liveStore.activeSectionMembers.get(m.section.id)?.has(myKey.value) ?? false;
  });

  function press() {
    const w = args.widget();
    sectionPress({ widgetId: w.id, controlId: args.controlId?.() });
  }
  function release() {
    const w = args.widget();
    sectionRelease({ widgetId: w.id, controlId: args.controlId?.() });
  }

  return {
    membership,
    boundPreset,
    effectiveLabel,
    effectiveColor,
    isActive,
    press,
    release,
  };
}
