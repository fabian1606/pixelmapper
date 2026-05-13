import { computed } from 'vue';
import type { LiveWidget, LivePage } from '~/utils/live/types';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { useEngineStore } from '~/stores/engine-store';
import { findSectionFor, resolveSectionSource, memberKey, type SectionMembership } from '~/utils/live/sections';
import { getPresetMainColor } from '~/utils/engine/preset-color';
import { resolvePreset } from '~/components/engine/composables/preset-resolve';
import { applyPreset } from '~/components/engine/composables/preset-apply';
import type { Preset } from '~/utils/engine/preset-types';

/**
 * Resolve a section-bound preset for a given widget / twin-control. Pure —
 * no reactive subscription. Use inside computed() to make reactive.
 */
export function findBoundPreset(
  page: LivePage,
  widgetId: string,
  controlId: string | undefined,
  savedPresets: Preset[],
  selectedPresetId: string | null,
): { membership: SectionMembership; preset: Preset } | null {
  const membership = findSectionFor(page, widgetId, controlId);
  if (!membership) return null;
  const source = resolveSectionSource(membership.section.source, { savedPresets, selectedPresetId });
  const preset = source[membership.index];
  if (!preset) return null;
  return { membership, preset };
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
  const pageId = liveStore.activePageId;
  if (pageId) {
    useLiveBusStore().dispatch('section.setActive', {
      pageId,
      sectionId,
      keys: Array.from(next),
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

  let shouldApply = false;
  if (bound.membership.section.mode === 'flash') {
    const next = new Set(cur);
    next.add(key);
    setActiveSet(liveStore, bound.membership.section.id, next);
    shouldApply = true;
  } else if (bound.membership.section.mode === 'single-select') {
    setActiveSet(liveStore, bound.membership.section.id, new Set([key]));
    shouldApply = true;
  } else {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setActiveSet(liveStore, bound.membership.section.id, next);
    shouldApply = next.has(key);
  }

  if (shouldApply) {
    const resolved = resolvePreset(bound.preset, engineStore.savedPresets);
    applyPreset(resolved, engineStore.flatFixtures, engineStore.activeEffects);
    engineStore.triggerCanvasSync?.();
  }
  return true;
}

export function sectionRelease(args: {
  widgetId: string;
  controlId?: string;
}): boolean {
  const liveStore = useLiveModeStore();
  const page = liveStore.activePage;
  if (!page) return false;
  const membership = findSectionFor(page, args.widgetId, args.controlId);
  if (!membership) return false;
  // Only flash mode clears on release; single/multi-select stay latched.
  if (membership.section.mode !== 'flash') return true;
  const key = memberKey({ widgetId: args.widgetId, controlId: args.controlId });
  const cur = useLiveModeStore().activeSectionMembers.get(membership.section.id) ?? new Set<string>();
  const next = new Set(cur);
  next.delete(key);
  setActiveSet(useLiveModeStore(), membership.section.id, next);
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
  const effectiveLabel = computed(() => boundPreset.value?.name ?? null);
  const effectiveColor = computed(() =>
    boundPreset.value ? getPresetMainColor(boundPreset.value) : null,
  );

  const myKey = computed(() => {
    const w = args.widget();
    return memberKey({ widgetId: w.id, controlId: args.controlId?.() });
  });

  const isActive = computed(() => {
    const m = membership.value;
    if (!m) return false;
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
