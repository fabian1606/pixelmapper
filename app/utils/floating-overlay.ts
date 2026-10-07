/**
 * Selectors matching every floating UI layer that is teleported to <body>:
 * the global context menu, dialogs, sheets, and all reka-ui popper-positioned
 * content (dropdowns, popovers, selects, tooltips, …).
 *
 * Surfaces that auto-close via `onClickOutside` (e.g. the fixture properties
 * sidebar) must spread this list into their `ignore` option — otherwise
 * interacting with an overlay spawned from inside the surface counts as an
 * "outside" click and closes the surface, unmounting the overlay with it.
 *
 * Custom overlays opt in by putting `data-overlay-root` on their root element.
 */
export const FLOATING_OVERLAY_SELECTORS = [
  '[data-overlay-root]',
  '[data-reka-popper-content-wrapper]',
  '[data-slot="dialog-overlay"]',
  '[data-slot="dialog-content"]',
  '[data-slot="alert-dialog-overlay"]',
  '[data-slot="alert-dialog-content"]',
  '[data-slot="sheet-overlay"]',
  '[data-slot="sheet-content"]',
];

const FLOATING_OVERLAY_SELECTOR = FLOATING_OVERLAY_SELECTORS.join(',');

/**
 * Whether an event target sits inside a floating overlay layer.
 *
 * Call this at the top of every `onClickOutside` handler in addition to the
 * `ignore` option: vueuse only consults `ignore` in its window-level
 * `pointerdown` listener, which never fires when a component inside the
 * overlay calls `stopPropagation()` on pointerdown (dialog wrappers and
 * slider thumbs do). The close handler itself runs on a capture-phase click
 * listener that cannot be stopped, so it must re-check the target.
 */
export function isInFloatingOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(FLOATING_OVERLAY_SELECTOR);
}

// Track whether the current pointer interaction *started* inside an overlay:
// dragging (e.g. a slider thumb) and releasing outside the overlay makes the
// resulting click event target a common ancestor like <body>, which the
// target check alone would treat as an outside click. Capture phase runs
// before any stopPropagation, so this always records correctly.
let interactionFromOverlay = false;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e) => { interactionFromOverlay = isInFloatingOverlay(e.target); },
    { capture: true, passive: true },
  );
}

/**
 * Whether an outside-click event belongs to a floating overlay — either the
 * event target sits in one, or the pointer interaction started in one.
 * Use this in `onClickOutside` handlers.
 */
export function isOverlayInteraction(target: EventTarget | null): boolean {
  return interactionFromOverlay || isInFloatingOverlay(target);
}
