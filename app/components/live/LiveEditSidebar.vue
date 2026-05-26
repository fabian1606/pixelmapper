<script setup lang="ts">
import { computed } from 'vue';
import { Play } from 'lucide-vue-next';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useEngineStore } from '~/stores/engine-store';
import { useControllerStore } from '~/stores/controller-store';
import { useHistory } from '~/components/engine/composables/use-history';
import {
  UpdateLivePageCommand,
  UpdateControllerChildMappingCommand,
  UpdateWidgetMappingCommand,
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
  type SectionColorEntry,
  type SectionMember,
  type SectionMode,
  type SectionSource,
  type GlobalFunctionType,
  type StrobeConfig,
  type BlindConfig,
  type SpeedConfig,
  defaultStrobeConfig,
  defaultBlindConfig,
  defaultSpeedConfig,
} from '~/utils/live/types';
import { getControllerDefinition } from '~/utils/controllers/catalog';
import { getPresetNaturalRGB, growColorVariants, type RGB } from '~/utils/live/color-utils';

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

// ── Selected plain-button editing ────────────────────────────────────────────

/** Single selected non-twin widget (any type except controller-twin). */
const selectedButton = computed<LiveWidget | null>(() => {
  if (store.selectedWidgetIds.size !== 1) return null;
  const id = Array.from(store.selectedWidgetIds)[0];
  const widget = store.activePage?.widgets.find(w => w.id === id);
  return widget && widget.type !== 'controller-twin' ? widget : null;
});

function patchWidget(patch: Partial<Pick<LiveWidget, 'mapping' | 'label' | 'color'>>) {
  const w = selectedButton.value;
  if (!w || !store.activePageId) return;
  history.execute(new UpdateWidgetMappingCommand(store.activePageId, w.id, patch));
}

function setButtonMappingType(type: LiveMapping['type']) {
  const base: LiveMapping = { type };
  if (type === 'global-function') {
    base.globalFunction = 'strobe';
    base.globalFunctionConfig = defaultStrobeConfig();
  }
  patchWidget({ mapping: base });
}

function setButtonGlobalFunction(fn: GlobalFunctionType) {
  const w = selectedButton.value;
  if (!w) return;
  let config: any = {};
  if (fn === 'strobe') config = defaultStrobeConfig();
  else if (fn === 'blind') config = defaultBlindConfig();
  else if (fn === 'speed') config = defaultSpeedConfig();
  patchWidget({ mapping: { type: 'global-function', globalFunction: fn, globalFunctionConfig: config } });
}

function setButtonSpeedConfig(patch: Partial<SpeedConfig>) {
  const w = selectedButton.value;
  if (!w) return;
  const existing = (w.mapping.globalFunctionConfig ?? {}) as SpeedConfig;
  patchWidget({ mapping: { ...w.mapping, globalFunctionConfig: { ...defaultSpeedConfig(), ...existing, ...patch } } });
}

function setButtonStrobeConfig(patch: Partial<StrobeConfig>) {
  const w = selectedButton.value;
  if (!w) return;
  const existing = (w.mapping.globalFunctionConfig ?? {}) as StrobeConfig;
  patchWidget({ mapping: { ...w.mapping, globalFunctionConfig: { ...defaultStrobeConfig(), ...existing, ...patch } } });
}

function setButtonBlindConfig(patch: Partial<BlindConfig>) {
  const w = selectedButton.value;
  if (!w) return;
  const existing = (w.mapping.globalFunctionConfig ?? {}) as BlindConfig;
  patchWidget({ mapping: { ...w.mapping, globalFunctionConfig: { ...defaultBlindConfig(), ...existing, ...patch } } });
}

function setButtonLabel(label: string) {
  patchWidget({ label });
}

