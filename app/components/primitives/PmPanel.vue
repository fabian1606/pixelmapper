<script setup lang="ts">
/**
 * Layout primitive: a panel (sidebar, overlay panel, dialog main area).
 *
 * Generates extension slots `<path>:header`, `:before` and `:after`
 * (ADR §5.3). Default placement inside the root: header, before, content,
 * after. Positions listed in `manual` are not auto-placed; render them
 * yourself via the slot props (`Header`, `Before`, `After`).
 */
import type { Component } from 'vue';
import { provideSlotPath } from '~/utils/extensions/slot-path';
import ExtensionSlot from '~/components/extension-host/ExtensionSlot.vue';
import { outletProps } from './slot-outlets';

type Position = 'header' | 'before' | 'after';

const props = withDefaults(defineProps<{
  /** Stable kebab-case id; becomes a slot path segment. */
  id: string;
  /** Root element/component. */
  as?: string | Component;
  /** Positions the caller places itself. */
  manual?: Position[];
}>(), { as: 'div', manual: () => [] });

defineSlots<{
  default?(p: { Header: Component; Before: Component; After: Component }): unknown;
}>();

provideSlotPath(() => props.id);

/** Slot props handed to the default slot. */
const outlets = outletProps(['header', 'before', 'after'] as const);

/** Whether a position is auto-placed. */
const auto = (p: Position) => !props.manual.includes(p);
</script>

<template>
  <component :is="as" :data-pm-panel="id">
    <ExtensionSlot v-if="auto('header')" position="header" />
    <ExtensionSlot v-if="auto('before')" position="before" />
    <slot v-bind="outlets" />
    <ExtensionSlot v-if="auto('after')" position="after" />
  </component>
</template>
