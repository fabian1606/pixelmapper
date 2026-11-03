<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Play, Trash2, MapPin, Plus } from 'lucide-vue-next';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useEngineStore } from '~/stores/engine-store';
import { useControllerStore } from '~/stores/controller-store';
import { useHistory } from '~/components/engine/composables/use-history';
import {
  UpdateLiveSectionCommand,
  UpdateLivePageCommand,
  UpdateControllerChildMappingCommand,
  UpdateWidgetMappingCommand,
  SetWidgetControllerInstanceCommand,
  AddLiveSectionCommand,
  RemoveLiveSectionCommand,
  SetSectionMembersCommand,
} from '~/components/engine/commands/live-widget-commands';
import {
  getPageResolution,
  type LiveWidget,
  type LiveMapping,
  type ControllerChildBinding,
  type LiveSection,
  type SectionMember,
  type SectionSource,
} from '~/utils/live/types';
import { getControllerDefinition } from '~/utils/controllers/catalog';
import { nativeInputLabel } from '~/utils/live/inputs/registry';
import { sectionDisplayName } from '~/utils/live/sections';
import MappingEditor from './MappingEditor.vue';
import LiveSectionEditor from './LiveSectionEditor.vue';
import LiveButtonPanel from './LiveButtonPanel.vue';
import LiveButtonAppearance from './LiveButtonAppearance.vue';

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

function patchWidget(patch: Partial<Pick<LiveWidget, 'mapping' | 'label' | 'color' | 'actions' | 'appearance' | 'inputs'>>) {
  const w = selectedButton.value;
  if (!w || !store.activePageId) return;
  history.execute(new UpdateWidgetMappingCommand(store.activePageId, w.id, patch));
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

function patchChild(patch: Partial<Pick<ControllerChildBinding, 'mapping' | 'label' | 'color' | 'actions' | 'appearance' | 'inputs'>>) {
  const twin = selectedTwin.value;
  const ctrl = selectedControl.value;
  if (!twin || !ctrl || !store.activePageId) return;
  history.execute(new UpdateControllerChildMappingCommand(
    store.activePageId, twin.id, ctrl.id, patch,
  ));
}

function setLabel(label: string) {
  patchChild({ label });
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

/** Section containing the given member, if any. */
function sectionOfMember(member: SectionMember): LiveSection | null {
  const mk = memberMatchKey(member);
  return availableSections.value.find(s => s.members.some(m => memberMatchKey(m) === mk)) ?? null;
}

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
  let candidate: LiveSection | null = null;
  for (const m of members) {
    const sec = sectionOfMember(m);
    if (!sec) return null;
    if (!candidate) candidate = sec;
    else if (candidate.id !== sec.id) return null;
  }
  return candidate;
});

/**
 * Group-level section panel: several controls selected (e.g. a whole section
 * via plain click) or a section surfaced directly. A single button is edited
 * in the button panel instead, where "Section" is just one of its actions.
 */
const showSectionPanel = computed(() => !!store.selectedSectionId || selectionMembers.value.length > 1);

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

/** Creates a new section holding `members` (defaults to all presets). */
function createSection(members: SectionMember[]) {
  if (!store.activePageId || members.length === 0) return;
  const source: SectionSource = 'all-presets';
  const section: LiveSection = {
    id: crypto.randomUUID(),
    source,
    members: members.map(m => ({ ...m })),
  };
  history.execute(new AddLiveSectionCommand(store.activePageId, section));
}

/** Appends `members` to section `sectionId`, skipping ones already in it. */
function addMembersToSection(sectionId: string, members: SectionMember[]) {
  const section = availableSections.value.find(s => s.id === sectionId);
  if (!section || !store.activePageId) return;
  const existing = new Set(section.members.map(memberMatchKey));
  const next = section.members.map(m => ({ ...m }));
  for (const m of members) {
    if (!existing.has(memberMatchKey(m))) next.push({ ...m });
  }
  history.execute(new SetSectionMembersCommand(store.activePageId, sectionId, next));
}

/** Removes `members` from `section`; an emptied section is deleted. */
function removeMembersFromSection(section: LiveSection, members: SectionMember[]) {
  if (!store.activePageId) return;
  const toRemove = new Set(members.map(memberMatchKey));
  const next = section.members.filter(m => !toRemove.has(memberMatchKey(m)));
  if (next.length === 0) {
    // Empty sections have no purpose — drop the whole section instead.
    history.execute(new RemoveLiveSectionCommand(store.activePageId, section.id));
  } else {
    history.execute(new SetSectionMembersCommand(store.activePageId, section.id, next));
  }
}

function createSectionFromSelection() {
  createSection(selectionMembers.value);
}

function addSelectionToSection(sectionId: string) {
  addMembersToSection(sectionId, selectionMembers.value);
}

function removeSelectionFromSection() {
  const sec = selectionSection.value;
  if (sec) removeMembersFromSection(sec, selectionMembers.value);
}

// ── Single button / pad: Action | Section ───────────────────────────────────

