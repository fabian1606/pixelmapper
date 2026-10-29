/**
 * Hover intent for the version-history preview: an entry counts as
 * "hovered" after the pointer (or focus) stayed on it for `delay` ms. While
 * a preview is shown, moving to another entry switches immediately; leaving
 * hides after a short `grace` so moving between neighbouring rows does not
 * flicker. Framework-free; timers are injectable for tests.
 */

export interface HoverIntentOptions<K> {
  /** Called when `key` becomes the shown entry. */
  onShow: (key: K) => void;
  /** Called when the shown entry is hidden (with that entry's key). */
  onHide: (key: K) => void;
  /** Dwell time before the first preview shows (ms). */
  delay?: number;
  /** Hide delay after leaving (ms). */
  grace?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const HOVER_DELAY_MS = 300;
const HIDE_GRACE_MS = 120;

export function createHoverIntent<K>(options: HoverIntentOptions<K>) {
  const delay = options.delay ?? HOVER_DELAY_MS;
  const grace = options.grace ?? HIDE_GRACE_MS;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>));

  let shown: K | null = null;
  let pending: { key: K; handle: unknown } | null = null;
  let hideHandle: unknown = null;

  function clearPending(): void {
    if (pending) clearTimer(pending.handle);
    pending = null;
  }

  function clearHide(): void {
    if (hideHandle !== null) clearTimer(hideHandle);
    hideHandle = null;
  }

  /** Shows `key` now (hides the previous one first). */
  function show(key: K): void {
    clearPending();
    clearHide();
    if (shown !== null && shown !== key) options.onHide(shown);
    if (shown === key) return;
    shown = key;
    options.onShow(key);
  }

  /** Hides the shown entry now. */
  function hide(): void {
    clearHide();
    if (shown === null) return;
    const key = shown;
    shown = null;
    options.onHide(key);
  }

  return {
    /** Pointer entered / focus moved to `key`. */
    enter(key: K): void {
      clearHide();
      if (shown === key) return;
      // A preview is already open: follow the pointer without a new delay.
      if (shown !== null) { show(key); return; }
      if (pending?.key === key) return;
      clearPending();
      pending = { key, handle: setTimer(() => { pending = null; show(key); }, delay) };
    },
    /** Pointer left / focus left `key`. */
    leave(key: K): void {
      if (pending?.key === key) clearPending();
      if (shown === key && hideHandle === null) hideHandle = setTimer(() => { hideHandle = null; hide(); }, grace);
    },
    /** Toggle without delay (tap on the preview icon on touch devices). */
    toggle(key: K): void {
      if (shown === key) hide();
      else show(key);
    },
    /** Cancels everything (popover closed, list changed, unmount). */
    cancel(): void {
      clearPending();
      hide();
    },
    /** Currently shown key. */
    current(): K | null {
      return shown;
    },
  };
}

export type HoverIntent<K> = ReturnType<typeof createHoverIntent<K>>;
