<script setup lang="ts">
/**
 * Add form for a fixture kind (plan P5.1): the kind's own `library.addForm`
 * when it provides one, else the generic `ParamForm` over `configSchema`.
 * Emits ready-built fixtures (ids/addresses are assigned by the caller).
 *
 * `addForm` contract: prop `modelValue` (config), emits
 * `update:modelValue` and `add` (config, count = 1).
 */
import { computed, ref, shallowRef, watch } from 'vue';
import type { Json, ParamValue } from '@pixelmapper/extension-api';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-vue-next';
import ParamForm from '~/components/plugin-host/ParamForm.vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import { cloneJson, createKindFixture, getKind } from '~/utils/kinds/kind-host';

const props = defineProps<{ kindId: string }>();

const emit = defineEmits<{
  add: [fixtures: Fixture[]];
}>();

const kind = computed(() => getKind(props.kindId));
const config = shallowRef<Json>(null);
const count = ref(1);

// Fresh defaults whenever the kind changes.
watch(kind, (k) => { config.value = k ? cloneJson(k.def.defaults()) : null; }, { immediate: true });

/** Builds `n` fixtures from a config. */
function add(cfg: Json, n = 1) {
  const k = kind.value;
  if (!k) return;
  const fixtures = Array.from({ length: Math.max(1, Math.min(64, Math.round(n))) }, (_, i) =>
    createKindFixture(k.def, { id: `pending-${i}`, config: cfg }));
  emit('add', fixtures);
}
</script>

<template>
  <div v-if="kind" class="flex flex-col gap-4">
    <p class="text-xs text-muted-foreground">{{ kind.def.description }}</p>

    <component
      :is="kind.def.library.addForm"
      v-if="kind.def.library.addForm"
      :model-value="config"
      @update:model-value="(v: Json) => (config = v)"
      @add="(cfg: Json, n?: number) => add(cfg, n)"
    />

    <template v-else>
      <ParamForm
        :schema="kind.def.configSchema"
        :model-value="(config ?? {}) as Record<string, ParamValue>"
        size="md"
        @update:model-value="v => (config = v as Json)"
      />
      <div class="flex items-center gap-2">
        <label class="text-xs text-muted-foreground">Count</label>
        <input v-model.number="count" type="number" min="1" max="64" class="w-16 h-8 rounded-md border bg-transparent px-2 text-sm">
        <Button class="ml-auto gap-2" @click="add(config, count)">
          <Plus class="h-4 w-4" /> Add {{ kind.def.label }}
        </Button>
      </div>
    </template>
  </div>
  <p v-else class="text-sm text-destructive">Fixture kind "{{ kindId }}" is not installed.</p>
</template>