/** The one control being edited as a button (canvas widget or twin sub-control). */
const singleMember = computed<SectionMember | null>(() => {
  if (store.selectedSectionId || selectionMembers.value.length !== 1) return null;
  return selectionMembers.value[0] ?? null;
});

/** Section the single control belongs to, if any. */
const singleMemberSection = computed<LiveSection | null>(() =>
  singleMember.value ? sectionOfMember(singleMember.value) : null,
);

/** Selected pad (twin sub-control of type button), edited with the button panel. */
const selectedPad = computed(() => (selectedControl.value?.type === 'button' ? selectedControl.value : null));

/** What the selected pad already sends in hardware (e.g. its MIDI note), shown read-only. */
const selectedPadNativeInput = computed(() => nativeInputLabel(twinDefinition.value, selectedPad.value));

// "Section" chosen while sections exist: the user still has to pick one.
const pendingSectionChoice = ref(false);
watch(() => singleMember.value && memberMatchKey(singleMember.value), () => {
  pendingSectionChoice.value = false;
});

/** Switch to Section: create one right away if none exist, else ask which. */
function chooseSectionMode() {
  if (singleMemberSection.value) return;
  if (availableSections.value.length === 0) moveSingleMemberTo('new');
  else pendingSectionChoice.value = true;
}

/** Switch to Action: leave the section. The button's actions stay stored. */
function chooseActionMode() {
  pendingSectionChoice.value = false;
  const member = singleMember.value;
  const sec = singleMemberSection.value;
  if (!member || !sec) return;
  removeMembersFromSection(sec, [member]);
  // Drop section isolation since this control is no longer a member.
  if (store.isolatedSectionId === sec.id) store.isolatedSectionId = null;
}

/** Moves the single control into section `target` ('new' creates one). */
function moveSingleMemberTo(target: string) {
  const member = singleMember.value;
  if (!member) return;
  pendingSectionChoice.value = false;
  const current = singleMemberSection.value;
  if (current?.id === target) return;
  if (current) removeMembersFromSection(current, [member]);
  if (target === 'new') createSection([member]);
  else addMembersToSection(target, [member]);
}

/** Label / color / actions / appearance change of the edited button or pad. */
function patchButton(patch: Partial<Pick<LiveWidget, 'label' | 'color' | 'actions' | 'appearance' | 'inputs'>>) {
  if (selectedTwin.value && selectedControl.value) patchChild(patch);
  else patchWidget(patch);
}

/** Shared color / look of a section (set from a member's Appearance group). */
function patchSection(sectionId: string, patch: Partial<Pick<LiveSection, 'color' | 'appearance'>>) {
  if (!store.activePageId) return;
  history.execute(new UpdateLiveSectionCommand(store.activePageId, sectionId, patch));
}

// ── Moving Head Positions (shown under XY-Pad widgets) ──────────────────────

const newPositionName = ref('');

function savePosition() {
  const name = newPositionName.value.trim() || `Position ${store.savedPositions.length + 1}`;
  const id = store.savePosition(name, engineStore.flatFixtures);
  if (id) newPositionName.value = '';
}

function recallPosition(id: string) {
  const position = store.savedPositions.find(p => p.id === id);
  if (!position) return;
  for (const snap of position.snapshot) {
    const fixture = (engineStore.flatFixtures as any[]).find(f => f.id === snap.fixtureId);
    const ch = fixture?.channels[snap.channelOffset];
    if (ch) ch.chaserConfig.stepValues = [snap.value];
  }
  engineStore.triggerCanvasSync?.();
}

function deletePosition(id: string) {
  store.deletePosition(id);
}

