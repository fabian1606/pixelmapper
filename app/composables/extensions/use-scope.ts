/**
 * `useScope` / `useScopes` — read inherited domain scopes (ADR §5.2).
 */
import { computed, inject, shallowRef, type ComputedRef } from 'vue';
import {
  SCOPE_NAMES,
  type ScopeName,
  type ScopeRef,
  type ScopeSnapshot,
} from '@pixelmapper/extension-api';
import { scopeKey } from './scope-keys';

/** Shared "not provided" ref returned when no ancestor provides a scope. */
const EMPTY = shallowRef(undefined) as ScopeRef<never>;

/**
 * Returns the nearest provided scope, or a ref holding `undefined` when no
 * ancestor provides it. Must be called during `setup`.
 */
export function useScope<K extends ScopeName>(name: K): ScopeRef<K> {
  return inject(scopeKey(name), EMPTY as unknown as ScopeRef<K>);
}

/** All scope refs visible at the calling component (only provided ones). */
export function useScopes(): { readonly [K in ScopeName]?: ScopeRef<K> } {
  const out: Partial<Record<ScopeName, ScopeRef<ScopeName>>> = {};
  for (const name of SCOPE_NAMES) {
    const ref = inject(scopeKey(name), null);
    if (ref) out[name] = ref as ScopeRef<ScopeName>;
  }
  return out as { readonly [K in ScopeName]?: ScopeRef<K> };
}

/**
 * Reactive snapshot of all visible scopes (unwrapped values). Used to
 * evaluate slot `when` predicates.
 */
export function useScopeSnapshot(): ComputedRef<ScopeSnapshot> {
  const scopes = useScopes();
  return computed(() => {
    const snap: Record<string, unknown> = {};
    for (const [name, ref] of Object.entries(scopes)) {
      if (ref?.value !== undefined) snap[name] = ref.value;
    }
    return snap as ScopeSnapshot;
  });
}
