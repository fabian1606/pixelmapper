/**
 * Web platform (ADR 0003): what the browser can do on its own.
 *
 * No UDP (Art-Net falls back to the local bridge); serial and MIDI where the
 * browser supports them. The Tauri platform starts from this one and
 * replaces capabilities with native implementations (ADR 0003 D4).
 */
import type { Platform } from '@pixelmapper/extension-api';
import { createWebSerial } from './serial';
import { createWebMidi } from './midi';
import { NO_WINDOW_CHROME, type WindowChrome } from '../window-chrome';

/** Creates the web platform for the current browser. */
export function createWebPlatform(): Platform {
  return {
    kind: 'web',
    udp: null,
    serial: createWebSerial(),
    midi: createWebMidi(),
  };
}

/** Entry point resolved by the `#platform` alias in web builds. */
export const createPlatform = createWebPlatform;

/** Browser tabs have no window chrome to make room for. */
export function getWindowChrome(): WindowChrome {
  return NO_WINDOW_CHROME;
}

/** No menu bar; project files via download / file input. */
export { createWebAppShell as getAppShell } from './app-shell';
