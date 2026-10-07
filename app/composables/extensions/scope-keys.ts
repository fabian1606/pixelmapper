/**
 * Injection keys of the extension host.
 *
 * One key per scope name (so nested providers shadow only that scope), plus
 * keys for the owning extension and the slot id of components rendered by
 * `ExtensionSlot`.
 */
import type { InjectionKey } from 'vue';
import type { ScopeName, ScopeRef } from '@pixelmapper/extension-api';

/** Cache so every scope name maps to exactly one symbol. */
const scopeKeys = new Map<ScopeName, symbol>();

/** Returns the injection key of a scope. */
export function scopeKey<K extends ScopeName>(name: K): InjectionKey<ScopeRef<K>> {
  let key = scopeKeys.get(name);
  if (!key) {
    key = Symbol(`pm-scope:${name}`);
    scopeKeys.set(name, key);
  }
  return key as InjectionKey<ScopeRef<K>>;
}

/** Id of the extension owning the current component subtree. */
export const EXTENSION_OWNER_KEY: InjectionKey<string> = Symbol('pm-extension-owner');

/** Slot id the current component subtree is rendered in. */
export const SLOT_ID_KEY: InjectionKey<string> = Symbol('pm-slot-id');
