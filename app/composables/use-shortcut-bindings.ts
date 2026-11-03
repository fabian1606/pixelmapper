/**
 * The keys currently bound to each shortcut: registry defaults plus the
 * user's overrides. Overrides are a device preference (like the rest of
 * Settings) and live in localStorage; the state is module-level so every
 * `useShortcuts` listener and the Settings page share it.
 */
import { ref } from 'vue';
import { getShortcutDef, scopesOverlap, SHORTCUTS, type ShortcutId } from '~/utils/shortcuts/shortcut-registry';
import { formatBinding, sameBinding, type KeyBinding } from '~/utils/shortcuts/key-binding';

const STORAGE_KEY = 'pm.shortcuts.v1';

/** Overridden bindings by shortcut id (absent = defaults). */
const overrides = ref<Partial<Record<ShortcutId, readonly KeyBinding[]>>>(load());

function load(): Partial<Record<ShortcutId, readonly KeyBinding[]>> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn('[shortcuts] could not load overrides', error);
    return {};
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides.value));
  } catch (error) {
    console.warn('[shortcuts] could not save overrides', error);
  }
}

/** Keys bound to a shortcut right now. */
export function getBindings(id: ShortcutId): readonly KeyBinding[] {
  return overrides.value[id] ?? getShortcutDef(id).defaults;
}

/** First binding as a menu label (`⇧P`), or `undefined` when unbound. */
export function shortcutLabel(id: ShortcutId): string | undefined {
  const first = getBindings(id)[0];
  return first ? formatBinding(first) : undefined;
}

/** Whether the user changed this shortcut. */
export function isCustomized(id: ShortcutId): boolean {
  return id in overrides.value;
}

/** Replaces the keys of a shortcut. */
export function setBindings(id: ShortcutId, bindings: KeyBinding[]): void {
  overrides.value = { ...overrides.value, [id]: bindings };
  persist();
}

/** Back to the default keys of one shortcut, or of all when `id` is omitted. */
export function resetBindings(id?: ShortcutId): void {
  if (id) {
    const { [id]: _, ...rest } = overrides.value;
    overrides.value = rest;
  } else {
    overrides.value = {};
  }
  persist();
}

/**
 * Binds `binding` to `id` (replacing the one at `index`, or appending) and
 * removes it from every other shortcut that could fire on the same page.
 * Returns the labels of the shortcuts it was taken from.
 */
export function assignBinding(id: ShortcutId, binding: KeyBinding, index: number | null): string[] {
  const scope = getShortcutDef(id).scope;
  const takenFrom: string[] = [];
  for (const other of SHORTCUTS) {
    if (other.id === id || !scopesOverlap(scope, other.scope)) continue;
    const keys = getBindings(other.id);
    if (!keys.some(k => sameBinding(k, binding))) continue;
    setBindings(other.id, keys.filter(k => !sameBinding(k, binding)));
    takenFrom.push(other.label);
  }
  const current = getBindings(id);
  const next = index !== null && index < current.length
    ? current.map((k, i) => (i === index ? binding : k))
    : [...current, binding];
  // Drop duplicates the new binding may have created (keep the first).
  setBindings(id, next.filter((k, i) => next.findIndex(o => sameBinding(o, k)) === i));
  return takenFrom;
}
