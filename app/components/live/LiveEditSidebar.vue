<script setup lang="ts">
import { computed } from 'vue';
import { Play } from 'lucide-vue-next';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useEngineStore } from '~/stores/engine-store';
import { generateSectionAutoColors } from '~/composables/live-ops/hue-ops';
import type { ColorWheelScope } from '~/utils/live/types';
import { useControllerStore } from '~/stores/controller-store';
import { useHistory } from '~/components/engine/composables/use-history';
import {
  UpdateLivePageCommand,
  UpdateControllerChildMappingCommand,
  SetWidgetControllerInstanceCommand,
  AddLiveSectionCommand,
  RemoveLiveSectionCommand,
  UpdateLiveSectionCommand,
  SetSectionMembersCommand,
} from '~/components/engine/commands/live-widget-commands';
import {
  getPageResolution,
  type LiveWidget,
  type LiveMapping,
  type ControllerChildBinding,
  type LiveSection,
  type SectionMember,
  type SectionMode,
  type SectionSource,
} from '~/utils/live/types';
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

const boundDriver = computed(() => {
  const instanceId = selectedTwin.value?.controllerInstanceId;
  return instanceId ? controllerStore.getBindingFor(instanceId) : null;
});

/** Instances from liveControllers that match this twin's controllerKey type */
const matchingInstances = computed(() => {
  const key = selectedTwin.value?.controllerKey;
  if (!key) return [];
  return store.liveControllers.filter(inst => inst.definitionKey === key);
});