function setButtonColor(color: string) {
  patchWidget({ color });
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

// ── Dimmer-group helpers ────────────────────────────────────────────────────

const dimmerGroupNodes = computed(() =>
  (engineStore.sceneNodes as any[]).filter(n => n.children != null),
);

function dimmerGroupValue(mapping: LiveMapping): string {
  if (mapping.groupId) return `group:${mapping.groupId}`;
  if (mapping.fixtureId != null) return `fixture:${mapping.fixtureId}`;
  return '';
}

function setDimmerGroupForWidget(raw: string) {
  if (!raw) {
    patchWidget({ mapping: { type: 'dimmer-group' } });
  } else if (raw.startsWith('group:')) {
    patchWidget({ mapping: { type: 'dimmer-group', groupId: raw.slice(6), fixtureId: undefined } });
  } else {
    patchWidget({ mapping: { type: 'dimmer-group', fixtureId: raw.slice(8), groupId: undefined } });
  }
}

function setDimmerGroupForChild(raw: string) {
  if (!raw) {
    patchChild({ mapping: { type: 'dimmer-group' } });
  } else if (raw.startsWith('group:')) {
    patchChild({ mapping: { type: 'dimmer-group', groupId: raw.slice(6), fixtureId: undefined } });
  } else {
    patchChild({ mapping: { type: 'dimmer-group', fixtureId: raw.slice(8), groupId: undefined } });
  }
}

// ── Channel (DMX) with group support ───────────────────────────────────────

function findGroupFixtures(groupId: string | number): any[] {
  const findGroup = (nodes: any[]): any => {
    for (const node of nodes) {
      if (String(node.id) === String(groupId)) return node;
      if (node.children?.length) { const f = findGroup(node.children); if (f) return f; }
    }
    return null;
  };
  const g = findGroup(engineStore.sceneNodes as any[]);
  return g?.getAllFixtures?.() ?? [];
}

function channelTypesForGroup(groupId: string | number): string[] {
  const fixtures = findGroupFixtures(groupId);
  const seen = new Set<string>();
  for (const f of fixtures) {
    for (const ch of f.channels) {
      if (ch.type) seen.add(ch.type);
    }
  }
  return [...seen].sort();
}

// shared value helper for channel mapping (group:X or fixture:X)
function channelTargetValue(mapping: LiveMapping): string {
  if (mapping.groupId) return `group:${mapping.groupId}`;
  if (mapping.fixtureId != null) return `fixture:${mapping.fixtureId}`;
  return '';
}

function setChannelTargetForWidget(raw: string) {
  if (!raw) {
    patchWidget({ mapping: { type: 'channel' } });
  } else if (raw.startsWith('group:')) {
    patchWidget({ mapping: { type: 'channel', groupId: raw.slice(6), fixtureId: undefined, channelOffset: undefined } });
  } else {
    patchWidget({ mapping: { type: 'channel', fixtureId: raw.slice(8), groupId: undefined, channelType: undefined } });
  }
}

function setChannelTargetForChild(raw: string) {
  if (!raw) {
    patchChild({ mapping: { type: 'channel' } });
  } else if (raw.startsWith('group:')) {
    patchChild({ mapping: { type: 'channel', groupId: raw.slice(6), fixtureId: undefined, channelOffset: undefined } });
  } else {
    patchChild({ mapping: { type: 'channel', fixtureId: raw.slice(8), groupId: undefined, channelType: undefined } });
  }
}

function patchChild(patch: Partial<Pick<ControllerChildBinding, 'mapping' | 'label' | 'color'>>) {
  const twin = selectedTwin.value;
  const ctrl = selectedControl.value;
  if (!twin || !ctrl || !store.activePageId) return;
  history.execute(new UpdateControllerChildMappingCommand(
    store.activePageId, twin.id, ctrl.id, patch,
  ));
}

function setMappingType(type: LiveMapping['type']) {
  if (type === 'global-function') {
    patchChild({ mapping: { type, globalFunction: 'strobe', globalFunctionConfig: defaultStrobeConfig() } });
  } else {
    patchChild({ mapping: { type } });
  }
}

function setMappingPreset(presetId: string) {
  patchChild({ mapping: { type: 'preset', presetId } });
}

function setChildGlobalFunction(fn: GlobalFunctionType) {
  let config: any = {};
  if (fn === 'strobe') config = defaultStrobeConfig();
  else if (fn === 'blind') config = defaultBlindConfig();
  else if (fn === 'speed') config = defaultSpeedConfig();
  patchChild({ mapping: { type: 'global-function', globalFunction: fn, globalFunctionConfig: config } });
}

function setChildSpeedConfig(patch: Partial<SpeedConfig>) {
  const child = selectedChild.value;
  if (!child) return;
  const existing = (child.mapping.globalFunctionConfig ?? {}) as SpeedConfig;
  patchChild({ mapping: { ...child.mapping, globalFunctionConfig: { ...defaultSpeedConfig(), ...existing, ...patch } } });
}

function setChildStrobeConfig(patch: Partial<StrobeConfig>) {
  const child = selectedChild.value;
  if (!child) return;
  const existing = (child.mapping.globalFunctionConfig ?? {}) as StrobeConfig;
  patchChild({ mapping: { ...child.mapping, globalFunctionConfig: { ...defaultStrobeConfig(), ...existing, ...patch } } });
}

function setChildBlindConfig(patch: Partial<BlindConfig>) {
  const child = selectedChild.value;
  if (!child) return;
  const existing = (child.mapping.globalFunctionConfig ?? {}) as BlindConfig;
  patchChild({ mapping: { ...child.mapping, globalFunctionConfig: { ...defaultBlindConfig(), ...existing, ...patch } } });
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
    case 'all-presets':         return 'single-select';
    case 'preset-variants':     return 'single-select';
    case 'color-variants':      return 'single-select';
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
  const patch: Partial<Omit<LiveSection, 'id' | 'members'>> = {
    source,
    mode: defaultModeForSource(source),
  };
  // Seed a stable color palette so it doesn't shift on every recount.
  if (source === 'color-variants') {
    const baseRGB = engineStore.selectedPresetId
      ? getPresetNaturalRGB(engineStore.selectedPresetId, engineStore.savedPresets)
      : null;
    patch.colorVariants = growColorVariants(sec.colorVariants, sec.members.length, baseRGB);
  }
  history.execute(new UpdateLiveSectionCommand(store.activePageId, sec.id, patch));
}

/** Update a single slot's stored color (slot 0 is always preset-natural and not user-editable). */
function setColorVariantSlot(index: number, rgb: RGB) {
  const sec = selectionSection.value;
  if (!sec || !store.activePageId) return;
  if (index <= 0) return;
  const baseRGB = engineStore.selectedPresetId
    ? getPresetNaturalRGB(engineStore.selectedPresetId, engineStore.savedPresets)
    : null;
  const current = growColorVariants(sec.colorVariants, sec.members.length, baseRGB);
  const next: SectionColorEntry[] = current.map((e, i) => i === index ? { ...rgb } : e);
  history.execute(new UpdateLiveSectionCommand(store.activePageId, sec.id, { colorVariants: next }));
}

function regenerateColorVariants() {
  const sec = selectionSection.value;
  if (!sec || !store.activePageId) return;
  const baseRGB = engineStore.selectedPresetId
    ? getPresetNaturalRGB(engineStore.selectedPresetId, engineStore.savedPresets)
    : null;
  const fresh = growColorVariants(undefined, sec.members.length, baseRGB);
  history.execute(new UpdateLiveSectionCommand(store.activePageId, sec.id, { colorVariants: fresh }));
}

/** Hex string ("#rrggbb") for a slot's effective color, used in the editor swatches. */
function slotHex(index: number): string {
  const sec = selectionSection.value;
  if (!sec) return '#000000';
  const baseRGB = engineStore.selectedPresetId
    ? getPresetNaturalRGB(engineStore.selectedPresetId, engineStore.savedPresets)
    : null;
  const entries = growColorVariants(sec.colorVariants, sec.members.length, baseRGB);
  const entry = entries[index];
  const rgb = entry ?? baseRGB;
  if (!rgb) return '#000000';
  const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function hexToRGB(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return { r: parseInt(m[1]!, 16), g: parseInt(m[2]!, 16), b: parseInt(m[3]!, 16) };
}

function onSlotColorInput(index: number, value: string) {
  const rgb = hexToRGB(value);
  if (rgb) setColorVariantSlot(index, rgb);
}

/** Visible slot indices for the color editor (matches the section's member count). */
const colorVariantSlots = computed<number[]>(() => {
  const sec = selectionSection.value;
  if (!sec || sec.source !== 'color-variants') return [];
  return Array.from({ length: sec.members.length }, (_, i) => i);
});

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
  'all-presets': 'All Presets',
  'preset-variants': 'Variants of Active Preset',
  'color-variants': 'Color Variants',
};
const MODE_LABELS: Record<SectionMode, string> = {
  'flash': 'Flash (hold = active)',
  'single-select': 'Single-select (one active)',
  'multi-select': 'Multi-select (toggle)',
};

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
        Play Mode
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-5">
      <!-- ── Section editor ─────────────────────────────────────────────── -->
      <div v-if="(selectionMembers.length > 0 || selectionSection) && !focusedControlSection" class="flex flex-col gap-2 pb-4 border-b border-border">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Section</span>
          <span v-if="selectionSection" class="text-[10px] text-muted-foreground">
            {{ selectionMembers.length }} selected · {{ selectionSection.members.length }} total
          </span>
        </div>

        <!-- In-section: editor -->
        <template v-if="selectionSection">
          <!-- Mapping mode banner -->
          <div
            v-if="isInMappingMode"
            class="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-violet-500/20 ring-1 ring-violet-400/50"
          >
            <span class="text-[10px] text-violet-300 leading-snug">Click = toggle membership</span>
            <button
              type="button"
              class="shrink-0 px-2 py-1 rounded text-[11px] font-medium bg-violet-500 hover:bg-violet-400 text-white transition-colors"
              @click="store.exitSectionMappingMode()"
            >
              Done
            </button>
          </div>

          <div class="flex gap-1.5">
            <input
              type="text"
              class="flex-1 min-w-0 text-xs bg-background border border-border rounded px-2 py-1.5"
              placeholder="Section name"
              :value="selectionSection.name ?? ''"
              @change="(e) => updateSectionName((e.target as HTMLInputElement).value)"
            />
            <button
              type="button"
              class="shrink-0 px-2 py-1.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap"
              :class="isInMappingMode
                ? 'bg-violet-500 hover:bg-violet-400 text-white'
                : 'bg-accent hover:bg-accent/80'"
              title="Assign buttons to this section"
              @click="enterSectionMappingMode"
            >
              Assign
            </button>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Content</span>
            <select
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              :value="selectionSection.source"
              @change="(e) => updateSectionSource((e.target as HTMLSelectElement).value as SectionSource)"
            >
              <option v-for="(label, key) in SOURCE_LABELS" :key="key" :value="key">{{ label }}</option>
            </select>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Behavior</span>
            <select
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              :value="selectionSection.mode"
              @change="(e) => updateSectionMode((e.target as HTMLSelectElement).value as SectionMode)"
            >
              <option v-for="(label, key) in MODE_LABELS" :key="key" :value="key">{{ label }}</option>
            </select>
          </div>

          <!-- Color Variants editor: stable, editable palette -->
          <div v-if="selectionSection.source === 'color-variants'" class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between">
              <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Colors</span>
              <button
                type="button"
                class="text-[9px] text-muted-foreground/70 hover:text-muted-foreground underline-offset-2 hover:underline"
                title="Regenerate evenly distributed colors"
                @click="regenerateColorVariants"
              >
                Regenerate
              </button>
            </div>
            <div class="flex flex-col gap-1">
              <div
                v-for="i in colorVariantSlots"
                :key="i"
                class="flex items-center gap-2 text-[10px]"
              >
                <span class="text-muted-foreground/60 w-5 tabular-nums">{{ i + 1 }}</span>
                <template v-if="i === 0">
                  <div
                    class="w-5 h-5 rounded border border-border shrink-0"
                    :style="{ backgroundColor: slotHex(i) }"
                  />
                  <span class="text-muted-foreground/70">Preset (auto)</span>
                </template>
                <template v-else>
                  <input
                    type="color"
                    class="w-5 h-5 rounded border border-border shrink-0 cursor-pointer bg-transparent p-0"
                    :value="slotHex(i)"
                    @input="(e) => onSlotColorInput(i, (e.target as HTMLInputElement).value)"
                  />
                  <span class="text-muted-foreground/70 font-mono">{{ slotHex(i) }}</span>
                </template>
              </div>
            </div>
          </div>

          <div class="flex gap-1.5 mt-1">
            <button
              class="flex-1 px-2 py-1.5 rounded text-[11px] font-medium bg-accent hover:bg-accent/80 transition-colors"
              @click="removeSelectionFromSection"
            >
              Remove from section
            </button>
            <button
              class="px-2 py-1.5 rounded text-[11px] font-medium bg-destructive/15 hover:bg-destructive/25 text-destructive transition-colors"
              @click="deleteSelectedSection"
            >
              Delete
            </button>
          </div>
        </template>

        <!-- Not in any section: add / create -->
        <template v-else>
          <p class="text-[10px] text-muted-foreground leading-snug">
            A section groups buttons into a dynamic set (e.g. all presets). Order follows canvas position.
          </p>
          <button
            class="w-full px-2 py-1.5 rounded text-[11px] font-medium bg-accent hover:bg-accent/80 transition-colors"
            @click="createSectionFromSelection"
          >
            Create new section
          </button>
          <div v-if="eligibleAddTargets.length > 0" class="flex flex-col gap-1">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Add to existing section</span>
            <select
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              @change="(e) => {
                const v = (e.target as HTMLSelectElement).value;
                if (v) addSelectionToSection(v);
                (e.target as HTMLSelectElement).value = '';
              }"
            >
              <option value="">— choose —</option>
              <option v-for="s in eligibleAddTargets" :key="s.id" :value="s.id">
                {{ s.name || SOURCE_LABELS[s.source] }} ({{ s.members.length }})
              </option>
            </select>
          </div>
        </template>
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
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Device</span>

          <!-- Instance picker -->
          <div v-if="matchingInstances.length" class="flex flex-col gap-1">
            <label class="text-[10px] text-muted-foreground">Instance</label>
            <select
              class="w-full rounded border border-border bg-background text-xs px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
              :value="selectedTwin?.controllerInstanceId ?? ''"
              @change="bindInstance(($event.target as HTMLSelectElement).value)"
            >
              <option value="">— none —</option>
              <option
                v-for="inst in matchingInstances"
                :key="inst.id"
                :value="inst.id"
              >
                {{ (controllerStore.drivers.get(inst.id) as any)?.deviceLabel ?? twinDefinition?.label }}
                ({{ (controllerStore.drivers.get(inst.id) as any)?.status ?? 'disconnected' }})
              </option>
            </select>
          </div>
          <p v-else class="text-[10px] text-muted-foreground/70 leading-snug">
            No instance yet. Go to
            <NuxtLink :to="`/project/${engineStore.currentProjectId}/connections?tab=inputs`" class="underline">Connections</NuxtLink>
            to add a device.
          </p>

          <!-- Status row (only when bound) -->
          <div v-if="boundDriver" class="flex items-center justify-between text-xs">
            <span class="text-muted-foreground/70">Status</span>
            <span v-if="(boundDriver as any)?.status === 'connected'" class="text-green-400 font-medium">
              {{ (boundDriver as any)?.deviceLabel ?? twinDefinition?.label }}
            </span>
            <span v-else-if="(boundDriver as any)?.status === 'connecting'" class="text-yellow-400">Connecting…</span>
            <span v-else-if="(boundDriver as any)?.status === 'error'" class="text-destructive">Error</span>
            <span v-else class="text-muted-foreground/50">Not connected</span>
          </div>

          <!-- Error detail -->
          <p v-if="(boundDriver as any)?.errorMessage" class="text-[10px] text-destructive leading-snug">
            {{ (boundDriver as any).errorMessage }}
          </p>
        </div>

        <p class="text-[10px] text-muted-foreground leading-snug">
          Click a pad / fader in the twin to configure it.
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
          ← Back to controller
        </button>

        <!-- Section-isolated control: section indicator + remove button -->
        <div
          v-if="focusedControlSection"
          class="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-yellow-400/10 ring-1 ring-yellow-400/40"
        >
          <span class="text-[10px] text-yellow-300 leading-snug truncate">
            Part of "{{ focusedControlSection.name || SOURCE_LABELS[focusedControlSection.source] }}"
          </span>
          <button
            type="button"
            class="shrink-0 px-2 py-1 rounded text-[10px] font-medium bg-accent hover:bg-accent/80 transition-colors whitespace-nowrap"
            @click="removeControlFromSection"
          >
            Remove
          </button>
        </div>

        <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ selectedControl.label ?? selectedControl.id }} · Mapping
        </span>

        <div class="flex flex-col gap-1" :class="{ 'opacity-50 pointer-events-none': focusedControlSection }">
          <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Type</span>
          <!-- Slider controls: only fader-relevant options -->
          <select
            v-if="!focusedControlSection && selectedControl?.type === 'slider'"
            class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
            :value="selectedChild?.mapping?.type ?? 'none'"
            @change="(e) => setMappingType((e.target as HTMLSelectElement).value as LiveMapping['type'])"
          >
            <option value="none">— none —</option>
            <option value="channel">Channel (DMX)</option>
            <option value="dimmer-group">Dimmer Group</option>
            <option value="effect-param">Effect parameter</option>
          </select>
          <!-- Button/other controls: all options -->
          <select
            v-else-if="!focusedControlSection"
            class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
            :value="selectedChild?.mapping?.type ?? 'none'"
            @change="(e) => setMappingType((e.target as HTMLSelectElement).value as LiveMapping['type'])"
          >
            <option value="none">— none —</option>
            <option value="preset">Preset</option>
            <option value="channel">Channel (DMX)</option>
            <option value="dimmer-group">Dimmer Group</option>
            <option value="effect-param">Effect parameter</option>
            <option value="global-function">Global Function</option>
            <option value="page-switch">Page switch</option>
          </select>
          <div v-else class="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-muted-foreground">
            Section
          </div>
        </div>

        <div v-if="!focusedControlSection && selectedChild?.mapping?.type === 'preset'" class="flex flex-col gap-1">
          <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Preset</span>
          <select
            class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
            :value="selectedChild.mapping.presetId ?? ''"
            @change="(e) => setMappingPreset((e.target as HTMLSelectElement).value)"
          >
            <option value="">— choose —</option>
            <option v-for="p in presets" :key="p.id" :value="p.id">{{ p.name ?? p.id }}</option>
          </select>
        </div>

        <!-- Channel picker (controller-twin) -->
        <div v-if="!focusedControlSection && selectedChild?.mapping?.type === 'channel'" class="flex flex-col gap-1">
          <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Target</span>
          <select
            class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
            :value="channelTargetValue(selectedChild.mapping)"
            @change="(e) => setChannelTargetForChild((e.target as HTMLSelectElement).value)"
          >
            <option value="">— choose group or fixture —</option>
            <optgroup v-if="dimmerGroupNodes.length" label="Groups">
              <option v-for="node in dimmerGroupNodes" :key="node.id" :value="`group:${node.id}`">{{ node.name }}</option>
            </optgroup>
            <optgroup label="Fixtures">
              <option v-for="f in engineStore.flatFixtures" :key="f.id" :value="`fixture:${f.id}`">{{ f.name }}</option>
            </optgroup>
          </select>

          <!-- Group selected → pick channel type -->
          <template v-if="selectedChild?.mapping.groupId">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60 pt-1">Channel Type</span>
            <select
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              :value="selectedChild.mapping.channelType ?? ''"
              @change="(e) => { if (selectedChild) patchChild({ mapping: { ...selectedChild.mapping, channelType: (e.target as HTMLSelectElement).value } }); }"
            >
              <option value="">— choose type —</option>
              <option v-for="t in channelTypesForGroup(selectedChild.mapping.groupId)" :key="t" :value="t">{{ t }}</option>
            </select>
          </template>

          <!-- Fixture selected → pick channel index -->
          <template v-else-if="selectedChild?.mapping.fixtureId != null">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60 pt-1">Channel</span>
            <select
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              :value="selectedChild?.mapping.channelOffset ?? ''"
              @change="(e) => {
                const channelOffset = Number((e.target as HTMLSelectElement).value);
                if (selectedChild) patchChild({ mapping: { ...selectedChild.mapping, channelOffset } });
              }"
            >
              <option value="">— choose channel —</option>
              <option v-for="(ch, idx) in engineStore.flatFixtures.find(f => f.id === selectedChild?.mapping.fixtureId)?.channels ?? []" :key="idx" :value="idx">
                {{ ch.oflChannelName || `Ch ${idx}` }}
              </option>
            </select>
          </template>
        </div>

        <!-- Dimmer group picker (controller-twin) -->
        <div v-if="!focusedControlSection && selectedChild?.mapping?.type === 'dimmer-group'" class="flex flex-col gap-1">
          <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Target</span>
          <select
            class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
            :value="dimmerGroupValue(selectedChild.mapping)"
            @change="(e) => setDimmerGroupForChild((e.target as HTMLSelectElement).value)"
          >
            <option value="">— choose group or fixture —</option>
            <optgroup v-if="dimmerGroupNodes.length" label="Groups">
              <option v-for="node in dimmerGroupNodes" :key="node.id" :value="`group:${node.id}`">
                {{ node.name }}
              </option>
            </optgroup>
            <optgroup label="Fixtures">
              <option v-for="f in engineStore.flatFixtures" :key="f.id" :value="`fixture:${f.id}`">
                {{ f.name }}
              </option>
            </optgroup>
          </select>
        </div>

        <!-- Effect parameter picker (controller-twin) -->
        <div v-if="!focusedControlSection && selectedChild?.mapping?.type === 'effect-param'" class="flex flex-col gap-1">
          <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Effect</span>
          <select
            class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
            :value="selectedChild.mapping.effectId ?? ''"
            @change="(e) => patchChild({ mapping: { type: 'effect-param', effectId: (e.target as HTMLSelectElement).value } })"
          >
            <option value="">— choose effect —</option>
            <option v-for="eff in engineStore.activeEffects" :key="eff.id" :value="eff.id">
              {{ eff.id }}
            </option>
          </select>
          <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60 pt-1">Parameter</span>
          <select
            class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
            :value="selectedChild?.mapping.paramKey ?? ''"
            @change="(e) => { if (selectedChild) patchChild({ mapping: { ...selectedChild.mapping, paramKey: (e.target as HTMLSelectElement).value } }); }"
          >
            <option value="">— choose parameter —</option>
            <option value="strength">Strength</option>
            <option value="speed">Speed</option>
            <option value="fanning">Fanning</option>
            <option value="waveformParams.param">Waveform Param</option>
            <option value="waveformParams.start">Waveform Start</option>
            <option value="waveformParams.end">Waveform End</option>
          </select>
        </div>

        <!-- Global Function config (controller-twin per-control) -->
        <div v-if="!focusedControlSection && selectedChild?.mapping?.type === 'global-function'" class="flex flex-col gap-2">
          <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Function</span>
          <select
            class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
            :value="selectedChild.mapping.globalFunction ?? 'strobe'"
            @change="(e) => setChildGlobalFunction((e.target as HTMLSelectElement).value as GlobalFunctionType)"
          >
            <option value="strobe">Strobe</option>
            <option value="blind">Blind (Full White)</option>
            <option value="blackout">Blackout</option>
            <option value="speed">Speed</option>
          </select>

          <template v-if="selectedChild.mapping.globalFunction === 'speed'">
            <div class="flex items-center gap-2 text-xs">
              <label class="text-muted-foreground/70 w-20 shrink-0">Multiplier</label>
              <input
                type="number"
                min="0"
                max="16"
                step="0.25"
                class="flex-1 bg-background border border-border rounded px-2 py-1"
                :value="(selectedChild.mapping.globalFunctionConfig as any)?.multiplier ?? 2"
                @change="(e) => setChildSpeedConfig({ multiplier: Number((e.target as HTMLInputElement).value) })"
              />
            </div>
            <div class="flex items-center gap-2 text-xs">
              <label class="text-muted-foreground/70 w-20 shrink-0">Behavior</label>
              <select
                class="flex-1 text-xs bg-background border border-border rounded px-2 py-1"
                :value="(selectedChild.mapping.globalFunctionConfig as any)?.behavior ?? 'latch'"
                @change="(e) => setChildSpeedConfig({ behavior: (e.target as HTMLSelectElement).value as 'hold' | 'latch' })"
              >
                <option value="latch">Latch</option>
                <option value="hold">Hold</option>
              </select>
            </div>
          </template>

          <template v-if="selectedChild.mapping.globalFunction === 'strobe'">
            <div class="flex items-center gap-2 text-xs">
              <label class="text-muted-foreground/70 w-20 shrink-0">Beat sync</label>
              <input
                type="checkbox"
                :checked="(selectedChild.mapping.globalFunctionConfig as any)?.beatSync ?? false"
                @change="(e) => setChildStrobeConfig({ beatSync: (e.target as HTMLInputElement).checked })"
              />
            </div>
            <div v-if="!(selectedChild.mapping.globalFunctionConfig as any)?.beatSync" class="flex items-center gap-2 text-xs">
              <label class="text-muted-foreground/70 w-20 shrink-0">Hz</label>
              <input
                type="number"
                min="0.5"
                max="25"
                step="0.5"
                class="flex-1 bg-background border border-border rounded px-2 py-1"
                :value="(selectedChild.mapping.globalFunctionConfig as any)?.frequency ?? 8"
                @change="(e) => setChildStrobeConfig({ frequency: Number((e.target as HTMLInputElement).value) })"
              />
            </div>
            <div v-else class="flex items-center gap-2 text-xs">
              <label class="text-muted-foreground/70 w-20 shrink-0">Division</label>
              <select
                class="flex-1 text-xs bg-background border border-border rounded px-2 py-1"
                :value="String((selectedChild.mapping.globalFunctionConfig as any)?.beatDivision ?? 8)"
                @change="(e) => setChildStrobeConfig({ beatDivision: Number((e.target as HTMLSelectElement).value) })"
              >
                <option value="1">1 (quarter)</option>
                <option value="2">2 (8th)</option>
                <option value="4">4 (16th)</option>
                <option value="8">8 (32nd)</option>
                <option value="0.5">½ (half)</option>
                <option value="0.25">¼ (whole)</option>
              </select>
            </div>
          </template>

          <template v-if="selectedChild.mapping.globalFunction === 'blind'">
            <div class="flex items-center gap-2 text-xs">
              <label class="text-muted-foreground/70 w-20 shrink-0">Color</label>
              <input
                type="color"
                class="flex-1 h-7 bg-background border border-border rounded"
                :value="(selectedChild.mapping.globalFunctionConfig as any)?.color ?? '#ffffff'"
                @change="(e) => setChildBlindConfig({ color: (e.target as HTMLInputElement).value })"
              />
            </div>
            <div class="flex items-center gap-2 text-xs">
              <label class="text-muted-foreground/70 w-20 shrink-0">Dimmer ramp</label>
              <input
                type="checkbox"
                :checked="(selectedChild.mapping.globalFunctionConfig as any)?.dimmerCurve ?? false"
                @change="(e) => setChildBlindConfig({ dimmerCurve: (e.target as HTMLInputElement).checked })"
              />
            </div>
          </template>
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
          <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Color</span>
          <input
            type="color"
            class="w-full h-8 bg-background border border-border rounded"
            :value="selectedChild?.color ?? '#3b82f6'"
            @change="(e) => setColor((e.target as HTMLInputElement).value)"
          />
        </div>
      </div>

      <!-- ── Plain widget properties (button, slider, etc.) ─────────────── -->
      <div
        v-else-if="selectedButton && !selectionSection"
        class="flex flex-col gap-4"
      >
        <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Widget</span>

        <!-- Label -->
        <div class="flex flex-col gap-1">
          <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Label</span>
          <input
            type="text"
            class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
            placeholder="Button label"
            :value="selectedButton.label ?? ''"
            @change="(e) => setButtonLabel((e.target as HTMLInputElement).value)"
          />
        </div>

        <!-- Color -->
        <div class="flex flex-col gap-1">
          <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Color</span>
          <input
            type="color"
            class="w-full h-8 bg-background border border-border rounded"
            :value="selectedButton.color ?? '#334155'"
            @change="(e) => setButtonColor((e.target as HTMLInputElement).value)"
          />
        </div>

        <!-- Mapping type (buttons and sliders) -->
        <div v-if="selectedButton.type === 'button' || selectedButton.type === 'slider'" class="flex flex-col gap-2">
          <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">{{ selectedButton.type === 'button' ? 'Action' : 'Control' }}</span>
          <!-- Button: all options -->
          <select
            v-if="selectedButton.type === 'button'"
            class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
            :value="selectedButton.mapping.type"
            @change="(e) => setButtonMappingType((e.target as HTMLSelectElement).value as LiveMapping['type'])"
          >
            <option value="none">None</option>
            <option value="preset">Preset</option>
            <option value="channel">Channel (DMX)</option>
            <option value="dimmer-group">Dimmer Group</option>
            <option value="effect-param">Effect Parameter</option>
            <option value="global-function">Global Function</option>
            <option value="page-switch">Page Switch</option>
          </select>
          <!-- Slider: only fader-relevant options -->
          <select
            v-else-if="selectedButton.type === 'slider'"
            class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
            :value="selectedButton.mapping.type"
            @change="(e) => setButtonMappingType((e.target as HTMLSelectElement).value as LiveMapping['type'])"
          >
            <option value="none">None</option>
            <option value="channel">Channel (DMX)</option>
            <option value="dimmer-group">Dimmer Group</option>
            <option value="effect-param">Effect Parameter</option>
          </select>

          <!-- Preset picker -->
          <div v-if="selectedButton.mapping.type === 'preset'" class="flex flex-col gap-1">
            <select
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              :value="selectedButton.mapping.presetId ?? ''"
              @change="(e) => patchWidget({ mapping: { type: 'preset', presetId: (e.target as HTMLSelectElement).value } })"
            >
              <option value="">— choose preset —</option>
              <option v-for="p in engineStore.savedPresets" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>

          <!-- Global Function config -->
          <div v-if="selectedButton.mapping.type === 'global-function'" class="flex flex-col gap-2">
            <select
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              :value="selectedButton.mapping.globalFunction ?? 'strobe'"
              @change="(e) => setButtonGlobalFunction((e.target as HTMLSelectElement).value as GlobalFunctionType)"
            >
              <option value="strobe">Strobe</option>
              <option value="blind">Blind (Full White)</option>
              <option value="blackout">Blackout</option>
              <option value="speed">Speed</option>
            </select>

            <!-- Speed config -->
            <template v-if="selectedButton.mapping.globalFunction === 'speed'">
              <div class="flex items-center gap-2 text-xs">
                <label class="text-muted-foreground/70 w-20 shrink-0">Preset</label>
                <select
                  class="flex-1 text-xs bg-background border border-border rounded px-2 py-1"
                  :value="String((selectedButton.mapping.globalFunctionConfig as any)?.multiplier ?? 2)"
                  @change="(e) => setButtonSpeedConfig({ multiplier: Number((e.target as HTMLSelectElement).value) })"
                >
                  <option value="0">Freeze (0×)</option>
                  <option value="0.25">¼×</option>
                  <option value="0.5">½×</option>
                  <option value="1">Reset (1×)</option>
                  <option value="2">2×</option>
                  <option value="4">4×</option>
                </select>
              </div>
              <div class="flex items-center gap-2 text-xs">
                <label class="text-muted-foreground/70 w-20 shrink-0">Multiplier</label>
                <input
                  type="number"
                  min="0"
                  max="16"
                  step="0.25"
                  class="flex-1 bg-background border border-border rounded px-2 py-1"
                  :value="(selectedButton.mapping.globalFunctionConfig as any)?.multiplier ?? 2"
                  @change="(e) => setButtonSpeedConfig({ multiplier: Number((e.target as HTMLInputElement).value) })"
                />
              </div>
              <div class="flex items-center gap-2 text-xs">
                <label class="text-muted-foreground/70 w-20 shrink-0">Behavior</label>
                <select
                  class="flex-1 text-xs bg-background border border-border rounded px-2 py-1"
                  :value="(selectedButton.mapping.globalFunctionConfig as any)?.behavior ?? 'latch'"
                  @change="(e) => setButtonSpeedConfig({ behavior: (e.target as HTMLSelectElement).value as 'hold' | 'latch' })"
                >
                  <option value="latch">Latch (toggle state)</option>
                  <option value="hold">Hold (momentary)</option>
                </select>
              </div>
            </template>

            <!-- Strobe config -->
            <template v-if="selectedButton.mapping.globalFunction === 'strobe'">
              <div class="flex items-center gap-2 text-xs">
                <label class="text-muted-foreground/70 w-20 shrink-0">Beat sync</label>
                <input
                  type="checkbox"
                  :checked="(selectedButton.mapping.globalFunctionConfig as any)?.beatSync ?? false"
                  @change="(e) => setButtonStrobeConfig({ beatSync: (e.target as HTMLInputElement).checked })"
                />
              </div>
              <div v-if="!(selectedButton.mapping.globalFunctionConfig as any)?.beatSync" class="flex items-center gap-2 text-xs">
                <label class="text-muted-foreground/70 w-20 shrink-0">Hz</label>
                <input
                  type="number"
                  min="0.5"
                  max="25"
                  step="0.5"
                  class="flex-1 bg-background border border-border rounded px-2 py-1"
                  :value="(selectedButton.mapping.globalFunctionConfig as any)?.frequency ?? 8"
                  @change="(e) => setButtonStrobeConfig({ frequency: Number((e.target as HTMLInputElement).value) })"
                />
              </div>
              <div v-else class="flex items-center gap-2 text-xs">
                <label class="text-muted-foreground/70 w-20 shrink-0">Division</label>
                <select
                  class="flex-1 text-xs bg-background border border-border rounded px-2 py-1"
                  :value="String((selectedButton.mapping.globalFunctionConfig as any)?.beatDivision ?? 8)"
                  @change="(e) => setButtonStrobeConfig({ beatDivision: Number((e.target as HTMLSelectElement).value) })"
                >
                  <option value="1">1 (quarter)</option>
                  <option value="2">2 (8th)</option>
                  <option value="4">4 (16th)</option>
                  <option value="8">8 (32nd)</option>
                  <option value="0.5">½ (half)</option>
                  <option value="0.25">¼ (whole)</option>
                </select>
              </div>
            </template>

            <!-- Blind config -->
            <template v-if="selectedButton.mapping.globalFunction === 'blind'">
              <div class="flex items-center gap-2 text-xs">
                <label class="text-muted-foreground/70 w-20 shrink-0">Color</label>
                <input
                  type="color"
                  class="flex-1 h-7 bg-background border border-border rounded"
                  :value="(selectedButton.mapping.globalFunctionConfig as any)?.color ?? '#ffffff'"
                  @change="(e) => setButtonBlindConfig({ color: (e.target as HTMLInputElement).value })"
                />
              </div>
              <div class="flex items-center gap-2 text-xs">
                <label class="text-muted-foreground/70 w-20 shrink-0">Dimmer ramp</label>
                <input
                  type="checkbox"
                  :checked="(selectedButton.mapping.globalFunctionConfig as any)?.dimmerCurve ?? false"
                  @change="(e) => setButtonBlindConfig({ dimmerCurve: (e.target as HTMLInputElement).checked })"
                />
              </div>
            </template>
          </div>

          <!-- Page switch picker -->
          <div v-if="selectedButton.mapping.type === 'page-switch'" class="flex flex-col gap-1">
            <select
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              :value="selectedButton.mapping.targetPageId ?? ''"
              @change="(e) => patchWidget({ mapping: { type: 'page-switch', targetPageId: (e.target as HTMLSelectElement).value } })"
            >
              <option value="">— choose page —</option>
              <option v-for="pg in store.pages" :key="pg.id" :value="pg.id">{{ pg.name }}</option>
            </select>
          </div>

          <!-- Channel picker (button + slider) -->
          <div v-if="selectedButton.mapping.type === 'channel'" class="flex flex-col gap-1">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Target</span>
            <select
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              :value="channelTargetValue(selectedButton.mapping)"
              @change="(e) => setChannelTargetForWidget((e.target as HTMLSelectElement).value)"
            >
              <option value="">— choose group or fixture —</option>
              <optgroup v-if="dimmerGroupNodes.length" label="Groups">
                <option v-for="node in dimmerGroupNodes" :key="node.id" :value="`group:${node.id}`">{{ node.name }}</option>
              </optgroup>
              <optgroup label="Fixtures">
                <option v-for="f in engineStore.flatFixtures" :key="f.id" :value="`fixture:${f.id}`">{{ f.name }}</option>
              </optgroup>
            </select>

            <!-- Group selected → pick channel type -->
            <template v-if="selectedButton.mapping.groupId">
              <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60 pt-1">Channel Type</span>
              <select
                class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
                :value="selectedButton.mapping.channelType ?? ''"
                @change="(e) => { if (selectedButton) patchWidget({ mapping: { ...selectedButton.mapping, channelType: (e.target as HTMLSelectElement).value } }); }"
              >
                <option value="">— choose type —</option>
                <option v-for="t in channelTypesForGroup(selectedButton.mapping.groupId)" :key="t" :value="t">{{ t }}</option>
              </select>
            </template>

            <!-- Fixture selected → pick channel index -->
            <template v-else-if="selectedButton.mapping.fixtureId != null">
              <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60 pt-1">Channel</span>
              <select
                class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
                :value="selectedButton.mapping.channelOffset ?? ''"
                @change="(e) => {
                  const channelOffset = Number((e.target as HTMLSelectElement).value);
                  if (selectedButton) patchWidget({ mapping: { ...selectedButton.mapping, channelOffset } });
                }"
              >
                <option value="">— choose channel —</option>
                <option v-for="(ch, idx) in engineStore.flatFixtures.find(f => f.id === selectedButton?.mapping.fixtureId)?.channels ?? []" :key="idx" :value="idx">
                  {{ ch.oflChannelName || `Ch ${idx}` }}
                </option>
              </select>
            </template>
          </div>

          <!-- Dimmer group picker -->
          <div v-if="selectedButton.mapping.type === 'dimmer-group'" class="flex flex-col gap-1">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Target</span>
            <select
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              :value="dimmerGroupValue(selectedButton.mapping)"
              @change="(e) => setDimmerGroupForWidget((e.target as HTMLSelectElement).value)"
            >
              <option value="">— choose group or fixture —</option>
              <optgroup v-if="dimmerGroupNodes.length" label="Groups">
                <option v-for="node in dimmerGroupNodes" :key="node.id" :value="`group:${node.id}`">
                  {{ node.name }}
                </option>
              </optgroup>
              <optgroup label="Fixtures">
                <option v-for="f in engineStore.flatFixtures" :key="f.id" :value="`fixture:${f.id}`">
                  {{ f.name }}
                </option>
              </optgroup>
            </select>
          </div>

          <!-- Effect parameter picker -->
          <div v-if="selectedButton.mapping.type === 'effect-param'" class="flex flex-col gap-1">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Effect</span>
            <select
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              :value="selectedButton.mapping.effectId ?? ''"
              @change="(e) => patchWidget({ mapping: { type: 'effect-param', effectId: (e.target as HTMLSelectElement).value } })"
            >
              <option value="">— choose effect —</option>
              <option v-for="eff in engineStore.activeEffects" :key="eff.id" :value="eff.id">
                {{ eff.id }}
              </option>
            </select>
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60 pt-1">Parameter</span>
            <select
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              :value="selectedButton.mapping.paramKey ?? ''"
              @change="(e) => { if (selectedButton) patchWidget({ mapping: { ...selectedButton.mapping, paramKey: (e.target as HTMLSelectElement).value } }); }"
            >
              <option value="">— choose parameter —</option>
              <option value="strength">Strength</option>
              <option value="speed">Speed</option>
              <option value="fanning">Fanning</option>
              <option value="waveformParams.param">Waveform Param</option>
              <option value="waveformParams.start">Waveform Start</option>
              <option value="waveformParams.end">Waveform End</option>
            </select>
          </div>
        </div>
      </div>

      <!-- ── Page settings (default view) ───────────────────────────────── -->
      <div v-else-if="store.activePage && !selectionSection" class="flex flex-col gap-4">
        <!-- Aspect Ratio -->
        <div class="flex flex-col gap-1.5">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Aspect Ratio</span>
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
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Width (columns)</span>
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
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Computed Resolution</span>
          <span class="text-xs text-foreground font-mono">{{ resolution.w }} × {{ resolution.h }} px</span>
        </div>
      </div>
    </div>
  </div>
</template>
