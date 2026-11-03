/**
 * A single key combination ("binding") plus the helpers to match it against
 * a `KeyboardEvent`, record it from one and render it for the UI.
 */

/** One key combination. `key` is `KeyboardEvent.key`, lowercased for single characters. */
export interface KeyBinding {
  key: string;
  /** ⌘ on macOS, Ctrl elsewhere (either one matches, like before). */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** Keys that are modifiers on their own and never form a binding. */
const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Shift', 'Alt', 'AltGraph', 'CapsLock', 'Fn', 'OS']);

/** Whether the app runs on macOS (symbols instead of "Ctrl+…" labels). */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

/** Normalizes `event.key`: single characters lowercase, named keys as-is. */
function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** Whether the event is exactly this combination (no extra modifiers). */
export function matchesBinding(e: KeyboardEvent, b: KeyBinding): boolean {
  return normalizeKey(e.key) === normalizeKey(b.key)
    && (e.ctrlKey || e.metaKey) === (b.mod ?? false)
    && e.shiftKey === (b.shift ?? false)
    && e.altKey === (b.alt ?? false);
}

/** Builds a binding from a keydown, or `null` while only modifiers are held. */
export function bindingFromEvent(e: KeyboardEvent): KeyBinding | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const b: KeyBinding = { key: normalizeKey(e.key) };
  if (e.ctrlKey || e.metaKey) b.mod = true;
  if (e.shiftKey) b.shift = true;
  if (e.altKey) b.alt = true;
  return b;
}

/** Whether two bindings are the same combination. */
export function sameBinding(a: KeyBinding, b: KeyBinding): boolean {
  return normalizeKey(a.key) === normalizeKey(b.key)
    && (a.mod ?? false) === (b.mod ?? false)
    && (a.shift ?? false) === (b.shift ?? false)
    && (a.alt ?? false) === (b.alt ?? false);
}

/** Display names of named keys: [macOS, other]. */
const KEY_NAMES: Record<string, [string, string]> = {
  Backspace: ['⌫', 'Backspace'],
  Delete: ['⌦', 'Del'],
  Escape: ['Esc', 'Esc'],
  Enter: ['↩', 'Enter'],
  Tab: ['⇥', 'Tab'],
  ' ': ['Space', 'Space'],
  ArrowUp: ['↑', '↑'],
  ArrowDown: ['↓', '↓'],
  ArrowLeft: ['←', '←'],
  ArrowRight: ['→', '→'],
};

/** Renders a binding: `⇧⌘G` on macOS, `Ctrl+Shift+G` elsewhere. */
export function formatBinding(b: KeyBinding, mac: boolean = IS_MAC): string {
  const named = KEY_NAMES[b.key];
  const key = named ? named[mac ? 0 : 1] : b.key.length === 1 ? b.key.toUpperCase() : b.key;
  if (mac) return `${b.alt ? '⌥' : ''}${b.shift ? '⇧' : ''}${b.mod ? '⌘' : ''}${key}`;
  return [b.mod && 'Ctrl', b.shift && 'Shift', b.alt && 'Alt', key].filter(Boolean).join('+');
}
