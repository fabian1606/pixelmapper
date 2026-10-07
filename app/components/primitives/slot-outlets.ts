/**
 * Slot outlets shared by all layout primitives (ADR §5.3).
 *
 * Each outlet renders the `ExtensionSlot` for one position relative to the
 * nearest enclosing primitive (the path comes from injection), so a single
 * module-level component per position suffices. Primitives pass them to
 * their default slot as `Header`, `Actions`, `Badges`, … so callers with
 * custom markup can place them (and list the position in `manual`).
 */
import { defineComponent, h, markRaw, type Component } from 'vue';
import type { SlotPosition } from '@pixelmapper/extension-api';
import ExtensionSlot from '~/components/extension-host/ExtensionSlot.vue';

/** PascalCase slot-prop name of a position, e.g. `actions` → `Actions`. */
export type OutletName<P extends string> = Capitalize<P>;

/** Creates the outlet component of one position. */
function outlet(position: SlotPosition): Component {
  return markRaw(defineComponent({
    name: `PmSlotOutlet${position[0]!.toUpperCase()}${position.slice(1)}`,
    setup: () => () => h(ExtensionSlot, { position }),
  }));
}

/** One outlet per slot position. */
export const SLOT_OUTLETS: Readonly<Record<SlotPosition, Component>> = {
  header: outlet('header'),
  before: outlet('before'),
  after: outlet('after'),
  actions: outlet('actions'),
  items: outlet('items'),
  start: outlet('start'),
  end: outlet('end'),
  badges: outlet('badges'),
};

/** Builds the slot props object (`{ Actions, Badges, … }`) for given positions. */
export function outletProps<P extends SlotPosition>(positions: readonly P[]): Record<OutletName<P>, Component> {
  const out = {} as Record<OutletName<P>, Component>;
  for (const p of positions) {
    out[`${p[0]!.toUpperCase()}${p.slice(1)}` as OutletName<P>] = SLOT_OUTLETS[p];
  }
  return out;
}
