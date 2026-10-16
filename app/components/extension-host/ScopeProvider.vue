<script setup lang="ts" generic="K extends ScopeName">
/**
 * Provides one extension scope to its slot content without adding DOM.
 *
 * For list items rendered with `v-for` (one provider per item). The `get`
 * projector is only evaluated when something actually reads the scope, so
 * passing an inline arrow is cheap.
 */
import type { ScopeMap, ScopeName } from '@pixelmapper/extension-api';
import { provideScope } from '~/composables/extensions/provide-scope';

const props = defineProps<{
  /** Scope name. */
  name: K;
  /** Lazy projector returning the view (or `undefined`). */
  get: () => ScopeMap[K] | undefined;
}>();

provideScope(props.name, () => props.get());
</script>

<template>
  <slot />
</template>
