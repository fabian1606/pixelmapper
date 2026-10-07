/**
 * Primitive id path (ADR §5.3).
 *
 * Every layout primitive appends its `id` to the path inherited from its
 * ancestors via provide/inject. Slot ids are `<path joined by '/'>:<position>`.
 */
import { computed, inject, provide, type ComputedRef, type InjectionKey, type MaybeRefOrGetter, toValue } from 'vue';

/** Injection key of the current primitive path. */
const SLOT_PATH_KEY: InjectionKey<ComputedRef<readonly string[]>> = Symbol('pm-slot-path');

/** Empty root path. */
const ROOT = computed<readonly string[]>(() => []);

/** kebab-case segment check (dev warning only). */
const SEGMENT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Returns the path of the nearest enclosing primitive (empty at root). */
export function useSlotPath(): ComputedRef<readonly string[]> {
  return inject(SLOT_PATH_KEY, ROOT);
}

/**
 * Appends `id` to the inherited path and provides it to descendants.
 * Returns the full path of this primitive.
 */
export function provideSlotPath(id: MaybeRefOrGetter<string>): ComputedRef<readonly string[]> {
  const parent = useSlotPath();
  const path = computed(() => {
    const seg = toValue(id);
    if (import.meta.env?.DEV && !SEGMENT_RE.test(seg)) {
      console.warn(`[extensions] primitive id "${seg}" should be stable kebab-case`);
    }
    return [...parent.value, seg];
  });
  provide(SLOT_PATH_KEY, path);
  return path;
}

/** Builds a slot id from a path and a position. */
export function slotIdOf(path: readonly string[], position: string): string {
  return `${path.join('/')}:${position}`;
}
