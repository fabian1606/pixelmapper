<script setup lang="ts">
/**
 * Renders a replaceable `pm.*` input (ADR §5.4). Core code MUST render the
 * inputs through this component (or `useReplaceable`). All attributes,
 * listeners and slots are forwarded to the active implementation.
 *
 * Example: `<Replaceable name="pm.fader" :model-value="v" @update:model-value="set" />`
 */
import type { PmInputName } from '@pixelmapper/extension-api';
import { useReplaceable } from '~/composables/extensions/use-replaceable';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** Input contract name. */
  name: PmInputName;
}>();

const impl = useReplaceable(() => props.name);
</script>

<template>
  <component :is="impl" v-bind="$attrs">
    <template v-for="(_, slot) in $slots" #[slot]="scope">
      <slot :name="slot" v-bind="scope ?? {}" />
    </template>
  </component>
</template>
