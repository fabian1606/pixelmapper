import { onMounted, onUnmounted } from 'vue';

/**
 * Defines a single keyboard shortcut.
 * If `key` is a string, it matches `event.key`.
 */
interface ShortcutDef {
  /** The value of `event.key` to match (case-sensitive). */
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  /** Human-readable label shown in UI (optional, e.g. for a shortcut cheat-sheet). */
  label?: string;
  handler: () => void;
}

/**
 * Central keyboard shortcut manager.
 *
 * Usage:
 *   useShortcuts([
 *     { key: 'z', ctrl: true, label: 'Undo', handler: history.undo },
 *     { key: 'Delete', label: 'Delete Selection', handler: deleteSelected },
 *   ]);
 *
 * The composable registers a single `keydown` listener and handles
 * all shortcuts in one place. Shortcuts are automatically unregistered
 * when the component unmounts.
 */
export function useShortcuts(shortcuts: ShortcutDef[]): void {
  function onKeyDown(e: KeyboardEvent) {
    // Ignore shortcuts when the user is typing inside an input/textarea
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;

    for (const shortcut of shortcuts) {
      const ctrlMatch = (shortcut.ctrl ?? false) === ctrl;
      const shiftMatch = (shortcut.shift ?? false) === shift;
      const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();

      if (ctrlMatch && shiftMatch && keyMatch) {
        e.preventDefault();
        shortcut.handler();
        // Stop after first match so nothing double-fires
        return;
      }
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown));
  onUnmounted(() => window.removeEventListener('keydown', onKeyDown));
}
