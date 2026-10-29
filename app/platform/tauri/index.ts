/**
 * Tauri platform (ADR 0003 D4): the web platform plus native overrides.
 *
 * Every capability not yet ported keeps its web implementation (or `null`
 * where WKWebView lacks it). Ported so far: `udp` (step 2), `http` and
 * `resources` (ADR 0004 D19). Next: `serial` and `midi` (step 3).
 */
import type { Platform } from '@pixelmapper/extension-api';
import { createWebPlatform } from '../web';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createTauriUdp } from './udp';
import { createTauriHttp, createTauriResources } from './native-files';
import { NO_WINDOW_CHROME, type WindowChrome } from '../window-chrome';
import { DESKTOP_ACCOUNT_POLICY, type AccountPolicy } from '../account-policy';
import { getSharedAgentBridge, type AgentBridge } from '../../utils/agents/agent-bridge';

/**
 * Width reserved for the macOS traffic lights (positioned in tauri.conf.json):
 * buttons end at ~74 px, plus a gap before the first header button.
 */
const TRAFFIC_LIGHT_INSET = 92;

/** Entry point resolved by the `#platform` alias in Tauri builds. */
export function createPlatform(): Platform {
  return {
    ...createWebPlatform(),
    kind: 'tauri',
    udp: createTauriUdp(),
    http: createTauriHttp(),
    resources: createTauriResources(),
  };
}

/**
 * macOS windows use an overlay title bar (`titleBarStyle: Overlay` in
 * tauri.conf.json); other systems keep their native title bar.
 */
export function getWindowChrome(): WindowChrome {
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
  if (!isMac) return NO_WINDOW_CHROME;
  return { overlayTitleBar: true, trafficLightInset: TRAFFIC_LIGHT_INSET, onFullscreenChange: watchFullscreen };
}

/**
 * Reports the window's fullscreen state now and after every resize
 * (entering/leaving macOS fullscreen always resizes the window).
 */
function watchFullscreen(callback: (fullscreen: boolean) => void): () => void {
  const win = getCurrentWindow();
  let disposed = false;
  let unlisten: (() => void) | undefined;

  /** Reads the current state; ignores answers arriving after unsubscribe. */
  const report = () => {
    win.isFullscreen()
      .then((fullscreen) => { if (!disposed) callback(fullscreen); })
      .catch((err) => console.warn('[window-chrome] isFullscreen failed', err));
  };

  report();
  win.onResized(report)
    .then((fn) => { if (disposed) fn(); else unlisten = fn; })
    .catch((err) => console.warn('[window-chrome] onResized failed', err));

  return () => {
    disposed = true;
    unlisten?.();
  };
}

/** Account optional, cloud projects mirrored (ADR 0004 D3, D13–D15). */
export function getAccountPolicy(): AccountPolicy {
  return DESKTOP_ACCOUNT_POLICY;
}

/** Native menu bar and file dialogs. */
export { createTauriAppShell as getAppShell } from './app-shell';

/** OFL library bundled into the app, works offline (ADR 0004 D18). */
export { createBundledFixtureLibrary as getFixtureLibrary } from './fixture-library';

/**
 * MCP bridge to `pixelmapper-mcp` (ADR 0002 B8). Until the in-process MCP
 * server lands, the webview uses the same WebSocket bridge as the browser.
 */
export function getAgentBridge(): AgentBridge {
  return getSharedAgentBridge('tauri');
}
