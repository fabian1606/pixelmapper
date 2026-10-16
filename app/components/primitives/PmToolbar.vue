<script setup lang="ts">
/**
 * Layout primitive: a toolbar.
 *
 * Generates extension slots `<path>:start` and `:end` (ADR §5.3), placed at
 * the start and end of the root by default. Positions listed in `manual` are
 * not auto-placed; render them yourself via the slot props (`Start`, `End`).
 */
import type { Component } from 'vue';
import { provideSlotPath } from '~/utils/extensions/slot-path';
import ExtensionSlot from '~/components/extension-host/ExtensionSlot.vue';
import { outletProps } from './slot-outlets';

type Position = 'start' | 'end';

const props = withDefaults(defineProps<{
  /** Stable kebab-case id; becomes a slot path segment. */
  id: string;
  /** Root element/component. */
  as?: string | Component;
  /** Positions the caller places itself. */
  manual?: Position[];
}>(), { as: 'div', manual: () => [] });

defineSlots<{
  default?(p: { Start: Component; End: Component }): unknown;
}>();

provideSlotPath(() => props.id);

/** Slot props handed to the default slot. */
const outlets = outletProps(['start', 'end'] as const);

/** Whether a position is auto-placed. */
const auto = (p: Position) => !props.manual.includes(p);
</script>

<template>
  <component :is="as" :data-pm-toolbar="id">
    <ExtensionSlot v-if="auto('start')" position="start" />
    <slot v-bind="outlets" />
    <ExtensionSlot v-if="auto('end')" position="end" />
  </component>
</template>
