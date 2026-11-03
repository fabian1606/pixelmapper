import { onMounted, onUnmounted } from 'vue';
import type { ShortcutId } from '~/utils/shortcuts/shortcut-registry';
import { matchesBinding, type KeyBinding } from '~/utils/shortcuts/key-binding';
import { getBindings } from '~/composables/use-shortcut-bindings';

/**
 * A keyboard shortcut handler. Rebindable shortcuts name a registry `id`
 * (keys come from Settings → Shortcuts); fixed ones pass their `keys`.
 */
type ShortcutDef =
  | { id: ShortcutId; handler: () => void }
  | { keys: readonly KeyBinding[]; label?: string; handler: () => void };

/**
 * Central keyboard shortcut manager.
 *
 * Usage:
 *   useShortcuts([
 *     { id: 'edit.undo', handler: history.undo },
 *     { keys: [{ key: 'o', mod: true }], handler: openFile },
 *   ]);
 *
 * The composable registers a single `keydown` listener and handles
 * all shortcuts in one place. Bindings are looked up on every keydown, so
 * changes in Settings apply immediately. Shortcuts are automatically
 * unregistered when the component unmounts.
 */
export function useShortcuts(shortcuts: ShortcutDef[]): void {
  function onKeyDown(e: KeyboardEvent) {
    // Ignore shortcuts when the user is typing inside an input/textarea
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    for (const shortcut of shortcuts) {
      const keys = 'id' in shortcut ? getBindings(shortcut.id) : shortcut.keys;
      if (keys.some(b => matchesBinding(e, b))) {
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
