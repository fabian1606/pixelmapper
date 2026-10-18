/**
 * Window chrome of the running platform (host-only, ADR 0003).
 *
 * In the macOS desktop app the native title bar is transparent and the app
 * header sits next to the window buttons (Figma-style). Each `#platform`
 * entry exports a `getWindowChrome()` returning this shape.
 */
export interface WindowChrome {
  /** The page extends under a transparent title bar (macOS desktop app). */
  overlayTitleBar: boolean;
  /** Left space reserved for the traffic-light buttons, in px (0 = none). */
  trafficLightInset: number;
  /**
   * Subscribes to native fullscreen changes (the traffic lights hide in
   * fullscreen, so their inset must go). Calls back once with the current
   * state; returns an unsubscribe. Absent where there is no window chrome.
   */
  onFullscreenChange?: (callback: (fullscreen: boolean) => void) => () => void;
}

/** Plain browser window: nothing to make room for. */
export const NO_WINDOW_CHROME: WindowChrome = { overlayTitleBar: false, trafficLightInset: 0 };
