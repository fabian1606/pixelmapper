<script setup lang="ts">
/**
 * Mode select of the fixture inspector (plan M4.3) for fixtures created
 * from a definition (`fixture.source`). Lists the definition's modes,
 * asks the fixture change guards (plan M4.5) and switches the mode with an
 * undoable `SetFixtureModeCommand`.
 */
import { computed, ref, watch } from 'vue';
import { Label } from '@/components/ui/label';
import Replaceable from '~/components/extension-host/Replaceable.vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { SceneNode } from '~/utils/engine/core/group';
import { useEngineStore } from '~/stores/engine-store';
import { useHistory } from './composables/use-history';
import { buildSetFixtureModeCommand, listFixtureModes, type FixtureModeOption } from '~/utils/fixture-definitions/fixture-mode';
import { requestFixtureChanges } from '~/utils/extensions/fixture-change-guard';
import { patchStateAt, patchStateOf } from '~/utils/extensions/fixture-patch-state';
import { notify } from '~/composables/use-notifications';

const props = defineProps<{
  fixture: Fixture;
}>();

const history = useHistory();
const engineStore = useEngineStore();

/** Modes of the definition; `null` while loading or when unavailable. */
const modes = ref<FixtureModeOption[] | null>(null);
const loading = ref(false);
/** True while a mode change is being prepared (guard, definition). */
const busy = ref(false);

/** Loads the modes whenever the fixture or its definition changes. */
watch(() => [props.fixture.id, props.fixture.source?.key] as const, async ([id, key]) => {
  modes.value = null;
  if (!key) return;
  loading.value = true;
  try {
    const list = await listFixtureModes(props.fixture);
    // Ignore results for a fixture that is no longer shown.
    if (props.fixture.id === id) modes.value = list;
  }
  finally {
    loading.value = false;
  }
}, { immediate: true });

/** Current mode index (re-read on every history step: `source` is not reactive). */
const currentMode = computed(() => {
  void history.version.value;
  return String(props.fixture.source?.modeIndex ?? 0);
});

/** Options for `pm.select`. */
const options = computed(() => (modes.value ?? []).map(m => ({ value: String(m.index), label: `${m.name} (${m.channelCount} ch)` })));

/** Guards, builds and executes the mode change. */
async function changeMode(value: string) {
  const modeIndex = Number.parseInt(value, 10);
  const fixture = props.fixture;
  const target = modes.value?.find(m => m.index === modeIndex);
  if (!target || modeIndex === fixture.source?.modeIndex || busy.value) return;
  busy.value = true;
  try {
    const allowed = await requestFixtureChanges([{
      fixtureId: fixture.id,
      before: patchStateOf(fixture),
      after: patchStateAt(fixture.startAddress, target.channelCount, modeIndex),
    }]);
    if (!allowed) return;
    const command = await buildSetFixtureModeCommand(engineStore.sceneNodes as SceneNode[], fixture, modeIndex);
    history.execute(command);
  }
  catch (err) {
    console.error('[fixture-mode] mode change failed:', err);
    notify({ title: 'Could not change the mode', description: (err as Error).message, variant: 'error' });
  }
  finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="space-y-2">
    <Label class="text-[9px] uppercase tracking-wider font-bold text-muted-foreground/60">Mode</Label>
    <p v-if="loading" class="text-[10px] text-muted-foreground">Loading modes…</p>
    <p v-else-if="!modes" class="text-[10px] text-muted-foreground">Fixture definition not available</p>
    <Replaceable
      v-else
      name="pm.select"
      variant="dropdown"
      :options="options"
      :model-value="currentMode"
      :disabled="busy || options.length < 2"
      @update:model-value="changeMode"
    />
  </div>
</template>
