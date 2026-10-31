<script setup lang="ts">
import { modifierName } from '~/utils/engine/modifiers';
import { getManifest } from '~/utils/plugins/plugin-store';
import { computed } from 'vue';
import type { LiveMapping, GlobalFunctionType, SpeedConfig, SpeedFaderMode, StrobeConfig, BlindConfig } from '~/utils/live/types';
import { defaultStrobeConfig, defaultBlindConfig, defaultSpeedConfig } from '~/utils/live/types';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveModeStore } from '~/stores/live-mode-store';

/**
 * Shared mapping editor used by both canvas widgets (buttons/sliders) and
 * controller-twin controls (pads/faders). It edits a single {@link LiveMapping}
 * and emits replacement patches; the caller persists them via its own history
 * command (UpdateWidgetMappingCommand vs UpdateControllerChildMappingCommand).
 *
 * This is the seam that guarantees feature parity: a controller control "is a
 * button" because it is configured by the very same component.
 */
const props = defineProps<{
  mapping: LiveMapping;
  /** Which mapping types to offer. Buttons get all; sliders/faders the fader subset. */
  variant: 'button' | 'slider';
}>();

const emit = defineEmits<{
  (e: 'patch', patch: { mapping: LiveMapping }): void;
}>();

const engineStore = useEngineStore();

/** Number/int/bool params of the mapped modifier's plugin (mappable to a 0–1 control). */
const mappableParams = computed(() => {
  const m = engineStore.modifiers.find(e => e.id === props.mapping.effectId);
  const manifest = m ? getManifest(m.plugin) : undefined;
  return (manifest?.params ?? []).filter(p => p.type === 'number' || p.type === 'int' || p.type === 'bool');
});
const store = useLiveModeStore();

function patch(mapping: LiveMapping) {
  emit('patch', { mapping });
}

// ── Mapping type ────────────────────────────────────────────────────────────
function setMappingType(type: LiveMapping['type']) {
  if (type === 'global-function') {
    patch({ type, globalFunction: 'strobe', globalFunctionConfig: defaultStrobeConfig() });
  } else {
    patch({ type });
  }
}

// ── Preset ──────────────────────────────────────────────────────────────────
function setPreset(presetId: string) {
  patch({ type: 'preset', presetId });
}

// ── Global function ───────────────────────────────────────────────────────────
function setGlobalFunction(fn: GlobalFunctionType) {
  let config: any = {};
  if (fn === 'strobe') config = defaultStrobeConfig();
  else if (fn === 'blind') config = defaultBlindConfig();
  else if (fn === 'speed') config = defaultSpeedConfig();
  patch({ type: 'global-function', globalFunction: fn, globalFunctionConfig: config });
}

function setSpeedConfig(p: Partial<SpeedConfig>) {
  const existing = (props.mapping.globalFunctionConfig ?? {}) as SpeedConfig;
  patch({ ...props.mapping, globalFunctionConfig: { ...defaultSpeedConfig(), ...existing, ...p } });
}

function setStrobeConfig(p: Partial<StrobeConfig>) {
  const existing = (props.mapping.globalFunctionConfig ?? {}) as StrobeConfig;
  patch({ ...props.mapping, globalFunctionConfig: { ...defaultStrobeConfig(), ...existing, ...p } });
}

function setBlindConfig(p: Partial<BlindConfig>) {
  const existing = (props.mapping.globalFunctionConfig ?? {}) as BlindConfig;
  patch({ ...props.mapping, globalFunctionConfig: { ...defaultBlindConfig(), ...existing, ...p } });
}

// ── Channel (DMX) with group support ──────────────────────────────────────────
const dimmerGroupNodes = computed(() =>
  (engineStore.sceneNodes as any[]).filter(n => n.children != null),
);

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

function channelTargetValue(mapping: LiveMapping): string {
  if (mapping.groupId) return `group:${mapping.groupId}`;
  if (mapping.fixtureId != null) return `fixture:${mapping.fixtureId}`;
  return '';
}

function setChannelTarget(raw: string) {
  if (!raw) {
    patch({ type: 'channel' });
  } else if (raw.startsWith('group:')) {
    patch({ type: 'channel', groupId: raw.slice(6), fixtureId: undefined, channelOffset: undefined });
  } else {
    patch({ type: 'channel', fixtureId: raw.slice(8), groupId: undefined, channelType: undefined });
  }
}

// ── Dimmer group ──────────────────────────────────────────────────────────────
function dimmerGroupValue(mapping: LiveMapping): string {
  if (mapping.groupId) return `group:${mapping.groupId}`;
  if (mapping.fixtureId != null) return `fixture:${mapping.fixtureId}`;
  return '';
}

