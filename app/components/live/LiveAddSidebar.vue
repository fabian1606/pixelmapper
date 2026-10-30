<script setup lang="ts">
import { computed } from 'vue';
import { Gamepad2 } from 'lucide-vue-next';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useEngineStore } from '~/stores/engine-store';
import { useHistory } from '~/components/engine/composables/use-history';
import { AddLiveWidgetCommand } from '~/components/engine/commands/live-widget-commands';
import { defaultButtonAction, defaultLiveWidget, type LiveWidget, type ControllerChildBinding, type LiveMapping } from '~/utils/live/types';
import { defaultTriggerFor } from '~/utils/live/button-actions';
import { listWidgetTypes, type WidgetTypeInfo } from '~/utils/live/widget-registry';
import { registryVersion } from '~/utils/extensions/registry';
import { listControllerDefinitions } from '~/utils/controllers/catalog';
import type { ControllerDefinition } from '~/utils/controllers/types';

const store = useLiveModeStore();
const engineStore = useEngineStore();
const history = useHistory();

/** Addable widget types (core + installed extensions). */
const widgetTypes = computed(() => {
  void registryVersion.value;
  return listWidgetTypes().filter(t => t.addable);
});

const controllers = computed<ControllerDefinition[]>(() => listControllerDefinitions());

function addWidget(info: WidgetTypeInfo) {
  if (!store.activePageId) return;
  const widget = defaultLiveWidget(info.type as LiveWidget['type'], 0, 0, info.defaultSize);
  // Extension widgets keep their config in namespaced extension data.
  if (info.extensionId && info.defaultConfig) {
    (widget as LiveWidget & { extensionData?: Record<string, unknown> }).extensionData = {
      [info.extensionId]: info.defaultConfig(),
    };
  }
  history.execute(new AddLiveWidgetCommand(store.activePageId, widget));
}

function addControllerTwin(def: ControllerDefinition) {
  if (!store.activePageId) return;
  const widget: LiveWidget = defaultLiveWidget('controller-twin', 0, 0);
  widget.gridW = def.defaultGridSize.w;
  widget.gridH = def.defaultGridSize.h;
  widget.controllerKey = def.key;
  widget.label = def.label;
  // Pre-populate child bindings so command replays are deterministic across clients.
  // Pads get their suggested mapping as their first action; faders keep it as mapping.
  const children: ControllerChildBinding[] = def.controls.map(c => {
    const suggested = c.defaultMapping ? { type: 'none', ...c.defaultMapping } as LiveMapping : null;
    if (c.type === 'button') {
      return {
        controlId: c.id,
        mapping: { type: 'none' },
        // Every pad starts with one action (On press, or the suggested mapping).
        actions: suggested && suggested.type !== 'none'
          ? [{ id: crypto.randomUUID(), trigger: defaultTriggerFor(suggested, engineStore.savedPresets), action: suggested }]
          : [defaultButtonAction()],
      };
    }
    return { controlId: c.id, mapping: suggested ?? { type: 'none' } };
  });
  widget.controllerChildren = children;
  history.execute(new AddLiveWidgetCommand(store.activePageId, widget));
}
</script>

<template>
  <div class="w-16 shrink-0 flex flex-col items-center py-3 gap-1 border-r border-border bg-background overflow-y-auto">
    <button
      v-for="item in widgetTypes"
      :key="item.type"
      class="w-full flex flex-col items-center gap-1 py-2 px-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      :title="item.label"
      @click="addWidget(item)"
    >
      <component :is="item.icon" class="size-4 shrink-0" />
      <span class="text-[9px] font-medium leading-none">{{ item.label }}</span>
    </button>

    <div v-if="controllers.length" class="w-full mt-2 pt-2 border-t border-border flex flex-col items-center gap-1">
      <span class="text-[8px] uppercase tracking-wider text-muted-foreground/60 leading-none mb-1">Controller</span>
      <button
        v-for="def in controllers"
        :key="def.key"
        class="w-full flex flex-col items-center gap-1 py-2 px-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        :title="def.label"
        @click="addControllerTwin(def)"
      >
        <Gamepad2 class="size-4 shrink-0" />
        <span class="text-[9px] font-medium leading-none text-center">{{ def.model }}</span>
      </button>
    </div>
  </div>
</template>
