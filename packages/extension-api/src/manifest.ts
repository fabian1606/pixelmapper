/**
 * Extension manifest and context (ADR §5.1, §5.2).
 *
 * Every extension has an entry file `extensions/<id>/extension.ts` whose
 * default export is `defineExtension({...})`. The registry validates the
 * manifest at registration.
 */
import type { Component, ComputedRef, DeepReadonly } from 'vue';
import type { Command, CommandDefinition, CoreCommandFactory } from './commands';
import type { ConnectorDefinition, ControllerDefinition, LiveWidgetDefinition } from './connectors';
import type { FixtureKindDefinition } from './kinds';
import type { ShapeDef } from './curves';
import type { PmInputName, ReplacementContribution } from './replaceables';
import type { FixtureId } from './model';
import type { FixtureView, ScopeName, ScopeRef } from './scopes';
import type { SlotContribution } from './slots';
import { getHostApi } from './host';

/** Semver of this API package. Extensions declare a compatible range in `apiVersion`. */
export const API_VERSION = '1.1.0';

/** Everything an extension can contribute. All lists are optional. */
export interface ExtensionContributions {
  slots?: SlotContribution[];
  replaces?: ReplacementContribution[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fixtureKinds?: FixtureKindDefinition<any>[];
  connectors?: ConnectorDefinition[];
  controllers?: ControllerDefinition[];
  liveWidgets?: LiveWidgetDefinition[];
  commands?: CommandDefinition[];
  /** Programmatic curve shapes for `pm.curve` (ids namespaced `<extension id>/<name>`). */
  curveShapes?: ShapeDef[];
}

/** API passed to the optional imperative `activate` hook. */
export interface ExtensionApi {
  /** The extension's own id. */
  extensionId: string;
  /** Core command constructors. */
  commands: CoreCommandFactory;
  /** Execute a command through history (undo, sync, persistence). */
  run(command: Command): void;
}

/** An extension manifest. */
export interface ExtensionManifest {
  /** kebab-case, globally unique. */
  id: string;
  /** Semver of the extension. */
  version: string;
  /** Semver range of `@pixelmapper/extension-api`, e.g. `'^1.0.0'`. */
  apiVersion: string;
  displayName: string;
  /** Read by humans and AI. */
  description: string;
  contributes?: ExtensionContributions;
  /** Called once after registration. May return a disposer. */
  activate?(api: ExtensionApi): void | (() => void);
}

/** Identity helper that types an extension manifest. */
export function defineExtension(manifest: ExtensionManifest): ExtensionManifest {
  return manifest;
}

/** Context of a component rendered by the extension host. */
export interface ExtensionContext {
  /** Id of the extension owning the component (`null` for core components). */
  extensionId: string | null;
  /** Slot the component is rendered in, e.g. `'properties/color:actions'`. */
  slotId: string | null;
  /** All scopes visible at this point (inherited from ancestors). */
  scopes: { readonly [K in ScopeName]?: ScopeRef<K> };
  /** Execute a command through history (undo, sync, persistence). */
  run(command: Command): void;
  /** Typed core command constructors. */
  commands: CoreCommandFactory;
  /**
   * Readonly view of any fixture (e.g. every id in the `selection` scope).
   * Reactive when read inside a `computed`/template.
   */
  getFixture(id: FixtureId): DeepReadonly<FixtureView> | undefined;
  /** Temporary local output preview (see `OutputPreview`). */
  preview: OutputPreview;
}

/**
 * Temporary, local-only output preview: forces rendered DMX values without
 * touching project state (not persisted, not synced, no history). Cleared
 * automatically when the calling component unmounts.
 */
export interface OutputPreview {
  /** Forces the coarse byte of a channel to `dmxValue` (0–255). */
  setChannel(fixtureId: FixtureId, channelIndex: number, dmxValue: number): void;
  /** Removes all preview values set through this context. */
  clear(): void;
}

/**
 * Reads an inherited scope. Returns a readonly `shallowRef` whose value is
 * `undefined` when no ancestor provides the scope.
 */
export function useScope<K extends ScopeName>(name: K): ScopeRef<K> {
  return getHostApi().useScope(name);
}

/** Returns the extension context of the calling component. */
export function useExtensionContext(): ExtensionContext {
  return getHostApi().useExtensionContext();
}

/**
 * Resolves the active implementation of a `pm.*` input (core default or the
 * user's chosen replacement). Render with `<component :is="Fader" … />`.
 */
export function useReplaceable(name: PmInputName): ComputedRef<Component> {
  return getHostApi().useReplaceable(name);
}

/**
 * Readonly view of a fixture by id. Unlike `ctx.getFixture` it works outside
 * components (connectors, plain modules); call it when needed — the view is
 * a snapshot.
 */
export function getFixture(id: FixtureId): DeepReadonly<FixtureView> | undefined {
  return getHostApi().getFixture(id);
}