function renamePosition(id: string, name: string) {
  store.updatePositionName(id, name.trim() || 'Position');
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
        Play Mode
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-5">
      <!-- ── Section panel (several controls / whole section) ───────────── -->
      <div v-if="showSectionPanel" class="flex flex-col gap-2 pb-4 border-b border-border">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Section</span>
          <span v-if="selectionSection" class="text-[10px] text-muted-foreground">
            {{ selectionMembers.length }} selected · {{ selectionSection.members.length }} total
          </span>
        </div>

        <!-- In-section: shared appearance, then the editor -->
        <LiveButtonAppearance
          v-if="selectionSection"
          :show-label="false"
          :color="selectionSection.color"
          :appearance="selectionSection.appearance"
          @patch="(p) => patchSection(selectionSection!.id, p)"
        />
        <LiveSectionEditor v-if="selectionSection" :section="selectionSection">
          <template v-if="selectionMembers.length > 0" #actions>
            <button
              type="button"
              class="flex-1 px-2 py-1.5 rounded text-[11px] font-medium bg-accent hover:bg-accent/80 transition-colors"
              @click="removeSelectionFromSection"
            >
              Remove from section
            </button>
          </template>
        </LiveSectionEditor>

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
                {{ sectionDisplayName(s) }} ({{ s.members.length }})
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

      <!-- ── Control-level: per-control action (control focused) ──────── -->
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

        <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ selectedControl.label ?? selectedControl.id }}
        </span>

        <!-- Pad: same panel as a canvas button -->
        <LiveButtonPanel
          v-if="selectedPad"
          :label="selectedChild?.label"
          :color="selectedChild?.color"
          :actions="selectedChild?.actions"
          :appearance="selectedChild?.appearance"
          :inputs="selectedChild?.inputs"
          :native-input="selectedPadNativeInput"
          :section="singleMemberSection"
          :sections="availableSections"
          :section-pending="pendingSectionChoice"
          @patch="patchButton"
          @patch-section="patchSection"
          @choose-section="chooseSectionMode"
          @choose-action="chooseActionMode"
          @move="moveSingleMemberTo"
        />

        <!-- Fader: one continuous mapping -->
        <template v-else>
          <div class="flex flex-col gap-1">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Label</span>
            <input
              type="text"
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              :value="selectedChild?.label ?? ''"
              @change="(e) => setLabel((e.target as HTMLInputElement).value)"
            />
          </div>
          <MappingEditor
            :mapping="selectedChild?.mapping ?? { type: 'none' }"
            variant="slider"
            @patch="(p: { mapping: LiveMapping }) => patchChild(p)"
          />
        </template>
      </div>

      <!-- ── Plain widget properties (button, slider, etc.) ─────────────── -->
      <div
        v-else-if="selectedButton && !showSectionPanel"
        class="flex flex-col gap-4"
      >
        <!-- Button: Action | Section, Appearance, actions -->
        <LiveButtonPanel
          v-if="selectedButton.type === 'button'"
          :label="selectedButton.label"
          :color="selectedButton.color"
          :actions="selectedButton.actions"
          :appearance="selectedButton.appearance"
          :inputs="selectedButton.inputs"
          :section="singleMemberSection"
          :sections="availableSections"
          :section-pending="pendingSectionChoice"
          @patch="patchButton"
          @patch-section="patchSection"
          @choose-section="chooseSectionMode"
          @choose-action="chooseActionMode"
          @move="moveSingleMemberTo"
        />

        <!-- Other widgets: label, color and (sliders, xy pads) one mapping -->
        <template v-else>
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Widget</span>
          <div class="flex flex-col gap-1">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Label</span>
            <input
              type="text"
              class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              placeholder="Label"
              :value="selectedButton.label ?? ''"
              @change="(e) => setButtonLabel((e.target as HTMLInputElement).value)"
            />
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Color</span>
            <input
              type="color"
              class="w-full h-8 bg-background border border-border rounded"
              :value="selectedButton.color || '#334155'"
              @change="(e) => setButtonColor((e.target as HTMLInputElement).value)"
            />
          </div>
          <MappingEditor
            v-if="selectedButton.type === 'slider' || selectedButton.type === 'xy'"
            :mapping="selectedButton.mapping"
            :variant="selectedButton.type === 'xy' ? 'xy' : 'slider'"
            @patch="(p: { mapping: LiveMapping }) => patchWidget(p)"
          />
        </template>

        <!-- Moving Head Positions (XY-Pad only) -->
        <div v-if="selectedButton.type === 'xy'" class="flex flex-col gap-2 pt-4 mt-1 border-t border-border">
          <div class="flex items-center gap-1.5">
            <MapPin class="size-3 text-muted-foreground" />
            <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Positionen</span>
          </div>

          <!-- Save current position -->
          <div class="flex gap-1.5">
            <input
              v-model="newPositionName"
              type="text"
              class="flex-1 min-w-0 text-xs bg-background border border-border rounded px-2 py-1.5"
              placeholder="Name…"
              @keydown.enter="savePosition"
            />
            <button
              type="button"
              class="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap"
              title="Aktuelle Moving-Head-Position speichern"
              @click="savePosition"
            >
              <Plus class="size-3" />
              Speichern
            </button>
          </div>

          <!-- Saved positions: click to recall -->
          <div v-if="store.savedPositions.length === 0" class="text-[10px] text-muted-foreground/70 leading-snug">
            Noch keine Positionen. Richte die Moving Heads aus und speichere die aktuelle Position.
          </div>
          <div v-else class="flex flex-col gap-1">
            <div
              v-for="pos in store.savedPositions"
              :key="pos.id"
              class="group/pos flex items-center gap-1 rounded hover:bg-accent/50 transition-colors"
            >
              <button
                type="button"
                class="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1.5 text-left text-[11px]"
                :title="`Position „${pos.name}“ abrufen`"
                @click="recallPosition(pos.id)"
              >
                <MapPin class="size-3 shrink-0 text-muted-foreground/50" />
                <input
                  :value="pos.name"
                  class="flex-1 min-w-0 bg-transparent truncate outline-none cursor-pointer focus:cursor-text focus:ring-1 focus:ring-ring rounded px-0.5"
                  @click.stop
                  @change="(e) => renamePosition(pos.id, (e.target as HTMLInputElement).value)"
                />
              </button>
              <button
                type="button"
                class="shrink-0 p-1.5 rounded hover:bg-destructive/20 text-destructive opacity-0 group-hover/pos:opacity-100 transition-opacity"
                title="Position löschen"
                @click="deletePosition(pos.id)"
              >
                <Trash2 class="size-3" />
              </button>
            </div>
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
