import { keyLabel } from '~/utils/live/button-actions';
import type { InputSource } from './types';

/**
 * Computer keyboard as an input source. Address: `KeyboardEvent.code`
 * ("KeyB", "Space", …), so the physical key counts, not the layout.
 */

/** Focus is in a text field: keys belong to the field, not to buttons. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export const keyInputSource: InputSource = {
  id: 'key',
  title: 'Key',
  learnHint: 'press a key',
  isAvailable: () => typeof window !== 'undefined',
  format: address => keyLabel(String(address)),

  listen(mode, handler) {
    if (mode === 'learn') {
      // Capture phase + stop: the learned key must not reach the app
      // shortcuts. Escape is left to the learner (it cancels).
      const onDown = (e: KeyboardEvent) => {
        if (e.code === 'Escape' || e.repeat) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        handler({ binding: { source: 'key', address: e.code }, down: true });
      };
      window.addEventListener('keydown', onDown, { capture: true });
      return () => window.removeEventListener('keydown', onDown, { capture: true });
    }

    // Play: modifier combos stay with the app shortcuts (undo, copy, …).
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (handler({ binding: { source: 'key', address: e.code }, down: true })) e.preventDefault();
    };
    const onUp = (e: KeyboardEvent) => {
      handler({ binding: { source: 'key', address: e.code }, down: false });
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  },
};
