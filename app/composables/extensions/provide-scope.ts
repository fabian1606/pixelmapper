/**
 * `provideScope` — core-only API to expose a domain scope to descendants
 * (ADR §5.2). Extensions cannot call this (it is not part of the API package).
 */
import { computed, provide, type Ref } from 'vue';
import type { ScopeMap, ScopeName, ScopeRef } from '@pixelmapper/extension-api';
import { scopeKey } from './scope-keys';
import { freezeView } from '~/utils/extensions/scope-views';

/**
 * Provides a scope to all descendants. A nested call for the same name
 * shadows the outer one. The source is wrapped in a readonly computed; in dev
 * the value is deep-frozen so accidental mutation by an extension throws.
 *
 * The source MUST yield plain view objects (see `scope-views.ts`), never live
 * model instances.
 */
export function provideScope<K extends ScopeName>(
  name: K,
  source: Ref<ScopeMap[K] | undefined> | (() => ScopeMap[K] | undefined),
): ScopeRef<K> {
  const read = typeof source === 'function' ? source : () => source.value;
  const view = computed(() => freezeView(read())) as unknown as ScopeRef<K>;
  provide(scopeKey(name), view);
  return view;
}
