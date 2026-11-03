/**
 * Every rebindable editor shortcut with its default keys. Components bind
 * handlers by id (`useShortcuts([{ id, handler }])`); the keys come from
 * here plus the user's overrides (`use-shortcut-bindings.ts`), so the
 * Settings → Shortcuts page can change them without touching call sites.
 *
 * The desktop menu accelerators (⌘O, ⌘, …, `src-tauri/src/menu.rs`) are
 * native and stay fixed.
 */
import type { KeyBinding } from './key-binding';

/**
 * Where a shortcut is active. `edit` actions exist on both editor pages,
 * so they conflict with `design` and `live`; those two never overlap.
 */
export type ShortcutScope = 'edit' | 'design' | 'live';

export interface ShortcutDef {
  id: string;
  label: string;
  scope: ShortcutScope;
  defaults: readonly KeyBinding[];
}

/** Section titles of the scopes, in display order. */
export const SCOPE_TITLES: Record<ShortcutScope, string> = {
  edit: 'General',
  design: 'Design',
  live: 'Live',
};

export const SHORTCUTS = [
  // ── General (Design + Live) ────────────────────────────
  { id: 'edit.undo', label: 'Undo', scope: 'edit', defaults: [{ key: 'z', mod: true }] },
  { id: 'edit.redo', label: 'Redo', scope: 'edit', defaults: [{ key: 'z', mod: true, shift: true }, { key: 'y', mod: true }] },
  { id: 'edit.selectAll', label: 'Select All', scope: 'edit', defaults: [{ key: 'a', mod: true }] },
  { id: 'edit.group', label: 'Group', scope: 'edit', defaults: [{ key: 'g', mod: true }] },
  { id: 'edit.ungroup', label: 'Ungroup', scope: 'edit', defaults: [{ key: 'g', mod: true, shift: true }] },
  { id: 'edit.delete', label: 'Delete Selection', scope: 'edit', defaults: [{ key: 'Backspace' }, { key: 'Delete' }] },
  { id: 'edit.save', label: 'Save Snapshot', scope: 'edit', defaults: [{ key: 's', mod: true }] },
  // ── Design ─────────────────────────────────────────────
  { id: 'design.addFixture', label: 'Add Fixture', scope: 'design', defaults: [{ key: 'a', shift: true }] },
  { id: 'design.renameFixture', label: 'Rename Fixture', scope: 'design', defaults: [{ key: 'F2' }] },
  { id: 'design.savePreset', label: 'Create Preset', scope: 'design', defaults: [{ key: 'p', shift: true }] },
  { id: 'design.overwritePreset', label: 'Overwrite Active Preset', scope: 'design', defaults: [{ key: 's', shift: true }] },
  // ── Live ───────────────────────────────────────────────
  { id: 'live.copy', label: 'Copy', scope: 'live', defaults: [{ key: 'c', mod: true }] },
  { id: 'live.paste', label: 'Paste', scope: 'live', defaults: [{ key: 'v', mod: true }] },
  { id: 'live.cut', label: 'Cut', scope: 'live', defaults: [{ key: 'x', mod: true }] },
  { id: 'live.duplicate', label: 'Duplicate', scope: 'live', defaults: [{ key: 'd', mod: true }] },
  { id: 'live.clearSelection', label: 'Clear Selection', scope: 'live', defaults: [{ key: 'Escape' }] },
] as const satisfies readonly ShortcutDef[];

export type ShortcutId = typeof SHORTCUTS[number]['id'];

const BY_ID = new Map<string, ShortcutDef>(SHORTCUTS.map(s => [s.id, s]));

/** The definition of a shortcut id. */
export function getShortcutDef(id: ShortcutId): ShortcutDef {
  return BY_ID.get(id)!;
}

/** Whether shortcuts of these scopes can fire on the same page. */
export function scopesOverlap(a: ShortcutScope, b: ShortcutScope): boolean {
  return a === b || a === 'edit' || b === 'edit';
}
