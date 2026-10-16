<script setup lang="ts">
/**
 * Layout primitive: a group of menu entries (context menus, add menus,
 * library categories).
 *
 * Generates the extension slot `<path>:items` (ADR §5.3), placed after the
 * content by default. Menu-item contributions are rendered through the
 * `item` slot so the surrounding menu keeps its own styling. List `items` in
 * `manual` to place them yourself via the `Items` slot prop.
 */
import type { Component } from 'vue';
import type { MenuItemSpec } from '@pixelmapper/extension-api';
import { provideSlotPath } from '~/utils/extensions/slot-path';
import ExtensionSlot from '~/components/extension-host/ExtensionSlot.vue';
import { outletProps } from './slot-outlets';

const props = withDefaults(defineProps<{
  /** Stable kebab-case id; becomes a slot path segment. */
  id: string;
  /** Root element/component; `'fragment'` renders no root (inside existing menu content). */
  as?: string | Component;
  /** Positions the caller places itself. */
  manual?: 'items'[];
}>(), { as: 'div', manual: () => [] });

defineSlots<{
  default?(p: { Items: Component }): unknown;
  /** Renders one contributed menu item in the menu's own style. */
  item?(p: { item: MenuItemSpec; extensionId: string; run: () => void; disabled: boolean }): unknown;
}>();

provideSlotPath(() => props.id);

/** Slot props handed to the default slot. */
const outlets = outletProps(['items'] as const);
</script>

<template>
  <template v-if="as === 'fragment'">
    <slot v-bind="outlets" />
    <ExtensionSlot v-if="!manual.includes('items')" position="items">
      <template v-if="$slots.item" #menu-item="p">
        <slot name="item" v-bind="p" />
      </template>
    </ExtensionSlot>
  </template>
  <component :is="as" v-else :data-pm-menu-group="id">
    <slot v-bind="outlets" />
    <ExtensionSlot v-if="!manual.includes('items')" position="items">
      <template v-if="$slots.item" #menu-item="p">
        <slot name="item" v-bind="p" />
      </template>
    </ExtensionSlot>
  </component>
</template>
