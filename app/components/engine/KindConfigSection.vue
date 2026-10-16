<script setup lang="ts">
/**
 * Generic editor of a kind fixture's config (plan P5.4): `ParamForm` over
 * the kind's `configSchema`; every change is one `SetFixtureKindConfig`
 * step (scrubs coalesce into one). Keys outside the schema (e.g. curve
 * points) are preserved.
 */
import { computed, shallowRef } from 'vue';
import { storeToRefs } from 'pinia';
import type { Json, ParamValue } from '@pixelmapper/extension-api';
import ParamForm from '~/components/plugin-host/ParamForm.vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import { cloneJson, getKind, rebuildKindFixture } from '~/utils/kinds/kind-host';
import { useEngineStore } from '~/stores/engine-store';
import { useHistory } from './composables/use-history';
import { SetFixtureKindConfigCommand } from './commands/set-fixture-kind-config-command';

const props = defineProps<{ fixture: Fixture }>();

const history = useHistory();
const engineStore = useEngineStore();
const { layoutRevision } = storeToRefs(engineStore);

const kind = computed(() => (props.fixture.kind ? getKind(props.fixture.kind.id) : undefined));

/** Config values (re-read on layout changes: configs are mutated during scrubs/undo). */
const values = computed(() => {
  void layoutRevision.value;
  return (props.fixture.kind?.config ?? {}) as Record<string, ParamValue>;
});

/** Config at the start of a scrub (null when not scrubbing). */
const scrubStart = shallowRef<unknown>(null);

/** Applies new values; outside a scrub this is one history step. */
function update(next: Record<string, ParamValue>) {
  const f = props.fixture;
  if (!f.kind) return;
  const before = cloneJson(f.kind.config) as Json;
  const after = { ...(before as Record<string, Json>), ...cloneJson(next) } as Json;
  if (scrubStart.value) {
    f.kind.config = after;
    rebuildKindFixture(f);
    engineStore.flushEngineOutput();
    return;
  }
  history.execute(new SetFixtureKindConfigCommand(engineStore.flatFixtures, f.id, before, after, `Edit ${f.name}`));
  engineStore.flushEngineOutput();
}

/** Commits a scrub as one step. */
function endScrub() {
  const f = props.fixture;
  const start = scrubStart.value as Json | null;
  scrubStart.value = null;
  if (!f.kind || !start) return;
  history.execute(new SetFixtureKindConfigCommand(engineStore.flatFixtures, f.id, start, cloneJson(f.kind.config) as Json, `Edit ${f.name}`));
}
</script>

<template>
  <div v-if="kind" class="space-y-3">
    <span class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{{ kind.def.label }}</span>
    <ParamForm
      :schema="kind.def.configSchema"
      :model-value="values"
      @update:model-value="update"
      @scrub-start="scrubStart = cloneJson(fixture.kind!.config)"
      @scrub-end="endScrub"
    />
  </div>
  <p v-else-if="fixture.kind" class="text-[11px] text-muted-foreground">
    Extension for fixture kind “{{ fixture.kind.id }}” is not installed.
  </p>
</template>
