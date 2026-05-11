<script setup lang="ts">
import { computed } from 'vue';
import { Play, Settings2 } from 'lucide-vue-next';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useEngineStore } from '~/stores/engine-store';
import { useControllerStore } from '~/stores/controller-store';
import { useHistory } from '~/components/engine/composables/use-history';

const route = useRoute();
const connectionsRoute = computed(() => `/project/${route.params.id}/connections?tab=inputs`);
import {
  UpdateLivePageCommand,
  UpdateControllerChildMappingCommand,
} from '~/components/engine/commands/live-widget-commands';
import { getPageResolution, type LiveWidget, type LiveMapping, type ControllerChildBinding } from '~/utils/live/types';
import { getControllerDefinition } from '~/utils/controllers/catalog';

const store = useLiveModeStore();
const engineStore = useEngineStore();
const controllerStore = useControllerStore();
const history = useHistory();

const ASPECT_RATIOS = [
  { label: '16 : 9',  w: 16, h: 9 },
  { label: '16 : 10', w: 16, h: 10 },
  { label: '4 : 3',   w: 4,  h: 3 },
  { label: '1 : 1',   w: 1,  h: 1 },
  { label: '9 : 16',  w: 9,  h: 16 },
];

const resolution = computed(() => {
  if (!store.activePage) return null;
  return getPageResolution(store.activePage);
});

function setAspectRatio(w: number, h: number) {
  if (!store.activePageId) return;
  history.execute(new UpdateLivePageCommand(store.activePageId, { aspectRatioW: w, aspectRatioH: h }));
}

function setColumns(columns: number) {
  if (!store.activePageId || isNaN(columns) || columns < 4) return;
  history.execute(new UpdateLivePageCommand(store.activePageId, { columns }));
}

// ── Selected controller-twin editing ─────────────────────────────────────────

const selectedTwin = computed<LiveWidget | null>(() => {
  if (store.selectedWidgetIds.size !== 1) return null;
  const id = Array.from(store.selectedWidgetIds)[0];
  const widget = store.activePage?.widgets.find(w => w.id === id);
  return widget?.type === 'controller-twin' ? widget : null;
});

const twinDefinition = computed(() => {
  const key = selectedTwin.value?.controllerKey;
  return key ? getControllerDefinition(key) : null;
});

const matchingInstances = computed(() => {
  const def = twinDefinition.value;
  if (!def) return [];
  return controllerStore.instancesForKey(def.key);
});

const boundDriverId = computed(() => {
  const w = selectedTwin.value;
  return w ? controllerStore.bindings.get(w.id) ?? null : null;
});

const boundDriver = computed(() => {
  const id = boundDriverId.value;
  return id ? controllerStore.getInstance(id) : null;
});

function bindToInstance(instanceId: string) {
  const twin = selectedTwin.value;
  if (!twin) return;
  controllerStore.bindWidget(twin.id, instanceId);
}

function unbind() {
  const twin = selectedTwin.value;
  if (!twin) return;
  controllerStore.bindWidget(twin.id, null);
}

// Per-control mapping editor

const selectedControl = computed(() => {
  const def = twinDefinition.value;
  const id = store.selectedControlId;
  if (!def || !id) return null;
  return def.controls.find(c => c.id === id) ?? null;
});

const selectedChild = computed<ControllerChildBinding | null>(() => {
  const twin = selectedTwin.value;
  const ctrl = selectedControl.value;
  if (!twin || !ctrl) return null;
  return twin.controllerChildren?.find(c => c.controlId === ctrl.id) ?? null;
});

const presets = computed(() => engineStore.savedPresets ?? []);

function patchChild(patch: Partial<Pick<ControllerChildBinding, 'mapping' | 'label' | 'color'>>) {
  const twin = selectedTwin.value;
  const ctrl = selectedControl.value;
  if (!twin || !ctrl || !store.activePageId) return;
  history.execute(new UpdateControllerChildMappingCommand(
    store.activePageId, twin.id, ctrl.id, patch,
  ));
}

function setMappingType(type: LiveMapping['type']) {
  patchChild({ mapping: { type } });
}

function setMappingPreset(presetId: string) {
  patchChild({ mapping: { type: 'preset', presetId } });
}

function setLabel(label: string) {
  patchChild({ label });
}

function setColor(color: string) {
  patchChild({ color });
}
</script>

