<script setup lang="ts">
/**
 * Layout primitive: one row in a list or tree (fixture sidebar nodes,
 * modifier list, …).
 *
 * Generates extension slots `<path>:badges` and `:actions` (ADR §5.3),
 * appended to the end of the row by default. Rows usually have custom markup,
 * so list positions in `manual` and render the `Badges` / `Actions` slot
 * props where they belong.
 */
import type { Component } from 'vue';
import { provideSlotPath } from '~/utils/extensions/slot-path';
import ExtensionSlot from '~/components/extension-host/ExtensionSlot.vue';
import { outletProps } from './slot-outlets';

type Position = 'badges' | 'actions';

const props = withDefaults(defineProps<{
  /** Stable kebab-case id (the row kind, e.g. `fixture`); becomes a slot path segment. */
  id: string;
  /** Root element/component. */
  as?: string | Component;
  /** Positions the caller places itself. */
  manual?: Position[];
}>(), { as: 'div', manual: () => [] });

defineSlots<{
  default?(p: { Badges: Component; Actions: Component }): unknown;
}>();

provideSlotPath(() => props.id);

/** Slot props handed to the default slot. */
const outlets = outletProps(['badges', 'actions'] as const);

/** Whether a position is auto-placed. */
const auto = (p: Position) => !props.manual.includes(p);
</script>

<template>
  <component :is="as" :data-pm-list-item="id">
    <slot v-bind="outlets" />
    <ExtensionSlot v-if="auto('badges')" position="badges" />
    <ExtensionSlot v-if="auto('actions')" position="actions" />
  </component>
</template>
