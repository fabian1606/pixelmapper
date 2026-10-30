<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from 'vue';
import type { LiveWidget } from '~/utils/live/types';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { useEngineStore } from '~/stores/engine-store';
import { onWidgetTrigger } from '~/composables/live-ops/live-widget-ops';
import { useSectionBinding } from '~/composables/live-ops/use-section-binding';
import { createDimmerState } from '~/composables/live-ops/apply-mapping';
import { hasPendingLongPress, isButtonActive, longPressProgress, pressButton, releaseButton } from '~/composables/live-ops/button-runtime';
import { appearanceLevel, autoColor, autoLabel, isAnimatedLook, sectionTrigger, triggerBadge } from '~/utils/live/button-actions';
import Replaceable from '~/components/extension-host/Replaceable.vue';

const props = defineProps<{
  widget: LiveWidget;
  pageId: string;
  editMode: boolean;
}>();

const liveBus = useLiveBusStore();
const engineStore = useEngineStore();

const pressed = ref(false);

const section = useSectionBinding({ widget: () => props.widget });

// Visual label/color: section binding wins when this widget is part of a section.
const displayLabel = computed(() =>
  section.effectiveLabel.value
  ?? (props.widget.label || autoLabel(props.widget.actions, engineStore.savedPresets))
  ?? 'Button',
);
const baseColor = computed(() =>
  section.effectiveColor.value
  ?? (props.widget.color || autoColor(props.widget.actions, engineStore.savedPresets))
  ?? '#334155',
);

/** Look: the section's shared one for members, the button's own otherwise. */
const appearance = computed(() => (section.membership.value ? section.membership.value.section.appearance : props.widget.appearance));

// Lit while held, while a section slot is active, or while one of its actions runs.
const visuallyActive = computed(() =>
  pressed.value || section.isActive.value || isButtonActive(props.widget.id, props.widget.actions),
);

// ── Animated look (blink / pulse) and long-press bar ────────────────────────
const now = ref(performance.now());
let raf = 0;
function tick() {
  now.value = performance.now();
  raf = requestAnimationFrame(tick);
}
/** Only animate while something actually moves. */
const needsFrames = computed(() =>
  (visuallyActive.value && isAnimatedLook(appearance.value)) || hasPendingLongPress(props.widget.id),
);
watch(needsFrames, (on) => {
  cancelAnimationFrame(raf);
  if (on) raf = requestAnimationFrame(tick);
}, { immediate: true });
onUnmounted(() => cancelAnimationFrame(raf));

const displayColor = computed(() => {
  const bpm = engineStore.engine?.globalBpm?.value ?? 120;
  const level = appearanceLevel(appearance.value, visuallyActive.value, now.value, bpm);
  if (level >= 1) return baseColor.value;
  return `color-mix(in srgb, ${baseColor.value} ${Math.round(level * 100)}%, #0a0a0a)`;
});

const longProgress = computed(() => longPressProgress(props.widget.id, now.value));

/** Small corner badge: which trigger kinds this button uses. */
const badge = computed(() => {
  const m = section.membership.value;
  if (m) return sectionTrigger(m.section) === 'hold' || section.boundPreset.value?.type === 'flash' ? '⚡' : '';
  return triggerBadge(props.widget.actions);
});

const offTrigger = onWidgetTrigger((pageId, widgetId, active) => {
  if (pageId === props.pageId && widgetId === props.widget.id) {
    pressed.value = active;
  }
});
onUnmounted(offTrigger);

const dimmerState = createDimmerState();

/** pm.button pressed. */
function onPress() {
  if (props.editMode) return;
  pressed.value = true;
  if (section.membership.value) section.press();
  else pressButton(props.widget.actions, { key: props.widget.id, dimmerState });
  liveBus.dispatch('widget.trigger', { pageId: props.pageId, widgetId: props.widget.id, active: true });
}

/** pm.button released. */
function onRelease() {
  if (props.editMode) return;
  pressed.value = false;
  if (section.membership.value) section.release();
  else releaseButton(props.widget.actions, { key: props.widget.id, dimmerState });
  liveBus.dispatch('widget.trigger', { pageId: props.pageId, widgetId: props.widget.id, active: false });
}
</script>

<template>
  <!-- pm.button; edit mode disables pointer interaction -->
  <Replaceable
    name="pm.button"
    :model-value="visuallyActive"
    :label="displayLabel"
    :color="displayColor"
    :class="editMode && 'pointer-events-none'"
    @press="onPress"
    @release="onRelease"
  >
    <span
      v-if="badge"
      class="absolute bottom-0.5 right-1 text-[9px] font-mono leading-none text-yellow-400 drop-shadow pointer-events-none"
    >{{ badge }}</span>
    <!-- Long press: fills along the bottom edge, primary once it fired -->
    <span
      v-if="longProgress !== null"
      class="absolute left-0 bottom-0 h-1 rounded-bl pointer-events-none bg-white/85"
      :style="{ width: `${longProgress * 100}%` }"
    />
  </Replaceable>
</template>
