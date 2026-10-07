/**
 * `useReplaceable` — host implementation (ADR §5.4).
 *
 * Returns the active component of a `pm.*` input: the core default or the
 * installed replacement (respecting the user's choice on conflicts).
 */
import { computed, toValue, type Component, type ComputedRef, type MaybeRefOrGetter } from 'vue';
import type { PmInputName } from '@pixelmapper/extension-api';
import { PM_DEFAULTS } from '~/components/pm/defaults';
import { replacementChoices, resolveReplacement } from '~/utils/extensions/replacements';

/** Resolves a `pm.*` input reactively. */
export function useReplaceable(name: MaybeRefOrGetter<PmInputName>): ComputedRef<Component> {
  return computed(() => {
    void replacementChoices.value; // re-resolve when the user picks
    const n = toValue(name);
    return resolveReplacement(n, PM_DEFAULTS[n]);
  });
}