function setDimmerGroup(raw: string) {
  if (!raw) {
    patch({ type: 'dimmer-group' });
  } else if (raw.startsWith('group:')) {
    patch({ type: 'dimmer-group', groupId: raw.slice(6), fixtureId: undefined });
  } else {
    patch({ type: 'dimmer-group', fixtureId: raw.slice(8), groupId: undefined });
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Type -->
    <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Action</span>
    <select
      v-if="variant === 'button'"
      class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
      :value="mapping.type"
      @change="(e) => setMappingType((e.target as HTMLSelectElement).value as LiveMapping['type'])"
    >
      <option value="none">None</option>
      <option value="preset">Preset</option>
      <option value="channel">Channel (DMX)</option>
      <option value="dimmer-group">Dimmer Group</option>
      <option value="effect-param">Effect Parameter</option>
      <option value="global-function">Global Function</option>
      <option value="page-switch">Page Switch</option>
      <option value="position-recall">Moving Head Position</option>
    </select>
    <select
      v-else
      class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
      :value="mapping.type"
      @change="(e) => setMappingType((e.target as HTMLSelectElement).value as LiveMapping['type'])"
    >
      <option value="none">None</option>
      <option value="channel">Channel (DMX)</option>
      <option value="dimmer-group">Dimmer Group</option>
      <option value="effect-param">Effect Parameter</option>
      <option value="speed">Speed</option>
    </select>

    <!-- Speed fader mode -->
    <div v-if="mapping.type === 'speed'" class="flex flex-col gap-1">
      <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Mode</span>
      <select
        class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
        :value="mapping.speedMode ?? 'continuous'"
        @change="(e) => patch({ type: 'speed', speedMode: (e.target as HTMLSelectElement).value as SpeedFaderMode })"
      >
        <option value="continuous">Continuous (½× – 2×)</option>
        <option value="steps">Steps (¼×, ½×, 1×, 2×, 4×)</option>
      </select>
      <p class="text-[10px] text-muted-foreground/70 leading-snug">
        1× in the center. Multiplies the tapped BPM, so tap tempo keeps working.
      </p>
    </div>

    <!-- Preset picker -->
    <div v-if="mapping.type === 'preset'" class="flex flex-col gap-1">
      <select
        class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
        :value="mapping.presetId ?? ''"
        @change="(e) => setPreset((e.target as HTMLSelectElement).value)"
      >
        <option value="">— choose preset —</option>
        <option v-for="p in engineStore.savedPresets" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </div>

    <!-- Global Function config -->
    <div v-if="mapping.type === 'global-function'" class="flex flex-col gap-2">
      <select
        class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
        :value="mapping.globalFunction ?? 'strobe'"
        @change="(e) => setGlobalFunction((e.target as HTMLSelectElement).value as GlobalFunctionType)"
      >
        <option value="strobe">Strobe</option>
        <option value="blind">Blind (Full White)</option>
        <option value="blackout">Blackout</option>
        <option value="speed">Speed</option>
        <option value="stop-all">Stop all</option>
        <option value="step-back">Step back</option>
      </select>

      <!-- Speed config -->
      <template v-if="mapping.globalFunction === 'speed'">
        <div class="flex items-center gap-2 text-xs">
          <label class="text-muted-foreground/70 w-20 shrink-0">Preset</label>
          <select
            class="flex-1 text-xs bg-background border border-border rounded px-2 py-1"
            :value="String((mapping.globalFunctionConfig as any)?.multiplier ?? 2)"
            @change="(e) => setSpeedConfig({ multiplier: Number((e.target as HTMLSelectElement).value) })"
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
            :value="(mapping.globalFunctionConfig as any)?.multiplier ?? 2"
            @change="(e) => setSpeedConfig({ multiplier: Number((e.target as HTMLInputElement).value) })"
          />
        </div>
      </template>

      <!-- Strobe config -->
      <template v-if="mapping.globalFunction === 'strobe'">
        <div class="flex items-center gap-2 text-xs">
          <label class="text-muted-foreground/70 w-20 shrink-0">Beat sync</label>
          <input
            type="checkbox"
            :checked="(mapping.globalFunctionConfig as any)?.beatSync ?? false"
            @change="(e) => setStrobeConfig({ beatSync: (e.target as HTMLInputElement).checked })"
          />
        </div>
        <div v-if="!(mapping.globalFunctionConfig as any)?.beatSync" class="flex items-center gap-2 text-xs">
          <label class="text-muted-foreground/70 w-20 shrink-0">Hz</label>
          <input
            type="number"
            min="0.5"
            max="25"
            step="0.5"
            class="flex-1 bg-background border border-border rounded px-2 py-1"
            :value="(mapping.globalFunctionConfig as any)?.frequency ?? 8"
            @change="(e) => setStrobeConfig({ frequency: Number((e.target as HTMLInputElement).value) })"
          />
        </div>
        <div v-else class="flex items-center gap-2 text-xs">
          <label class="text-muted-foreground/70 w-20 shrink-0">Division</label>
          <select
            class="flex-1 text-xs bg-background border border-border rounded px-2 py-1"
            :value="String((mapping.globalFunctionConfig as any)?.beatDivision ?? 8)"
            @change="(e) => setStrobeConfig({ beatDivision: Number((e.target as HTMLSelectElement).value) })"
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
      <template v-if="mapping.globalFunction === 'blind'">
        <div class="flex items-center gap-2 text-xs">
          <label class="text-muted-foreground/70 w-20 shrink-0">Color</label>
          <input
            type="color"
            class="flex-1 h-7 bg-background border border-border rounded"
            :value="(mapping.globalFunctionConfig as any)?.color ?? '#ffffff'"
            @change="(e) => setBlindConfig({ color: (e.target as HTMLInputElement).value })"
          />
        </div>
        <div class="flex items-center gap-2 text-xs">
          <label class="text-muted-foreground/70 w-20 shrink-0">Dimmer ramp</label>
          <input
            type="checkbox"
            :checked="(mapping.globalFunctionConfig as any)?.dimmerCurve ?? false"
            @change="(e) => setBlindConfig({ dimmerCurve: (e.target as HTMLInputElement).checked })"
          />
        </div>
      </template>
    </div>

    <!-- Position-recall picker -->
    <div v-if="mapping.type === 'position-recall'" class="flex flex-col gap-1">
      <select
        class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
        :value="mapping.positionId ?? ''"
        @change="(e) => patch({ type: 'position-recall', positionId: (e.target as HTMLSelectElement).value })"
      >
        <option value="">— Position wählen —</option>
        <option v-for="pos in store.savedPositions" :key="pos.id" :value="pos.id">{{ pos.name }}</option>
      </select>
      <p v-if="store.savedPositions.length === 0" class="text-[10px] text-muted-foreground/70 leading-snug">
        Noch keine Positionen gespeichert. Im Edit-Modus Sidebar → Moving Head Positions.
      </p>
    </div>

    <!-- Page switch picker -->
    <div v-if="mapping.type === 'page-switch'" class="flex flex-col gap-1">
      <select
        class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
        :value="mapping.targetPageId ?? ''"
        @change="(e) => patch({ type: 'page-switch', targetPageId: (e.target as HTMLSelectElement).value })"
      >
        <option value="">— choose page —</option>
        <option v-for="pg in store.pages" :key="pg.id" :value="pg.id">{{ pg.name }}</option>
      </select>
    </div>

    <!-- Channel picker -->
    <div v-if="mapping.type === 'channel'" class="flex flex-col gap-1">
      <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Target</span>
      <select
        class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
        :value="channelTargetValue(mapping)"
        @change="(e) => setChannelTarget((e.target as HTMLSelectElement).value)"
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
      <template v-if="mapping.groupId">
        <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60 pt-1">Channel Type</span>
        <select
          class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
          :value="mapping.channelType ?? ''"
          @change="(e) => patch({ ...mapping, channelType: (e.target as HTMLSelectElement).value })"
        >
          <option value="">— choose type —</option>
          <option v-for="t in channelTypesForGroup(mapping.groupId)" :key="t" :value="t">{{ t }}</option>
        </select>
      </template>

      <!-- Fixture selected → pick channel index -->
      <template v-else-if="mapping.fixtureId != null">
        <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60 pt-1">Channel</span>
        <select
          class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
          :value="mapping.channelOffset ?? ''"
          @change="(e) => patch({ ...mapping, channelOffset: Number((e.target as HTMLSelectElement).value) })"
        >
          <option value="">— choose channel —</option>
          <option v-for="(ch, idx) in engineStore.flatFixtures.find(f => f.id === mapping.fixtureId)?.channels ?? []" :key="idx" :value="idx">
            {{ ch.oflChannelName || `Ch ${idx}` }}
          </option>
        </select>
      </template>
    </div>

    <!-- Dimmer group picker -->
    <div v-if="mapping.type === 'dimmer-group'" class="flex flex-col gap-1">
      <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Target</span>
      <select
        class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
        :value="dimmerGroupValue(mapping)"
        @change="(e) => setDimmerGroup((e.target as HTMLSelectElement).value)"
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
    <div v-if="mapping.type === 'effect-param'" class="flex flex-col gap-1">
      <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Effect</span>
      <select
        class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
        :value="mapping.effectId ?? ''"
        @change="(e) => patch({ type: 'effect-param', effectId: (e.target as HTMLSelectElement).value })"
      >
        <option value="">— choose effect —</option>
        <option v-for="eff in engineStore.modifiers" :key="eff.id" :value="eff.id">
          {{ modifierName(eff) }} · {{ eff.id.slice(0, 4) }}
        </option>
      </select>
      <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60 pt-1">Parameter</span>
      <select
        class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
        :value="mapping.paramKey ?? ''"
        @change="(e) => patch({ ...mapping, paramKey: (e.target as HTMLSelectElement).value })"
      >
        <option value="">— choose parameter —</option>
        <option value="strength">Strength</option>
        <option value="speed">Speed</option>
        <option value="fanning">Fanning</option>
        <option v-for="p in mappableParams" :key="p.key" :value="`params.${p.key}`">{{ p.label }}</option>
      </select>
    </div>
  </div>
</template>
