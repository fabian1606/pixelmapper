/**
 * Bridge to the host implementation.
 *
 * The API package never contains host code. The host populates
 * `globalThis.__PIXELMAPPER_SHARED__` (in `app/utils/extensions/shared-globals.ts`)
 * before any extension runs; the declared composables in this package read
 * their implementation from there. Distribution bundles rewrite `vue`,
 * `pinia` and this package to the same globals.
 */
import type { Component, ComputedRef, DeepReadonly, MaybeRef, ShallowRef } from 'vue';
import type { FixtureId, Json } from './model';
import type { ExtensionContext, ExtensionManifest } from './manifest';
import type { LiveFrame, LiveTarget, LiveValueOf, LiveValueOptions, OnFrameOptions } from './live';
import type { PmInputName } from './replaceables';
import type { FixtureView, ScopeName, ScopeRef } from './scopes';
import type { Platform } from './platform';
import type { FixtureSummary } from './scopes';
import type {
  AddressOccupant,
  FindFreeAddressOptions,
  FixtureChangeGuard,
  FixturePatchChange,
  FixtureDefinitionKey,
  FixturePatchObserverOptions,
  RdmDefinitionMatch,
} from './patch';

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
  /** Readonly view of a fixture by id (usable outside components, e.g. in connectors). */
  getFixture(id: FixtureId): DeepReadonly<FixtureView> | undefined;
  /** Validates and registers an extension manifest. */
  registerExtension(manifest: ExtensionManifest): void;
  /** Platform-dependent I/O (UDP, serial, MIDI); see ADR 0003. */
  platform: Platform;
  /** Free DMX address search (API 1.3, `patch.ts`). */
  findFreeAddressSpan(
    fixtures: readonly AddressOccupant[],
    footprint: number,
    count: number,
    options?: FindFreeAddressOptions,
  ): number | null;
  /** All fixtures of the project (API 1.3). */
  listFixtures(): FixtureSummary[];
  /** Registers a patch change guard (API 1.3). */
  onBeforeFixtureChange(guard: FixtureChangeGuard): () => void;
  /** Subscribes to patch changes (API 1.3). */
  onFixturePatchChange(callback: (changes: FixturePatchChange[]) => void, options?: FixturePatchObserverOptions): () => void;
  /** Definition lookup by RDM IDs (API 1.3). */
  findFixtureDefinitionByRdm(manufacturerId: number, modelId: number): Promise<RdmDefinitionMatch | null>;
  /** Stores a definition as a new custom fixture (API 1.4). */
  saveCustomFixtureDefinition(definition: Json): FixtureDefinitionKey;
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
  /** Manifests registered before the host was ready; drained by the host at boot. */
  // eslint-disable-next-line no-var
  var __PIXELMAPPER_PENDING__: ExtensionManifest[] | undefined;
}

/**
 * Registers an extension with the host. Called by an extension layer's
 * `plugins/register.ts` (or by the loader for distribution bundles). If the
 * host is not initialized yet, the manifest is queued and registered at boot,
 * so plugin execution order does not matter.
 */
export function registerExtension(manifest: ExtensionManifest): void {
  const api = globalThis.__PIXELMAPPER_SHARED__?.api;
  if (api) {
    api.registerExtension(manifest);
    return;
  }
  (globalThis.__PIXELMAPPER_PENDING__ ??= []).push(manifest);
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
