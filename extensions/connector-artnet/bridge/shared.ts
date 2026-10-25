/**
 * The app-wide Art-Net backend and node directory (plan M5.1: one bridge
 * connection per app, not per connector) plus the bridge URL setting.
 *
 * The browser and the desktop app both use `WsBridgeBackend` for now; a
 * native backend can be installed with `installArtNetBackend` without
 * touching connectors or components.
 */
import { shallowRef } from 'vue';
import { getPlatform } from '@pixelmapper/extension-api';
import type { ArtNetBackend } from './backend';
import { NodeDirectory } from './node-directory';
import { WsBridgeBackend } from './ws-bridge-backend';
import { EXTENSION_VERSION } from '../version';

/** Default bridge address (`pmnet-bridge serve`). */
export const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:7777';

/** Command that starts the bridge (shown in hints). */
export const PMNET_SERVE_COMMAND = 'pmnet-bridge serve';

/** Download page of `pmnet-bridge`; null until the first release exists (plan M3.3). */
export const PMNET_DOWNLOAD_URL: string | null = null;

/** localStorage key of the bridge URL setting (per device). */
const URL_KEY = 'pm:artnet:bridge-url';

let backend: ArtNetBackend | null = null;
let directory: NodeDirectory | null = null;

/** The bridge URL from the device setting, else the default. */
export function getBridgeUrl(): string {
  try {
    return localStorage.getItem(URL_KEY)?.trim() || DEFAULT_BRIDGE_URL;
  }
  catch {
    return DEFAULT_BRIDGE_URL;
  }
}

/** Stores the bridge URL (empty = default) and reconnects. */
export function setBridgeUrl(url: string): void {
  try {
    if (url.trim() && url.trim() !== DEFAULT_BRIDGE_URL) localStorage.setItem(URL_KEY, url.trim());
    else localStorage.removeItem(URL_KEY);
  }
  catch (err) {
    console.warn('[artnet] cannot store the bridge URL:', err);
  }
  if (backend instanceof WsBridgeBackend) backend.setUrl(getBridgeUrl);
}

/** True for Safari (not Chromium/Firefox on iOS or macOS). */
export function isSafariUserAgent(ua: string): boolean {
  return /Safari\//.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg|OPR|Android)\//.test(ua);
}

/** Why this platform cannot reach the bridge, or null. */
export function bridgeUnsupportedReason(): string | null {
  let kind: string = 'web';
  try {
    kind = getPlatform().kind;
  }
  catch { /* no host (tests): treat as web */ }
  if (kind !== 'web' || typeof navigator === 'undefined') return null;
  return isSafariUserAgent(navigator.userAgent) ? 'Art-Net discovery is not supported in Safari. Use Chrome, Firefox or the desktop app.' : null;
}

/** The shared backend (created on first use, not started). */
export function getArtNetBackend(): ArtNetBackend {
  return backend ??= new WsBridgeBackend({ url: getBridgeUrl, clientVersion: EXTENSION_VERSION, unsupportedReason: bridgeUnsupportedReason });
}

/** The shared node directory of the shared backend. */
export function getNodeDirectory(): NodeDirectory {
  return directory ??= new NodeDirectory(getArtNetBackend());
}

/**
 * Holders that currently need discovery (see `retainArtNetDiscovery`).
 * Reactive, so features that should only run while Art-Net is in use
 * (e.g. the firmware update manager) can follow it.
 */
const discoveryDemand = shallowRef(0);

/**
 * Keeps the shared backend (bridge connection, discovery) running until the
 * returned release function is called; the backend starts with the first
 * holder and stops after the last one. Holders are the Connectors page
 * (node suggestions) and every `artnet-node` connector, so users who never
 * use Art-Net get no bridge connection — no browser local-network prompt,
 * no connection errors in the console. Releasing twice is a no-op.
 */
export function retainArtNetDiscovery(): () => void {
  const b = getArtNetBackend();
  getNodeDirectory();
  if (discoveryDemand.value++ === 0) b.start();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    discoveryDemand.value = Math.max(0, discoveryDemand.value - 1);
    if (discoveryDemand.value === 0) getArtNetBackend().stop();
  };
}

/** Number of current discovery holders (reactive inside `computed`/`watch`; tests, diagnostics). */
export function artNetDiscoveryDemand(): number {
  return discoveryDemand.value;
}

/**
 * Replaces the shared backend (tests, a future native backend). The old
 * one is stopped and the directory is rebuilt on next use.
 */
export function installArtNetBackend(next: ArtNetBackend | null): void {
  backend?.stop();
  directory?.dispose();
  directory = null;
  backend = next;
  discoveryDemand.value = 0;
}