<template>
  <div class="w-72 shrink-0 flex flex-col border-l border-border bg-background">
    <!-- Edit toggle at top -->
    <div class="p-3 border-b border-border">
      <button
        class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90"
        @click="store.editMode = false"
      >
        <Play class="size-3.5" />
        Play-Modus
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-5">
      <!-- ── Controller-twin editor ─────────────────────────────────────── -->
      <div v-if="selectedTwin && twinDefinition" class="flex flex-col gap-4">
        <div>
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Controller</span>
          <div class="text-xs font-medium">{{ twinDefinition.label }}</div>
        </div>

        <!-- Device binding -->
        <div class="flex flex-col gap-1.5">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Verbundenes Gerät</span>
          <select
            class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
            :value="boundDriverId ?? ''"
            :disabled="!matchingInstances.length"
            @change="(e) => {
              const v = (e.target as HTMLSelectElement).value;
              if (!v) unbind(); else bindToInstance(v);
            }"
          >
            <option value="">— kein Gerät —</option>
            <option v-for="inst in matchingInstances" :key="inst.id" :value="inst.id">
              {{ inst.deviceLabel ?? '(unbenannt)' }} · {{ inst.status }}
            </option>
          </select>

          <p
            v-if="!matchingInstances.length"
            class="text-[10px] text-muted-foreground leading-snug"
          >
            Noch kein passendes Gerät verbunden.
          </p>

          <NuxtLink
            :to="connectionsRoute"
            class="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium bg-accent hover:bg-accent/80 transition-colors"
          >
            <Settings2 class="size-3.5" />
            Geräte verwalten
          </NuxtLink>

          <div v-if="boundDriver" class="flex flex-col gap-1 mt-1 text-[10px] text-muted-foreground">
            <div>Status: <span class="font-mono">{{ boundDriver.status }}</span></div>
            <div v-if="boundDriver.errorMessage" class="text-destructive">{{ boundDriver.errorMessage }}</div>
          </div>
        </div>

        <!-- Controls list -->
        <div class="flex flex-col gap-1.5">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Steuerelemente</span>
          <div class="max-h-48 overflow-y-auto flex flex-col gap-px">
            <button
              v-for="control in twinDefinition.controls"
              :key="control.id"
              class="text-left px-2 py-1 rounded text-[11px] font-mono transition-colors"
              :class="store.selectedControlId === control.id
                ? 'bg-accent text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'"
              @click="store.selectedControlId = control.id"
            >
              {{ control.id }}
            </button>
          </div>
        </div>

        <!-- Per-control mapping editor -->
        <div v-if="selectedControl" class="flex flex-col gap-2 pt-2 border-t border-border">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {{ selectedControl.id }} · Mapping
          </span>

          <div class="flex flex-col gap-1">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Typ</span>
            <select
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              :value="selectedChild?.mapping?.type ?? 'none'"
              @change="(e) => setMappingType((e.target as HTMLSelectElement).value as LiveMapping['type'])"
            >
              <option value="none">— keins —</option>
              <option value="preset">Preset</option>
              <option value="channel">Kanal</option>
              <option value="effect-param">Effekt-Parameter</option>
              <option value="page-switch">Seite wechseln</option>
            </select>
          </div>

          <div v-if="selectedChild?.mapping?.type === 'preset'" class="flex flex-col gap-1">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Preset</span>
            <select
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              :value="selectedChild.mapping.presetId ?? ''"
              @change="(e) => setMappingPreset((e.target as HTMLSelectElement).value)"
            >
              <option value="">— wählen —</option>
              <option v-for="p in presets" :key="p.id" :value="p.id">{{ p.name ?? p.id }}</option>
            </select>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Label</span>
            <input
              type="text"
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              :value="selectedChild?.label ?? ''"
              @change="(e) => setLabel((e.target as HTMLInputElement).value)"
            />
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Farbe</span>
            <input
              type="color"
              class="w-full h-8 bg-background border border-border rounded"
              :value="selectedChild?.color ?? '#3b82f6'"
              @change="(e) => setColor((e.target as HTMLInputElement).value)"
            />
          </div>
        </div>
      </div>

      <!-- ── Page settings (default view) ───────────────────────────────── -->
      <div v-else-if="store.activePage" class="flex flex-col gap-4">
        <!-- Aspect Ratio -->
        <div class="flex flex-col gap-1.5">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Seitenverhältnis</span>
          <div class="grid grid-cols-1 gap-1">
            <button
              v-for="ar in ASPECT_RATIOS"
              :key="ar.label"
              class="px-2 py-1.5 rounded text-xs font-medium transition-colors text-left"
              :class="store.activePage.aspectRatioW === ar.w && store.activePage.aspectRatioH === ar.h
                ? 'bg-accent text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'"
              @click="setAspectRatio(ar.w, ar.h)"
            >
              {{ ar.label }}
            </button>
          </div>
        </div>

        <!-- Columns -->
        <div class="flex flex-col gap-1.5">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Breite (Spalten)</span>
          <input
            type="number"
            :value="store.activePage.columns"
            min="4"
            max="240"
            step="4"
            class="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground"
            @change="(e) => setColumns(Number((e.target as HTMLInputElement).value))"
          />
        </div>

        <!-- Derived resolution display -->
        <div v-if="resolution" class="flex flex-col gap-1 pt-1 border-t border-border">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Berechnete Auflösung</span>
          <span class="text-xs text-foreground font-mono">{{ resolution.w }} × {{ resolution.h }} px</span>
        </div>
      </div>
    </div>
  </div>
</template>