function bindInstance(instanceId: string) {
  const twin = selectedTwin.value;
  if (!twin || !store.activePageId) return;
  history.execute(new SetWidgetControllerInstanceCommand(store.activePageId, twin.id, instanceId || null));
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

// ── Sections ────────────────────────────────────────────────────────────────

function memberMatchKey(m: SectionMember): string {
  return `${m.widgetId}::${m.controlId ?? ''}`;
}

// Section-eligible selection. Either a single twin sub-control (priority) OR
// the set of selected non-twin widgets on the canvas.
const selectionMembers = computed<SectionMember[]>(() => {
  if (selectedTwin.value && store.selectedControlId) {
    return [{ widgetId: selectedTwin.value.id, controlId: store.selectedControlId }];
  }
  const page = store.activePage;
  if (!page) return [];
  const result: SectionMember[] = [];
  for (const id of store.selectedWidgetIds) {
    const w = page.widgets.find(x => x.id === id);
    if (!w) continue;
    if (w.type === 'controller-twin') continue;
    result.push({ widgetId: w.id });
  }
  return result;
});

const availableSections = computed<LiveSection[]>(() => store.activePage?.sections ?? []);

// Common section across all selected members (null if mixed or none).
// Also accepts a direct selectedSectionId (set when clicking a twin sub-control
// that belongs to a section, without drilling into the control level).
const selectionSection = computed<LiveSection | null>(() => {
  // Direct section surfaced by the twin click handler.
  if (store.selectedSectionId) {
    return availableSections.value.find(s => s.id === store.selectedSectionId) ?? null;
  }
  const members = selectionMembers.value;
  if (members.length === 0) return null;
  const sections = availableSections.value;
  if (sections.length === 0) return null;
  let candidate: LiveSection | null = null;
  for (const m of members) {
    const mk = memberMatchKey(m);
    const sec = sections.find(s => s.members.some(mm => memberMatchKey(mm) === mk));
    if (!sec) return null;
    if (!candidate) candidate = sec;
    else if (candidate.id !== sec.id) return null;
  }
  return candidate;
});

// Sections eligible as "add target": skip ones the selection already fully belongs to.
const eligibleAddTargets = computed<LiveSection[]>(() => {
  const members = selectionMembers.value;
  if (members.length === 0) return [];
  const keys = members.map(memberMatchKey);
  return availableSections.value.filter(s => {
    const existing = new Set(s.members.map(memberMatchKey));
    return keys.some(k => !existing.has(k));
  });
});

function defaultModeForSource(source: SectionSource): SectionMode {
  switch (source) {
    case 'all-presets':       return 'single-select';
    case 'preset-variants':   return 'single-select';
  }
}

function createSectionFromSelection() {
  if (!store.activePageId) return;
  const members = selectionMembers.value;
  if (members.length === 0) return;
  const source: SectionSource = 'all-presets';
  const section: LiveSection = {
    id: crypto.randomUUID(),
    source,
    mode: defaultModeForSource(source),
    members: members.map(m => ({ ...m })),
  };
  history.execute(new AddLiveSectionCommand(store.activePageId, section));
}

function addSelectionToSection(sectionId: string) {
  const page = store.activePage;
  if (!page || !store.activePageId) return;
  const section = page.sections?.find(s => s.id === sectionId);
  if (!section) return;
  const existing = new Set(section.members.map(memberMatchKey));
  const next = section.members.map(m => ({ ...m }));
  for (const m of selectionMembers.value) {
    if (!existing.has(memberMatchKey(m))) next.push({ ...m });
  }
  history.execute(new SetSectionMembersCommand(store.activePageId, sectionId, next));
}

function removeSelectionFromSection() {
  const sec = selectionSection.value;
  if (!sec || !store.activePageId) return;
  const toRemove = new Set(selectionMembers.value.map(memberMatchKey));
  const next = sec.members.filter(m => !toRemove.has(memberMatchKey(m)));
  if (next.length === 0) {
    // Empty sections have no purpose — drop the whole section instead.
    history.execute(new RemoveLiveSectionCommand(store.activePageId, sec.id));
  } else {
    history.execute(new SetSectionMembersCommand(store.activePageId, sec.id, next));
  }
}

function updateSectionMode(mode: SectionMode) {
  const sec = selectionSection.value;
  if (!sec || !store.activePageId) return;
  history.execute(new UpdateLiveSectionCommand(store.activePageId, sec.id, { mode }));
}

function updateSectionSource(source: SectionSource) {
  const sec = selectionSection.value;
  if (!sec || !store.activePageId) return;
  // When swapping source, snap mode to the source's preferred default — keeps
  // surprise low: e.g. switching to preset-variants resets to single-select.
  history.execute(new UpdateLiveSectionCommand(store.activePageId, sec.id, {
    source,
    mode: defaultModeForSource(source),
  }));
}

function updateSectionName(name: string) {
  const sec = selectionSection.value;
  if (!sec || !store.activePageId) return;
  history.execute(new UpdateLiveSectionCommand(store.activePageId, sec.id, { name }));
}

function deleteSelectedSection() {
  const sec = selectionSection.value;
  if (!sec || !store.activePageId) return;
  history.execute(new RemoveLiveSectionCommand(store.activePageId, sec.id));
}

// Section containing the currently-focused control (for per-control isolation view).
const focusedControlSection = computed<LiveSection | null>(() => {
  const twin = selectedTwin.value;
  const ctrl = selectedControl.value;
  if (!twin || !ctrl) return null;
  const sections = availableSections.value;
  for (const s of sections) {
    if (s.members.some(m => m.widgetId === twin.id && m.controlId === ctrl.id)) return s;
  }
  return null;
});

function removeControlFromSection() {
  const twin = selectedTwin.value;
  const ctrl = selectedControl.value;
  const sec = focusedControlSection.value;
  if (!twin || !ctrl || !sec || !store.activePageId) return;
  const next = sec.members.filter(m => !(m.widgetId === twin.id && m.controlId === ctrl.id));
  if (next.length === 0) {
    history.execute(new RemoveLiveSectionCommand(store.activePageId, sec.id));
  } else {
    history.execute(new SetSectionMembersCommand(store.activePageId, sec.id, next));
  }
  // Drop section isolation since this control is no longer a member.
  store.isolatedSectionId = null;
}

function enterSectionMappingMode() {
  const sec = selectionSection.value;
  if (!sec) return;
  store.sectionMappingMode = sec.id;
  store.isolatedSectionId = null;
  store.isolatedGroupId = null;
  // While mapping, we surface the section directly — no individual widget
  // should appear "selected" with a blue ring on the canvas.
  store.selectedWidgetIds = new Set();
  store.selectedControlId = null;
  store.selectedSectionId = sec.id;
}

const isInMappingMode = computed(() => {
  const sec = selectionSection.value;
  return !!sec && store.sectionMappingMode === sec.id;
});

const SOURCE_LABELS: Record<SectionSource, string> = {
  'all-presets': 'Alle Presets',
  'preset-variants': 'Varianten des aktiven Presets',
};
const MODE_LABELS: Record<SectionMode, string> = {
  'flash': 'Flash (gedrückt = aktiv)',
  'single-select': 'Einzelauswahl (nur einer aktiv)',
  'multi-select': 'Mehrfachauswahl (Toggle)',
};

// ── Color Wheel Widget settings ───────────────────────────────────────────────

const selectedColorWheel = computed(() => {
  if (store.selectedWidgetIds.size !== 1) return null;
  const id = Array.from(store.selectedWidgetIds)[0];
  const widget = store.activePage?.widgets.find(w => w.id === id);
  return widget?.type === 'color-wheel' ? widget : null;
});

const SCOPE_LABELS: Record<ColorWheelScope, string> = {
  'preset': 'Preset (bis Preset wechselt)',
  'variant': 'Variant (bis Variant überschreibt)',
  'global': 'Global (inkl. Flash & Blind)',
};

function setColorWheelScope(scope: ColorWheelScope) {
  const widget = selectedColorWheel.value;
  if (!widget) return;
  widget.colorWheelScope = scope;
}

// ── Section auto-color ────────────────────────────────────────────────────────

function applyAutoColors() {
  const sec = selectionSection.value;
  if (!sec) return;
  const scope = sec.source === 'all-presets' ? 'preset' : 'preset';
  generateSectionAutoColors(sec.id, scope);
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
      <!-- ── Section editor ─────────────────────────────────────────────── -->
      <div v-if="(selectionMembers.length > 0 || selectionSection) && !focusedControlSection" class="flex flex-col gap-2 pb-4 border-b border-border">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sektion</span>
          <span v-if="selectionSection" class="text-[10px] text-muted-foreground">
            {{ selectionMembers.length }} ausgewählt · {{ selectionSection.members.length }} insgesamt
          </span>
        </div>

        <!-- In-section: editor -->
        <template v-if="selectionSection">
          <!-- Mapping mode banner -->
          <div
            v-if="isInMappingMode"
            class="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-violet-500/20 ring-1 ring-violet-400/50"
          >
            <span class="text-[10px] text-violet-300 leading-snug">Klick = Mitgliedschaft umschalten</span>
            <button
              type="button"
              class="shrink-0 px-2 py-1 rounded text-[11px] font-medium bg-violet-500 hover:bg-violet-400 text-white transition-colors"
              @click="store.exitSectionMappingMode()"
            >
              Fertig
            </button>
          </div>

          <div class="flex gap-1.5">
            <input
              type="text"
              class="flex-1 min-w-0 text-xs bg-background border border-border rounded px-2 py-1.5"
              placeholder="Sektionsname"
              :value="selectionSection.name ?? ''"
              @change="(e) => updateSectionName((e.target as HTMLInputElement).value)"
            />
            <button
              type="button"
              class="shrink-0 px-2 py-1.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap"
              :class="isInMappingMode
                ? 'bg-violet-500 hover:bg-violet-400 text-white'
                : 'bg-accent hover:bg-accent/80'"
              title="Buttons der Sektion zuordnen"
              @click="enterSectionMappingMode"
            >
              Zuordnen
            </button>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Inhalt</span>
            <select
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              :value="selectionSection.source"
              @change="(e) => updateSectionSource((e.target as HTMLSelectElement).value as SectionSource)"
            >
              <option v-for="(label, key) in SOURCE_LABELS" :key="key" :value="key">{{ label }}</option>
            </select>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Verhalten</span>
            <select
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              :value="selectionSection.mode"
              @change="(e) => updateSectionMode((e.target as HTMLSelectElement).value as SectionMode)"
            >
              <option v-for="(label, key) in MODE_LABELS" :key="key" :value="key">{{ label }}</option>
            </select>
          </div>

          <!-- Auto-Color -->
          <div class="flex flex-col gap-1">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Farben</span>
            <button
              class="w-full px-2 py-1.5 rounded text-[11px] font-medium bg-accent hover:bg-accent/80 transition-colors text-left"
              title="Hue gleichmäßig über Section-Slots verteilen"
              @click="applyAutoColors"
            >
              Auto-Color generieren
            </button>
          </div>

          <div class="flex gap-1.5 mt-1">
            <button
              class="flex-1 px-2 py-1.5 rounded text-[11px] font-medium bg-accent hover:bg-accent/80 transition-colors"
              @click="removeSelectionFromSection"
            >
              Aus Sektion entfernen
            </button>
            <button
              class="px-2 py-1.5 rounded text-[11px] font-medium bg-destructive/15 hover:bg-destructive/25 text-destructive transition-colors"
              @click="deleteSelectedSection"
            >
              Löschen
            </button>
          </div>
        </template>

        <!-- Not in any section: add / create -->
        <template v-else>
          <p class="text-[10px] text-muted-foreground leading-snug">
            Sektion gruppiert Buttons zu einem dynamischen Set (z.B. alle Presets). Reihenfolge ergibt sich aus der Canvas-Position.
          </p>
          <button
            class="w-full px-2 py-1.5 rounded text-[11px] font-medium bg-accent hover:bg-accent/80 transition-colors"
            @click="createSectionFromSelection"
          >
            Neue Sektion erstellen
          </button>
          <div v-if="eligibleAddTargets.length > 0" class="flex flex-col gap-1">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Zu bestehender Sektion hinzufügen</span>
            <select
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              @change="(e) => {
                const v = (e.target as HTMLSelectElement).value;
                if (v) addSelectionToSection(v);
                (e.target as HTMLSelectElement).value = '';
              }"
            >
              <option value="">— wählen —</option>
              <option v-for="s in eligibleAddTargets" :key="s.id" :value="s.id">
                {{ s.name || SOURCE_LABELS[s.source] }} ({{ s.members.length }})
              </option>
            </select>
          </div>
        </template>
      </div>

      <!-- ── Color Wheel scope selector ──────────────────────────────────── -->
      <div v-if="selectedColorWheel && !selectionSection" class="flex flex-col gap-2 pb-4 border-b border-border">
        <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Color Widget</span>
        <div class="flex flex-col gap-1">
          <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Scope</span>
          <select
            class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
            :value="selectedColorWheel.colorWheelScope ?? 'preset'"
            @change="(e) => setColorWheelScope((e.target as HTMLSelectElement).value as ColorWheelScope)"
          >
            <option v-for="(label, key) in SCOPE_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>
        <p class="text-[10px] text-muted-foreground/60 leading-snug">
          <template v-if="(selectedColorWheel.colorWheelScope ?? 'preset') === 'preset'">Hue gilt nur für das aktuell aktive Preset. Bei Preset-Wechsel wird der neue Preset-Wert angezeigt.</template>
          <template v-else-if="selectedColorWheel.colorWheelScope === 'variant'">Hue gilt pro Variant. Flash/Blind-Presets werden nicht beeinflusst.</template>
          <template v-else>Hue gilt global für alle Presets, inkl. Flash und Blind.</template>
        </p>
      </div>

      <!-- ── Twin-level: controller + device binding (no control focus) ── -->
      <div
        v-if="selectedTwin && twinDefinition && !store.selectedControlId && !selectionSection"
        class="flex flex-col gap-4"
      >
        <div>
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Controller</span>
          <div class="text-xs font-medium">{{ twinDefinition.label }}</div>
        </div>

        <div class="flex flex-col gap-2">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Gerät</span>

          <!-- Instance picker -->
          <div v-if="matchingInstances.length" class="flex flex-col gap-1">
            <label class="text-[10px] text-muted-foreground">Instanz</label>
            <select
              class="w-full rounded border border-border bg-background text-xs px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
              :value="selectedTwin?.controllerInstanceId ?? ''"
              @change="bindInstance(($event.target as HTMLSelectElement).value)"
            >
              <option value="">— keine —</option>
              <option
                v-for="inst in matchingInstances"
                :key="inst.id"
                :value="inst.id"
              >
                {{ (controllerStore.drivers.get(inst.id) as any)?.deviceLabel ?? twinDefinition?.label }}
                ({{ (controllerStore.drivers.get(inst.id) as any)?.status ?? 'getrennt' }})
              </option>
            </select>
          </div>
          <p v-else class="text-[10px] text-muted-foreground/70 leading-snug">
            Noch keine Instanz angelegt. Gehe zu
            <NuxtLink :to="`/project/${engineStore.currentProjectId}/connections?tab=inputs`" class="underline">Connections</NuxtLink>
            um ein Gerät hinzuzufügen.
          </p>

          <!-- Status row (only when bound) -->
          <div v-if="boundDriver" class="flex items-center justify-between text-xs">
            <span class="text-muted-foreground/70">Status</span>
            <span v-if="(boundDriver as any)?.status === 'connected'" class="text-green-400 font-medium">
              {{ (boundDriver as any)?.deviceLabel ?? twinDefinition?.label }}
            </span>
            <span v-else-if="(boundDriver as any)?.status === 'connecting'" class="text-yellow-400">Verbinde…</span>
            <span v-else-if="(boundDriver as any)?.status === 'error'" class="text-destructive">Fehler</span>
            <span v-else class="text-muted-foreground/50">Nicht verbunden</span>
          </div>

          <!-- Error detail -->
          <p v-if="(boundDriver as any)?.errorMessage" class="text-[10px] text-destructive leading-snug">
            {{ (boundDriver as any).errorMessage }}
          </p>
        </div>

        <p class="text-[10px] text-muted-foreground leading-snug">
          Klick auf ein Pad / Fader im Twin, um es zu konfigurieren.
        </p>
      </div>

      <!-- ── Control-level: per-control mapping (control focused) ──────── -->
      <div
        v-else-if="selectedTwin && twinDefinition && store.selectedControlId && selectedControl"
        class="flex flex-col gap-2"
      >
        <button
          type="button"
          class="self-start text-[10px] text-muted-foreground hover:text-foreground"
          @click="() => { store.selectedControlId = null; store.isolatedSectionId = null; }"
        >
          ← Zurück zum Controller
        </button>

        <!-- Section-isolated control: section indicator + remove button -->
        <div
          v-if="focusedControlSection"
          class="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-yellow-400/10 ring-1 ring-yellow-400/40"
        >
          <span class="text-[10px] text-yellow-300 leading-snug truncate">
            Teil von „{{ focusedControlSection.name || SOURCE_LABELS[focusedControlSection.source] }}"
          </span>
          <button
            type="button"
            class="shrink-0 px-2 py-1 rounded text-[10px] font-medium bg-accent hover:bg-accent/80 transition-colors whitespace-nowrap"
            @click="removeControlFromSection"
          >
            Entfernen
          </button>
        </div>

        <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ selectedControl.label ?? selectedControl.id }} · Mapping
        </span>

        <div class="flex flex-col gap-1" :class="{ 'opacity-50 pointer-events-none': focusedControlSection }">
          <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Typ</span>
          <select
            v-if="!focusedControlSection"
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
          <div v-else class="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-muted-foreground">
            Sektion
          </div>
        </div>

        <div v-if="!focusedControlSection && selectedChild?.mapping?.type === 'preset'" class="flex flex-col gap-1">
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

        <div class="flex flex-col gap-1" :class="{ 'opacity-50 pointer-events-none': focusedControlSection }">
          <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Label</span>
          <input
            type="text"
            class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
            :value="selectedChild?.label ?? ''"
            :disabled="!!focusedControlSection"
            @change="(e) => setLabel((e.target as HTMLInputElement).value)"
          />
        </div>

        <div v-if="!focusedControlSection" class="flex flex-col gap-1">
          <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Farbe</span>
          <input
            type="color"
            class="w-full h-8 bg-background border border-border rounded"
            :value="selectedChild?.color ?? '#3b82f6'"
            @change="(e) => setColor((e.target as HTMLInputElement).value)"
          />
        </div>
      </div>

      <!-- ── Page settings (default view) ───────────────────────────────── -->
      <div v-else-if="store.activePage && !selectionSection" class="flex flex-col gap-4">
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
