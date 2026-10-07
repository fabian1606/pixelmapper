/**
 * Shared globals for extensions (ADR §5.9).
 *
 * Populates `globalThis.__PIXELMAPPER_SHARED__` with the host's `vue`,
 * `pinia` and the extension API (the API package's own exports merged with
 * the host implementations of its declared composables). Distribution
 * bundles import these instead of bundling their own copies. Must run before
 * any extension code executes; afterwards registrations queued by layer
 * plugins that ran earlier are drained.
 */
import * as vue from 'vue';
import * as pinia from 'pinia';
import * as apiModule from '@pixelmapper/extension-api';
import type { ExtensionManifest, HostApi } from '@pixelmapper/extension-api';
import { useScope } from '~/composables/extensions/use-scope';
import { useExtensionContext } from '~/composables/extensions/use-extension-context';
import { useReplaceable } from '~/composables/extensions/use-replaceable';
import { registerExtension as hostRegisterExtension, ExtensionValidationError } from './registry';

/** Optional host implementations wired in by later subsystems (live values) or tests. */
type HostOverrides = Partial<Pick<HostApi, 'useLiveValue' | 'onFrame' | 'useReplaceable'>>;

/** Registers a manifest, logging (not throwing) validation errors so one bad extension cannot stop boot. */
function safeRegister(manifest: ExtensionManifest): void {
  try {
    hostRegisterExtension(manifest, 'layer');
  }
  catch (err) {
    if (err instanceof ExtensionValidationError) console.error(`[extensions] ${err.message}`);
    else console.error('[extensions] registration failed:', err);
  }
}

/** Error thrown by API functions whose host implementation is not installed. */
function missing(name: string): never {
  throw new Error(`[extensions] host API "${name}" is not available`);
}

/**
 * Installs the shared globals and drains queued registrations. Idempotent:
 * a second call only updates the overrides.
 */
export function installSharedGlobals(overrides: HostOverrides = {}): void {
  const host: HostApi = {
    apiVersion: apiModule.API_VERSION,
    useScope,
    useExtensionContext,
    useLiveValue: overrides.useLiveValue ?? (() => missing('useLiveValue')),
    onFrame: overrides.onFrame ?? (() => missing('onFrame')),
    useReplaceable: overrides.useReplaceable ?? useReplaceable,
    registerExtension: safeRegister,
  };

  globalThis.__PIXELMAPPER_SHARED__ = {
    vue,
    pinia,
    api: { ...apiModule, ...host },
  };

  // Drain manifests registered before the host was ready.
  const pending = globalThis.__PIXELMAPPER_PENDING__ ?? [];
  globalThis.__PIXELMAPPER_PENDING__ = [];
  for (const manifest of pending) safeRegister(manifest);
}
