<script setup lang="ts">
/**
 * Layout primitive: a section inside a panel (e.g. "Color", "Position").
 *
 * Generates extension slots `<path>:before`, `:after` (rendered outside the
 * root, as siblings), `:actions` and `:items` (ADR §5.3).
 *
 * Default placement:
 * - with `title`: a header row `title … actions`; without: actions at the
 *   start of the root,
 * - items after the content.
 * Positions listed in `manual` are not auto-placed; render them yourself via
 * the slot props (`Actions`, `Items`, `Before`, `After`).
 */
import type { Component } from 'vue';
import { provideSlotPath } from '~/utils/extensions/slot-path';
import ExtensionSlot from '~/components/extension-host/ExtensionSlot.vue';
import { outletProps } from './slot-outlets';

type Position = 'before' | 'after' | 'actions' | 'items';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
  /** Stable kebab-case id; becomes a slot path segment. */
  id: string;
  /** Optional section title rendered in a default header row. */
  title?: string;
  /** Root element/component. */
  as?: string | Component;
  /** Positions the caller places itself. */
  manual?: Position[];
}>(), { as: 'div', manual: () => [] });

defineSlots<{
  default?(p: { Actions: Component; Items: Component; Before: Component; After: Component }): unknown;
}>();

provideSlotPath(() => props.id);

/** Slot props handed to the default slot. */
const outlets = outletProps(['actions', 'items', 'before', 'after'] as const);

/** Whether a position is auto-placed. */
const auto = (p: Position) => !props.manual.includes(p);
</script>

<template>
  <ExtensionSlot v-if="auto('before')" position="before" />
  <component :is="as" v-bind="$attrs" :data-pm-section="id">
    <div v-if="title" class="flex items-center justify-between gap-2 mb-1.5">
      <span class="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{{ title }}</span>
      <div v-if="auto('actions')" class="flex items-center gap-1">
        <ExtensionSlot position="actions" />
      </div>
    </div>
    <ExtensionSlot v-else-if="auto('actions')" position="actions" />
    <slot v-bind="outlets" />
    <ExtensionSlot v-if="auto('items')" position="items" />
  </component>
  <ExtensionSlot v-if="auto('after')" position="after" />
</template>
