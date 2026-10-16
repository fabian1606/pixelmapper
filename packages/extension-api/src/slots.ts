/**
 * Slots (ADR §5.3).
 *
 * Slots are produced automatically by the core's layout primitives. A slot id
 * is the `/`-joined ids of all enclosing primitives plus `:` and a position,
 * e.g. `PmPanel id="properties"` › `PmPanelSection id="color"` →
 * `properties/color:actions`.
 */
import type { Component } from 'vue';
import type { ScopeSnapshot } from './scopes';

/** The layout primitives that generate slots. */
export type PrimitiveKind = 'PmPanel' | 'PmPanelSection' | 'PmToolbar' | 'PmMenuGroup' | 'PmListItem';

/** Slot positions each primitive renders. */
export interface PrimitiveSlotPositions {
  PmPanel: 'header' | 'before' | 'after';
  PmPanelSection: 'before' | 'after' | 'actions' | 'items';
  PmToolbar: 'start' | 'end';
  PmMenuGroup: 'items';
  PmListItem: 'badges' | 'actions';
}

/** Any slot position. */
export type SlotPosition = PrimitiveSlotPositions[PrimitiveKind];

/** All slot positions per primitive (runtime mirror of `PrimitiveSlotPositions`). */
export const PRIMITIVE_SLOT_POSITIONS: { readonly [K in PrimitiveKind]: readonly PrimitiveSlotPositions[K][] } = {
  PmPanel: ['header', 'before', 'after'],
  PmPanelSection: ['before', 'after', 'actions', 'items'],
  PmToolbar: ['start', 'end'],
  PmMenuGroup: ['items'],
  PmListItem: ['badges', 'actions'],
};

/**
 * A menu entry contributed into an `:items` position without writing a
 * component. The action receives the scope snapshot at click time.
 */
export interface MenuItemSpec {
  /** Visible label. */
  label: string;
  /** Lucide icon name (kebab-case), e.g. `'palette'`. */
  icon?: string;
  /** Keyboard shortcut hint shown on the right, e.g. `'⌘K'`. */
  shortcut?: string;
  /** Called on click. */
  action: (scopes: ScopeSnapshot) => void;
  /** Disable the entry for the given scopes. */
  disabled?: (scopes: ScopeSnapshot) => boolean;
}

/**
 * A contribution into one or more slots.
 *
 * Provide either `component` or (for `:items` positions) `menuItem`.
 */
export interface SlotContribution {
  /**
   * Exact slot id or glob. `*` matches one path segment, `**` any number of
   * segments. Examples: `'properties/color:actions'`, `'properties/*:actions'`,
   * `'library/**:items'`, `'**:actions'`.
   */
  slot: string;
  /** Reactive visibility predicate over the inherited scopes. */
  when?: (scopes: ScopeSnapshot) => boolean;
  /** Rendered component. Receives no props; use `useExtensionContext()`. */
  component?: Component;
  /** Higher renders first. Default 0. Ties are broken by extension id. */
  priority?: number;
  /** Menu entry for `:items` positions in `PmMenuGroup`. */
  menuItem?: MenuItemSpec;
}
