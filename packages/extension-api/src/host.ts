/**
 * Bridge to the host implementation.
 *
 * The API package never contains host code. The host populates
 * `globalThis.__PIXELMAPPER_SHARED__` (in `app/utils/extensions/shared-globals.ts`)
 * before any extension runs; the declared composables in this package read
 * their implementation from there. Distribution bundles rewrite `vue`,
 * `pinia` and this package to the same globals.
 */
import type { Component, ComputedRef, MaybeRef, ShallowRef } from 'vue';
import type { ExtensionContext } from './manifest';
import type { LiveFrame, LiveTarget, LiveValueOf, LiveValueOptions, OnFrameOptions } from './live';
import type { PmInputName } from './replaceables';
import type { ScopeName, ScopeRef } from './scopes';

/** The implementation of the API composables, provided by the host. */
export interface HostApi {
  /** Semver of the API the host implements. */
  apiVersion: string;
  useScope<K extends ScopeName>(name: K): ScopeRef<K>;
  useExtensionContext(): ExtensionContext;
  useLiveValue<T extends LiveTarget>(
    target: MaybeRef<T>,
    opts?: LiveValueOptions,
  ): Readonly<ShallowRef<LiveValueOf<T> | undefined>>;
  onFrame(cb: (frame: LiveFrame) => void, opts?: OnFrameOptions): void;
  useReplaceable(name: PmInputName): ComputedRef<Component>;
}

/** Shape of `globalThis.__PIXELMAPPER_SHARED__`. */
export interface SharedGlobals {
  /** The host's `vue` module namespace. */
  vue: unknown;
  /** The host's `pinia` module namespace. */
  pinia: unknown;
  /** The host API implementation (and the API package's own exports). */
  api: HostApi & Record<string, unknown>;
}

declare global {
  // eslint-disable-next-line no-var
  var __PIXELMAPPER_SHARED__: SharedGlobals | undefined;
}

/**
 * Returns the host API. Throws a descriptive error when called outside the
 * host (e.g. in a unit test without a host stub).
 */
export function getHostApi(): HostApi {
  const shared = globalThis.__PIXELMAPPER_SHARED__;
  if (!shared?.api) {
    throw new Error(
      '[extension-api] Host not initialized: globalThis.__PIXELMAPPER_SHARED__.api is missing. '
      + 'Extension composables can only run inside the Pixelmapper app.',
    );
  }
  return shared.api;
}
