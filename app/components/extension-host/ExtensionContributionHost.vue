<script setup lang="ts">
/**
 * Renders one slot contribution of an extension.
 *
 * Provides the owning extension id and the slot id (read by
 * `useExtensionContext`) and isolates render errors so a broken extension
 * cannot take down core UI. Renders no wrapper DOM.
 */
import { onErrorCaptured, provide, ref, type Component } from 'vue';
import { EXTENSION_OWNER_KEY, SLOT_ID_KEY } from '~/composables/extensions/scope-keys';

const props = defineProps<{
  /** Owning extension. */
  extensionId: string;
  /** Full slot id. */
  slotId: string;
  /** Contributed component. */
  component: Component;
}>();

provide(EXTENSION_OWNER_KEY, props.extensionId);
provide(SLOT_ID_KEY, props.slotId);

/** Set when the contribution threw; it is then hidden for this mount. */
const failed = ref(false);

onErrorCaptured((err) => {
  console.error(`[extensions] contribution of "${props.extensionId}" in "${props.slotId}" failed:`, err);
  failed.value = true;
  return false;
});
</script>

<template>
  <component :is="component" v-if="!failed" />
</template>
