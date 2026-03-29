<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DraggableNumberInput from '@/components/ui/DraggableNumberInput.vue';
import { Plus, Trash2, GripVertical, X, ChevronDown, ChevronRight, Disc3, ArrowLeftRight } from 'lucide-vue-next';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  CHANNEL_CAPABILITY_META,
  CHANNEL_CAPABILITY_TYPES,
  WHEEL_CAPABILITY_TYPES,
  CAPABILITY_RANGE_FIELDS,
  modeAddressCount,
  type ChannelDraft,
  type CapabilityRange,
  type CapabilityFieldSpec,
  type ModeDraft,
  type ModeEntry,
  type WheelDraft,
  type WheelSlotDraft,
} from '~/utils/engine/custom-fixture-types';

const props = defineProps<{
  channels: ChannelDraft[];
  modes: ModeDraft[];
  selectedChannelId: string | null;
  headCount: number;
  wheels: WheelDraft[];
}>();

const emit = defineEmits<{
  (e: 'update:channels', value: ChannelDraft[]): void;
  (e: 'update:modes', value: ModeDraft[]): void;
  (e: 'update:selectedChannelId', value: string | null): void;
  (e: 'update:wheels', value: WheelDraft[]): void;
  (e: 'next'): void;
}>();

// ─── Channel pool ─────────────────────────────────────────────────────────────

function addChannel() {
  const id = crypto.randomUUID();
  const ch: ChannelDraft = {
    id,
    name: `Channel ${props.channels.length + 1}`,
    capabilityType: 'DIMMER',
    resolution: '8bit',
    defaultValue: 0,
    capabilities: [{ rangeId: crypto.randomUUID(), dmxMin: 0, dmxMax: 255, type: 'DIMMER', label: '' } as CapabilityRange],
  };
  emit('update:channels', [...props.channels, ch]);
  emit('update:selectedChannelId', id);
}

function deleteChannel(id: string) {
  emit('update:channels', props.channels.filter(c => c.id !== id));
  emit('update:modes', props.modes.map(m => ({
    ...m,
    entries: m.entries.filter(e => e.channelId !== id),
  })));
  if (props.selectedChannelId === id) emit('update:selectedChannelId', null);
}

const selectedChannel = computed(() =>
  props.channels.find(c => c.id === props.selectedChannelId) ?? null
);

function patchChannel(patch: Partial<ChannelDraft>) {
  if (!selectedChannel.value) return;
  emit('update:channels', props.channels.map(c =>
    c.id === selectedChannel.value!.id ? { ...c, ...patch } : c
  ));
}

/**
 * Atomically update the channel's capabilityType AND update the single full-range type
 * (if applicable) in one emit to avoid the double-emit stale-read bug.
 * Auto-sets the channel name when it's still the generated default or matches the old type label.
 */
function changeChannelType(newType: string) {
  if (!selectedChannel.value) return;
  const ch = selectedChannel.value;
  const oldLabel = CHANNEL_CAPABILITY_META[ch.capabilityType]?.label ?? '';
  const newLabel = CHANNEL_CAPABILITY_META[newType as any]?.label ?? newType;
  const isAutoName = ch.name === oldLabel || /^Channel \d+$/.test(ch.name);
  const newCaps = isSingleFullRange.value
    ? [{ ...ch.capabilities[0]!, type: newType } as CapabilityRange]
    : ch.capabilities;
  emit('update:channels', props.channels.map(c =>
    c.id === ch.id ? {
      ...c,
      capabilityType: newType as any,
      capabilities: newCaps,
      ...(isAutoName ? { name: newLabel } : {}),
    } : c
  ));
}

// ─── Capability range editing ─────────────────────────────────────────────────

/** Whether the channel has exactly one range covering the full 0–255 range. */
const isSingleFullRange = computed(() => {
  const caps = selectedChannel.value?.capabilities ?? [];
  return caps.length === 1 && caps[0]!.dmxMin === 0 && caps[0]!.dmxMax === 255;
});

function addCapabilityRange() {
  if (!selectedChannel.value) return;
  const existing = selectedChannel.value.capabilities;
  const splitAt = Math.round(255 / 2); // default split at ~128 for single full-range
  const lastMax = existing.length > 0 ? existing[existing.length - 1]!.dmxMax : -1;
  const newMin  = isSingleFullRange.value ? splitAt : Math.min(lastMax + 1, 255);
  const newRange = {
    rangeId: crypto.randomUUID(), dmxMin: newMin, dmxMax: 255,
    type: selectedChannel.value.capabilityType, label: '',
  } as CapabilityRange;
  // Shrink previous/implicit last range to end just before newMin
  const updated = existing.map((r, i) =>
    i === existing.length - 1 ? { ...r, dmxMax: Math.max(newMin - 1, r.dmxMin) } : r
  );
  patchChannel({ capabilities: [...updated, newRange] });
}

function removeCapabilityRange(rangeId: string) {
  if (!selectedChannel.value) return;
  const caps = selectedChannel.value.capabilities.filter(r => r.rangeId !== rangeId);
  if (caps.length === 0) {
    // Restore single full-range with the base type
    patchChannel({ capabilities: [{ rangeId: crypto.randomUUID(), dmxMin: 0, dmxMax: 255, type: selectedChannel.value.capabilityType, label: '' } as CapabilityRange] });
  } else if (caps.length === 1) {
    // Expand the remaining range to cover 0–255 so it becomes a single full-range again
    patchChannel({ capabilities: [{ ...caps[0]!, dmxMin: 0, dmxMax: 255 }] });
  } else {
    patchChannel({ capabilities: caps });
  }
}

function patchRange(rangeId: string, patch: Record<string, unknown>) {
  if (!selectedChannel.value) return;
  patchChannel({
    capabilities: selectedChannel.value.capabilities.map(r =>
      r.rangeId === rangeId ? { ...r, ...patch } as CapabilityRange : r
    ),
  });
}

/** Ensure ranges don't overlap: when dmxMax of range i changes, clamp the next range's dmxMin. */
function onRangeMaxChange(rangeId: string, newMax: number) {
  if (!selectedChannel.value) return;
  const caps = [...selectedChannel.value.capabilities];
  const idx = caps.findIndex(r => r.rangeId === rangeId);
  if (idx < 0) return;
  caps[idx] = { ...caps[idx]!, dmxMax: newMax };
  if (idx + 1 < caps.length) {
    caps[idx + 1] = { ...caps[idx + 1]!, dmxMin: Math.min(newMax + 1, 255) };
  }
  patchChannel({ capabilities: caps });
}

const capabilityGroups = computed(() => {
  const groups: Record<string, { type: string; label: string }[]> = {};
  for (const type of CHANNEL_CAPABILITY_TYPES) {
    const { group, label } = CHANNEL_CAPABILITY_META[type];
    if (!groups[group]) groups[group] = [];
    groups[group].push({ type, label });
  }
  return groups;
});

/** A field group that may have a fixed single value, a start/end range pair, or both. */
type CombinedGroup = {
  label: string;
  root: string;
  /** Fixed single-value field (e.g. `brightness`). */
  fixedSpec?: CapabilityFieldSpec;
  /** Start+end pair (e.g. `brightnessStart` + `brightnessEnd`). */
  rangeSpecs?: [CapabilityFieldSpec, CapabilityFieldSpec];
};

/**
 * Groups capability field specs by root key, pairing fixed and Start/End variants
 * so the UI can render a toggle between "fixed value" and "start … end range".
 */
function combinedRangeFields(type: string): CombinedGroup[] {
  const specs = (CAPABILITY_RANGE_FIELDS as Record<string, CapabilityFieldSpec[] | undefined>)[type] ?? [];
  const byRoot = new Map<string, { fixed?: CapabilityFieldSpec; start?: CapabilityFieldSpec; end?: CapabilityFieldSpec }>();

  for (const spec of specs) {
    const isStart = spec.key.endsWith('Start');
    const isEnd = spec.key.endsWith('End');
    const root = spec.key.replace(/Start$|End$/, '');
    if (!byRoot.has(root)) byRoot.set(root, {});
    const entry = byRoot.get(root)!;
    if (isStart) entry.start = spec;
    else if (isEnd) entry.end = spec;
    else entry.fixed = spec;
  }

  const result: CombinedGroup[] = [];
  for (const [root, { fixed, start, end }] of byRoot) {
    const label = root.replace(/([A-Z])/g, ' $1').trim().replace(/^./, (s: string) => s.toUpperCase());
    result.push({
      label,
      root,
      fixedSpec: fixed,
      rangeSpecs: start && end ? [start, end] : undefined,
    });
  }
  return result;
}

/**
 * Returns true if this group is in "range mode" (start/end values are set)
 * rather than "fixed value mode".
 */
function isRangeMode(r: CapabilityRange, group: CombinedGroup): boolean {
  if (!group.rangeSpecs) return false;
  return (r as any)[group.rangeSpecs[0].key] !== undefined
      || (r as any)[group.rangeSpecs[1].key] !== undefined;
}

/**
 * Toggle between fixed-value mode and start/end range mode for a field group.
 * Clears the fields for the mode being deactivated.
 */
function toggleRangeMode(rangeId: string, group: CombinedGroup, r: CapabilityRange) {
  const currentlyRange = isRangeMode(r, group);
  const patch: Record<string, unknown> = {};
  if (currentlyRange) {
    // → switch to fixed: clear start/end
    if (group.rangeSpecs) {
      patch[group.rangeSpecs[0].key] = undefined;
      patch[group.rangeSpecs[1].key] = undefined;
    }
    if (group.fixedSpec) patch[group.fixedSpec.key] = group.fixedSpec.defaultValue ?? 0;
  } else {
    // → switch to range: clear fixed, set start/end defaults
    if (group.fixedSpec) patch[group.fixedSpec.key] = undefined;
    if (group.rangeSpecs) {
      patch[group.rangeSpecs[0].key] = group.rangeSpecs[0].defaultValue ?? 0;
      patch[group.rangeSpecs[1].key] = group.rangeSpecs[1].defaultValue ?? (group.rangeSpecs[1].max ?? 1);
    }
  }
  patchRange(rangeId, patch);
}

/** Swap start and end values for a range pair. */
function swapRangeEnds(rangeId: string, group: CombinedGroup, r: CapabilityRange) {
  if (!group.rangeSpecs) return;
  patchRange(rangeId, {
    [group.rangeSpecs[0].key]: (r as any)[group.rangeSpecs[1].key],
    [group.rangeSpecs[1].key]: (r as any)[group.rangeSpecs[0].key],
  });
}

// ─── Wheel overlay ────────────────────────────────────────────────────────────

const wheelOverlayOpen = ref(false);

/** The WheelDraft for the currently selected channel (if it's a wheel-type channel). */
const selectedChannelWheel = computed(() =>
  selectedChannel.value && WHEEL_CAPABILITY_TYPES.has(selectedChannel.value.capabilityType)
    ? props.wheels.find(w => w.channelId === selectedChannel.value!.id) ?? null
    : null
);

function patchWheel(patch: Partial<WheelDraft>) {
  if (!selectedChannelWheel.value) return;
  const id = selectedChannelWheel.value.wheelId;
  emit('update:wheels', props.wheels.map(w => w.wheelId === id ? { ...w, ...patch } : w));
}

function addSlot() {
  if (!selectedChannelWheel.value) return;
  const slot: WheelSlotDraft = { slotId: crypto.randomUUID(), type: 'Color', name: '', colors: ['#ffffff'] };
  patchWheel({ slots: [...selectedChannelWheel.value.slots, slot] });
}

function deleteSlot(slotId: string) {
  if (!selectedChannelWheel.value) return;
  patchWheel({ slots: selectedChannelWheel.value.slots.filter(s => s.slotId !== slotId) });
}

function patchSlot(slotId: string, patch: Partial<WheelSlotDraft>) {
  if (!selectedChannelWheel.value) return;
  patchWheel({ slots: selectedChannelWheel.value.slots.map(s => s.slotId === slotId ? { ...s, ...patch } : s) });
}

const SLOT_TYPES = ['Open', 'Color', 'Gobo', 'Prism', 'Frost', 'Iris'] as const;

function slotBg(slot: WheelSlotDraft): string {
  if (slot.type === 'Color') {
    if (slot.colors.length >= 2) return `linear-gradient(135deg, ${slot.colors[0]} 50%, ${slot.colors[1]} 50%)`;
    return slot.colors[0] ?? '#ffffff';
  }
  const fallback: Record<string, string> = { Open: '#1e293b', Gobo: '#78716c', Prism: '#a78bfa', Frost: '#bfdbfe', Iris: '#94a3b8' };
  return fallback[slot.type] ?? '#64748b';
}

/** Wheel-compatible range types (non-slot options): rotation, shake, nothing */
const WHEEL_RANGE_TYPES = ['COLOR_WHEEL', 'GOBO_WHEEL', 'GOBO_SPIN', 'PRISM', 'PRISM_ROTATION', 'NO_FUNCTION'] as const;

// ─── Mode management ──────────────────────────────────────────────────────────

const activeMode = ref(0);
const currentMode = computed(() => props.modes[activeMode.value] ?? props.modes[0]);

function updateMode(patch: Partial<ModeDraft>) {
  if (!currentMode.value) return;
  emit('update:modes', props.modes.map((m, i) =>
    i === activeMode.value ? { ...m, ...patch } : m
  ));
}

function addMode() {
  const id = crypto.randomUUID();
  emit('update:modes', [...props.modes, { id, name: `Mode ${props.modes.length + 1}`, entries: [] }]);
  activeMode.value = props.modes.length;
}

const editingModeIdx = ref<number | null>(null);
const editingModeName = ref('');

function startRenameMode(idx: number) {
  editingModeIdx.value = idx;
  editingModeName.value = props.modes[idx]?.name ?? '';
}

function commitRenameMode() {
  if (editingModeIdx.value !== null && editingModeName.value.trim()) {
    emit('update:modes', props.modes.map((m, i) =>
      i === editingModeIdx.value ? { ...m, name: editingModeName.value.trim() } : m
    ));
  }
  editingModeIdx.value = null;
}

// ─── Mode entries ─────────────────────────────────────────────────────────────

function addSingleToMode(channelId: string) {
  if (!currentMode.value) return;
  const entry: ModeEntry = { entryId: crypto.randomUUID(), channelId, perHead: false, order: 'perPixel' };
  updateMode({ entries: [...currentMode.value.entries, entry] });
}

function removeEntry(entryId: string) {
  updateMode({ entries: currentMode.value.entries.filter(e => e.entryId !== entryId) });
}

function patchEntry(entryId: string, patch: Partial<ModeEntry>) {
  updateMode({
    entries: currentMode.value.entries.map(e =>
      e.entryId === entryId ? { ...e, ...patch } : e
    ),
  });
}

// ─── Per-head group helpers ───────────────────────────────────────────────────

/** True if this entry is the last in a consecutive run of perHead entries. */
function isGroupEnd(idx: number): boolean {
  const entries = currentMode.value?.entries ?? [];
  return !!entries[idx]?.perHead &&
    (idx === entries.length - 1 || !entries[idx + 1]?.perHead);
}

/** Returns all entries belonging to the same per-head group as `idx`. */
function groupEntries(idx: number): { entry: ModeEntry; idx: number }[] {
  const entries = currentMode.value?.entries ?? [];
  // Walk back to find start
  let start = idx;
  while (start > 0 && entries[start - 1]?.perHead) start--;
  // Walk forward to find end
  const result: { entry: ModeEntry; idx: number }[] = [];
  let i = start;
  while (i < entries.length && entries[i]?.perHead) {
    result.push({ entry: entries[i]!, idx: i });
    i++;
  }
  return result;
}

/** Order stored on the first entry of the group. */
function groupOrder(idx: number): 'perPixel' | 'perChannel' {
  const entries = currentMode.value?.entries ?? [];
  let start = idx;
  while (start > 0 && entries[start - 1]?.perHead) start--;
  return entries[start]?.order ?? 'perPixel';
}

function setGroupOrder(idx: number, order: 'perPixel' | 'perChannel') {
  // Apply to all entries in the group
  const group = groupEntries(idx);
  const ids = new Set(group.map(g => g.entry.entryId));
  updateMode({
    entries: currentMode.value.entries.map(e =>
      ids.has(e.entryId) ? { ...e, order } : e
    ),
  });
}

// ─── Collapsible group previews ───────────────────────────────────────────────

const expandedGroups = ref(new Set<string>());

/** Stable key for a group based on the first entry's id. */
function groupKey(idx: number): string {
  return groupEntries(idx)[0]?.entry.entryId ?? String(idx);
}

function toggleGroup(idx: number) {
  const key = groupKey(idx);
  const next = new Set(expandedGroups.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  expandedGroups.value = next;
}

function isGroupExpanded(idx: number): boolean {
  return expandedGroups.value.has(groupKey(idx));
}

// ─── Safe channel lookup ──────────────────────────────────────────────────────

const channelMap = computed(() => new Map(props.channels.map(c => [c.id, c])));
const ch = (id: string) => channelMap.value.get(id) ?? null;

// ─── DMX address helpers ──────────────────────────────────────────────────────

const addrOf = (id: string) => ch(id)?.resolution === '16bit' ? 2 : 1;

/** DMX start address (1-based) for the entry at position `idx` in the current mode. */
function entryStartAddress(idx: number): number {
  const entries = currentMode.value?.entries ?? [];
  let addr = 1;
  let i = 0;
  while (i < entries.length) {
    const e = entries[i]!;
    if (!e.perHead) {
      if (i >= idx) break;
      addr += addrOf(e.channelId);
      i++;
    } else {
      // Find extent of this perHead group
      const groupStart = i;
      let groupEnd = i;
      while (groupEnd < entries.length && entries[groupEnd]!.perHead) groupEnd++;
      // groupEnd is exclusive

      if (idx < groupEnd) {
        // idx is inside this group: linear offset within head 1
        for (let j = groupStart; j < idx; j++) addr += addrOf(entries[j]!.channelId);
        return addr;
      }
      // idx is after this group: add full expanded size
      let groupSize = 0;
      for (let j = groupStart; j < groupEnd; j++) groupSize += addrOf(entries[j]!.channelId);
      addr += groupSize * props.headCount;
      i = groupEnd;
    }
  }
  return addr;
}

/**
 * DMX address for a specific channel within a per-head group, for a given head.
 * @param groupLastIdx - index of the last entry in the group
 * @param chInGroupIdx - 0-based index of the channel within the group
 * @param headNum - 1-based head number (1 = head 1 already shown in the main list)
 */
function previewAddr(groupLastIdx: number, chInGroupIdx: number, headNum: number): number {
  const group = groupEntries(groupLastIdx);
  if (!group.length) return 0;
  const baseAddr = entryStartAddress(group[0]!.idx);
  const order = groupOrder(groupLastIdx);

  if (order === 'perPixel') {
    const groupSize = group.reduce((s, g) => s + addrOf(g.entry.channelId), 0);
    let offsetInGroup = 0;
    for (let j = 0; j < chInGroupIdx; j++) offsetInGroup += addrOf(group[j]!.entry.channelId);
    return baseAddr + (headNum - 1) * groupSize + offsetInGroup;
  } else {
    // perChannel: all head-1 of ch0, then all head-1 of ch1, ...
    let offset = 0;
    for (let j = 0; j < chInGroupIdx; j++) offset += addrOf(group[j]!.entry.channelId) * props.headCount;
    return baseAddr + offset + (headNum - 1) * addrOf(group[chInGroupIdx]!.entry.channelId);
  }
}

// ─── Drag-to-reorder ─────────────────────────────────────────────────────────

const dragFromIdx = ref<number | null>(null);
const dragOverIdx = ref<number | null>(null);

function onDragStart(idx: number, e: DragEvent) {
  dragFromIdx.value = idx;
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}
function onDragOver(idx: number, e: DragEvent) {
  e.preventDefault();
  dragOverIdx.value = idx;
}
function onDrop(toIdx: number) {
  const from = dragFromIdx.value;
  if (from === null || from === toIdx || !currentMode.value) return;
  const entries = [...currentMode.value.entries];
  const [moved] = entries.splice(from, 1);
  entries.splice(toIdx, 0, moved!);
  updateMode({ entries });
  dragFromIdx.value = null;
  dragOverIdx.value = null;
}
function onDragEnd() { dragFromIdx.value = null; dragOverIdx.value = null; }
</script>

<template>
  <div class="flex flex-1 min-h-0 min-w-0">

    <!-- ── Col 1: Channel list ─────────────────────────────────────────────── -->
    <div class="w-52 border-r flex flex-col min-h-0 shrink-0">
      <div class="border-b bg-muted/10 shrink-0 px-3 py-2 flex items-center justify-between">
        <p class="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/60">
          Channels <span class="font-normal text-muted-foreground/40">({{ channels.length }})</span>
        </p>
        <Button size="sm" variant="ghost" class="h-6 px-2 gap-1 text-xs" @click="addChannel">
          <Plus class="size-3" /> Add
        </Button>
      </div>
      <div class="flex-1 overflow-y-auto min-h-0">
        <div v-if="channels.length === 0"
          class="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground/40 text-xs">
          <Button size="sm" variant="outline" class="gap-1.5" @click="addChannel">
            <Plus class="size-3.5" /> Add first channel
          </Button>
        </div>
        <div
          v-for="c in channels" :key="c.id"
          class="flex items-center gap-2 px-3 py-2 border-b border-border/40 group cursor-pointer hover:bg-muted/20 transition-colors"
          :class="selectedChannelId === c.id
            ? 'bg-muted/30 border-l-2 border-l-primary'
            : 'border-l-2 border-l-transparent'"
          @click="emit('update:selectedChannelId', c.id)"
        >
          <span class="size-2.5 rounded-full shrink-0 ring-1 ring-black/10"
            :style="{ backgroundColor: CHANNEL_CAPABILITY_META[c.capabilityType].color }" />
          <span class="flex-1 text-xs font-medium truncate">{{ c.name }}</span>
          <button class="opacity-0 group-hover:opacity-100 text-muted-foreground/30 hover:text-destructive shrink-0"
            @click.stop="deleteChannel(c.id)">
            <Trash2 class="size-3" />
          </button>
        </div>
      </div>
    </div>

    <!-- ── Col 2: Channel editor ───────────────────────────────────────────── -->
    <div class="w-80 border-r flex flex-col min-h-0 shrink-0">
      <div class="border-b bg-muted/10 shrink-0 px-3 py-2">
        <p class="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/60">Edit Channel</p>
      </div>

      <div class="flex-1 overflow-y-auto min-h-0">
        <template v-if="selectedChannel">
          <div class="p-3 space-y-2">
            <!-- Name -->
            <div class="flex items-center gap-2">
              <span class="size-3 rounded-full shrink-0 ring-1 ring-black/10"
                :style="{ backgroundColor: CHANNEL_CAPABILITY_META[selectedChannel.capabilityType].color }" />
              <Input :model-value="selectedChannel.name"
                @update:model-value="patchChannel({ name: String($event) })"
                placeholder="Channel name"
                class="h-8 text-sm flex-1" />
            </div>

            <!-- Capability type selector (always visible) -->
            <Select :model-value="selectedChannel.capabilityType"
              @update:model-value="changeChannelType($event as string)">
              <SelectTrigger class="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <template v-for="(items, group) in capabilityGroups" :key="group">
                  <div class="px-2 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold">{{ group }}</div>
                  <SelectItem v-for="item in items" :key="item.type" :value="item.type" class="text-xs pl-4">
                    <div class="flex items-center gap-2">
                      <span class="size-2 rounded-full ring-1 ring-black/10"
                        :style="{ backgroundColor: CHANNEL_CAPABILITY_META[item.type as any].color }" />
                      {{ item.label }}
                    </div>
                  </SelectItem>
                </template>
              </SelectContent>
            </Select>

            <!-- Resolution -->
            <div class="grid grid-cols-2 gap-1.5">
              <Button variant="outline" size="sm" class="h-8 text-xs"
                :class="selectedChannel.resolution === '8bit' ? 'bg-muted/60 text-foreground font-semibold' : ''"
                @click="patchChannel({ resolution: '8bit' })">
                8-bit <span class="text-muted-foreground/50 ml-1 text-[9px]">1 addr</span>
              </Button>
              <Button variant="outline" size="sm" class="h-8 text-xs"
                :class="selectedChannel.resolution === '16bit' ? 'bg-muted/60 text-foreground font-semibold' : ''"
                @click="patchChannel({ resolution: '16bit' })">
                16-bit <span class="text-muted-foreground/50 ml-1 text-[9px]">2 addr</span>
              </Button>
            </div>

            <!-- Default value -->
            <DraggableNumberInput label="Default" :model-value="selectedChannel.defaultValue"
              @update:model-value="patchChannel({ defaultValue: $event })"
              :min="0" :max="255" :step="1" />
          </div>

          <!-- ── DMX Ranges ───────────────────────────────────────────── -->
          <div class="border-t px-3 pt-2 pb-3 space-y-2">
            <p class="text-[9px] uppercase tracking-wider font-bold text-muted-foreground/60">DMX Ranges</p>

            <!-- Visual bar -->
            <div class="h-2.5 w-full rounded overflow-hidden flex gap-px bg-muted/30">
              <template v-if="selectedChannel.capabilities.length === 0">
                <div class="h-full flex-1"
                  :style="{ backgroundColor: CHANNEL_CAPABILITY_META[selectedChannel.capabilityType].color }" />
              </template>
              <template v-else>
                <div v-for="r in selectedChannel.capabilities" :key="r.rangeId"
                  class="h-full"
                  :style="{
                    width: `${((r.dmxMax - r.dmxMin + 1) / 256) * 100}%`,
                    backgroundColor: CHANNEL_CAPABILITY_META[r.type].color,
                    minWidth: '2px',
                  }"
                  :title="`${r.dmxMin}–${r.dmxMax}: ${CHANNEL_CAPABILITY_META[r.type].label}`"
                />
              </template>
            </div>

            <!-- Range rows — unified (single full-range or multiple explicit) -->
            <div v-for="(r, ri) in selectedChannel.capabilities" :key="r.rangeId"
              class="rounded border border-border/40 bg-muted/5 p-2.5 space-y-2">

              <!-- Header: color dot + dmx range + delete -->
              <div class="flex items-center gap-1.5">
                <span class="size-2 rounded-full shrink-0 ring-1 ring-black/5"
                  :style="{
                    background: (r as any).wheelSlotId && selectedChannelWheel
                      ? slotBg(selectedChannelWheel.slots.find(s => s.slotId === (r as any).wheelSlotId) ?? { type: 'Open', colors: [] } as any)
                      : CHANNEL_CAPABILITY_META[r.type as any]?.color
                  }" />
                <!-- DMX min/max: hidden for single full-range, shown for multi-range -->
                <template v-if="!isSingleFullRange">
                  <div class="flex items-center gap-1 flex-1">
                    <DraggableNumberInput label="Min" :model-value="r.dmxMin"
                      @update:model-value="patchRange(r.rangeId, { dmxMin: $event })"
                      :min="ri === 0 ? 0 : selectedChannel.capabilities[ri - 1]!.dmxMin + 1"
                      :max="r.dmxMax" :step="1" class="flex-1" />
                    <span class="text-muted-foreground/30 text-xs shrink-0">–</span>
                    <DraggableNumberInput label="Max" :model-value="r.dmxMax"
                      @update:model-value="onRangeMaxChange(r.rangeId, $event)"
                      :min="r.dmxMin"
                      :max="ri === selectedChannel.capabilities.length - 1 ? 255 : selectedChannel.capabilities[ri + 1]!.dmxMax - 1"
                      :step="1" class="flex-1" />
                  </div>
                  <button class="text-muted-foreground/30 hover:text-destructive shrink-0 transition-colors"
                    @click="removeCapabilityRange(r.rangeId)">
                    <X class="size-3.5" />
                  </button>
                </template>
                <template v-else>
                  <span class="text-[10px] text-muted-foreground/40 font-mono flex-1">0 – 255 (full range)</span>
                </template>
              </div>

              <!-- Wheel channel: slot picker -->
              <template v-if="selectedChannelWheel">
                <div class="flex items-center justify-between">
                  <span class="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/50">Slots</span>
                  <button
                    class="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border border-border/50 hover:border-primary/50 hover:bg-primary/5 transition-colors text-muted-foreground/50 hover:text-foreground"
                    @click="wheelOverlayOpen = true"
                  >
                    <Disc3 class="size-3" /> Edit wheel
                  </button>
                </div>
                <div v-if="selectedChannelWheel.slots.length === 0"
                  class="text-[10px] text-muted-foreground/40 italic">
                  No slots defined — click "Edit wheel" to add slots
                </div>
                <div v-else class="flex flex-wrap gap-1">
                  <button
                    v-for="slot in selectedChannelWheel.slots" :key="slot.slotId"
                    class="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors"
                    :class="(r as any).wheelSlotId === slot.slotId
                      ? 'border-primary/60 bg-primary/5 text-foreground'
                      : 'border-border/50 text-muted-foreground/50 hover:border-border hover:text-foreground'"
                    @click="patchRange(r.rangeId, { wheelSlotId: (r as any).wheelSlotId === slot.slotId ? undefined : slot.slotId, type: selectedChannel.capabilityType })"
                  >
                    <span class="size-2 rounded-full shrink-0" :style="{ background: slotBg(slot) }" />
                    {{ slot.name || slot.type }}
                  </button>
                  <Select
                    :model-value="(r as any).wheelSlotId ? '' : r.type"
                    @update:model-value="patchRange(r.rangeId, { type: $event, wheelSlotId: undefined })">
                    <SelectTrigger class="h-6 w-28 text-[10px] px-2 border-dashed"
                      :class="!(r as any).wheelSlotId ? 'border-primary/60 bg-primary/5' : ''">
                      <SelectValue placeholder="Other…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="t in WHEEL_RANGE_TYPES" :key="t" :value="t" class="text-xs">
                        {{ CHANNEL_CAPABILITY_META[t].label }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </template>

              <!-- Normal channel: per-range type selector (shown only for multi-range) + label + extra fields -->
              <template v-else>
                <!-- Per-range type selector shown only when there are multiple ranges -->
                <Select v-if="!isSingleFullRange" :model-value="r.type"
                  @update:model-value="patchRange(r.rangeId, { type: $event as any })">
                  <SelectTrigger class="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <template v-for="(items, group) in capabilityGroups" :key="group">
                      <div class="px-2 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold">{{ group }}</div>
                      <SelectItem v-for="item in items" :key="item.type" :value="item.type" class="text-xs pl-4">
                        <div class="flex items-center gap-2">
                          <span class="size-2 rounded-full ring-1 ring-black/10"
                            :style="{ backgroundColor: CHANNEL_CAPABILITY_META[item.type as any].color }" />
                          {{ item.label }}
                        </div>
                      </SelectItem>
                    </template>
                  </SelectContent>
                </Select>

                <Input :model-value="r.label"
                  @update:model-value="patchRange(r.rangeId, { label: String($event) })"
                  placeholder="Label / description (optional)" class="h-7 text-xs" />

                <!-- Type-specific extra fields, rendered from Zod schema -->
                <template v-if="(CAPABILITY_RANGE_FIELDS[r.type as any] ?? []).length > 0">
                  <template v-for="group in combinedRangeFields(r.type as any)" :key="group.root">

                    <!-- Section header + range toggle (if group has both fixed and range variants) -->
                    <div class="flex items-center justify-between pt-1">
                      <p class="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/50">
                        {{ group.label }}
                      </p>
                      <!-- Range toggle: only shown when both fixed and range variants exist -->
                      <button
                        v-if="group.fixedSpec && group.rangeSpecs"
                        class="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded transition-colors"
                        :class="isRangeMode(r, group)
                          ? 'bg-primary/10 text-primary border border-primary/30'
                          : 'text-muted-foreground/50 hover:text-foreground border border-border/50 hover:border-border'"
                        :title="isRangeMode(r, group) ? 'Switch to fixed value' : 'Switch to start → end range'"
                        @click="toggleRangeMode(r.rangeId, group, r)"
                      >
                        <ArrowLeftRight class="size-2.5" />
                        {{ isRangeMode(r, group) ? 'Range' : 'Fixed' }}
                      </button>
                    </div>

                    <!-- Fixed value (shown when NOT in range mode, or when no rangeSpecs) -->
                    <template v-if="group.fixedSpec && !isRangeMode(r, group)">
                      <DraggableNumberInput
                        v-if="group.fixedSpec.kind === 'number'"
                        :label="group.fixedSpec.label"
                        :model-value="(r as any)[group.fixedSpec.key] ?? group.fixedSpec.defaultValue ?? 0"
                        @update:model-value="patchRange(r.rangeId, { [group.fixedSpec.key]: $event })"
                        :min="group.fixedSpec.min" :max="group.fixedSpec.max" :step="group.fixedSpec.step ?? 1"
                        :description="group.fixedSpec.description"
                      />
                      <Select
                        v-else-if="group.fixedSpec.kind === 'select'"
                        :model-value="(r as any)[group.fixedSpec.key] ?? '_none'"
                        @update:model-value="patchRange(r.rangeId, { [group.fixedSpec.key]: $event === '_none' ? undefined : $event })"
                      >
                        <SelectTrigger class="h-7 text-xs"><SelectValue :placeholder="group.fixedSpec.label" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none" class="text-xs text-muted-foreground">— {{ group.fixedSpec.label }}</SelectItem>
                          <SelectItem v-for="opt in group.fixedSpec.options" :key="opt" :value="opt" class="text-xs">{{ opt }}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        v-else-if="group.fixedSpec.kind === 'text'"
                        :model-value="(r as any)[group.fixedSpec.key] ?? ''"
                        @update:model-value="patchRange(r.rangeId, { [group.fixedSpec.key]: String($event) })"
                        :placeholder="group.fixedSpec.label"
                        :title="group.fixedSpec.description"
                        class="h-7 text-xs"
                      />
                    </template>

                    <!-- Start … End range pair (shown when in range mode, or when no fixedSpec) -->
                    <template v-if="group.rangeSpecs && (isRangeMode(r, group) || !group.fixedSpec)">
                      <div class="flex items-center gap-1">
                        <!-- start -->
                        <DraggableNumberInput
                          v-if="group.rangeSpecs[0].kind === 'number'"
                          label="Start"
                          :model-value="(r as any)[group.rangeSpecs[0].key] ?? group.rangeSpecs[0].defaultValue ?? 0"
                          @update:model-value="patchRange(r.rangeId, { [group.rangeSpecs[0].key]: $event })"
                          :min="group.rangeSpecs[0].min" :max="group.rangeSpecs[0].max" :step="group.rangeSpecs[0].step ?? 1"
                          :description="group.rangeSpecs[0].description"
                          class="flex-1"
                        />
                        <Input
                          v-else-if="group.rangeSpecs[0].kind === 'text'"
                          :model-value="(r as any)[group.rangeSpecs[0].key] ?? ''"
                          @update:model-value="patchRange(r.rangeId, { [group.rangeSpecs[0].key]: String($event) })"
                          :title="group.rangeSpecs[0].description"
                          class="h-7 text-xs flex-1"
                        />
                        <!-- swap button -->
                        <button
                          class="shrink-0 size-6 flex items-center justify-center rounded border border-border/40 hover:border-border hover:bg-muted/30 transition-colors text-muted-foreground/40 hover:text-foreground"
                          title="Swap start and end"
                          @click="swapRangeEnds(r.rangeId, group, r)"
                        >
                          <ArrowLeftRight class="size-3" />
                        </button>
                        <!-- end -->
                        <DraggableNumberInput
                          v-if="group.rangeSpecs[1].kind === 'number'"
                          label="End"
                          :model-value="(r as any)[group.rangeSpecs[1].key] ?? group.rangeSpecs[1].defaultValue ?? 0"
                          @update:model-value="patchRange(r.rangeId, { [group.rangeSpecs[1].key]: $event })"
                          :min="group.rangeSpecs[1].min" :max="group.rangeSpecs[1].max" :step="group.rangeSpecs[1].step ?? 1"
                          :description="group.rangeSpecs[1].description"
                          class="flex-1"
                        />
                        <Input
                          v-else-if="group.rangeSpecs[1].kind === 'text'"
                          :model-value="(r as any)[group.rangeSpecs[1].key] ?? ''"
                          @update:model-value="patchRange(r.rangeId, { [group.rangeSpecs[1].key]: String($event) })"
                          :title="group.rangeSpecs[1].description"
                          class="h-7 text-xs flex-1"
                        />
                      </div>
                      <div class="flex justify-between px-0.5">
                        <span class="text-[9px] text-muted-foreground/35 italic">at range start</span>
                        <span class="text-[9px] text-muted-foreground/35 italic">at range end</span>
                      </div>
                    </template>

                  </template>
                </template>
              </template>
            </div>

            <!-- Add range button -->
            <button
              class="w-full flex items-center justify-center gap-1 py-1.5 rounded border border-dashed border-border/50 hover:border-primary/50 hover:bg-primary/5 text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors"
              @click="addCapabilityRange">
              <Plus class="size-3" /> Split into ranges
            </button>
          </div>
        </template>

        <div v-else class="flex items-center justify-center h-full text-xs text-muted-foreground/30">
          Select a channel to edit
        </div>
      </div>
    </div>

    <!-- ── Col 3: Mode arrangement ─────────────────────────────────────────── -->
    <div class="flex-1 flex flex-col min-h-0 min-w-0 relative">

      <!-- Mode tabs -->
      <div class="shrink-0 border-b bg-muted/10 flex items-stretch overflow-x-auto">
        <button v-for="(mode, idx) in modes" :key="mode.id"
          class="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-r border-border/40 transition-colors relative shrink-0"
          :class="activeMode === idx ? 'text-foreground bg-background' : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/20'"
          @click="activeMode = idx" @dblclick.stop="startRenameMode(idx)">
          <span v-if="activeMode === idx" class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
          <input v-if="editingModeIdx === idx" v-model="editingModeName"
            class="w-24 bg-transparent outline-none text-sm border-b border-primary"
            @blur="commitRenameMode" @keydown.enter="commitRenameMode"
            @keydown.escape="editingModeIdx = null" @click.stop autofocus />
          <span v-else>{{ mode.name }}</span>
          <span class="text-[9px] text-muted-foreground/40 ml-0.5">
            {{ modeAddressCount(mode, channels, headCount) }}ch
          </span>
        </button>
        <button class="px-3 py-2.5 text-muted-foreground/40 hover:text-foreground transition-colors shrink-0"
          title="Add mode" @click="addMode">
          <Plus class="size-4" />
        </button>
      </div>

      <!-- Quick-add bar -->
      <div v-if="channels.length > 0"
        class="shrink-0 border-b px-3 py-2 flex flex-wrap gap-1.5 bg-muted/5">
        <p class="w-full text-[9px] uppercase tracking-wider text-muted-foreground/40 mb-0.5">Add to mode</p>
        <button v-for="c in channels" :key="c.id"
          class="flex items-center gap-1.5 px-2 py-0.5 rounded border border-dashed border-border/50 hover:border-primary/50 hover:bg-primary/5 transition-colors text-[10px] text-muted-foreground/60 hover:text-foreground"
          @click="addSingleToMode(c.id)">
          <span class="size-1.5 rounded-full"
            :style="{ backgroundColor: CHANNEL_CAPABILITY_META[c.capabilityType].color }" />
          {{ c.name }}
        </button>
      </div>

      <!-- Entry list — pb-16 to avoid overlap with floating button -->
      <div class="flex-1 overflow-y-auto pb-16">
        <div v-if="!currentMode || currentMode.entries.length === 0"
          class="flex flex-col items-center justify-center h-full text-muted-foreground/40 text-xs gap-1.5">
          <p>No channels in this mode</p>
          <p class="text-[10px]">Add channels using the bar above</p>
        </div>

        <template v-if="currentMode">
          <template v-for="(entry, idx) in currentMode.entries" :key="entry.entryId">

            <div
              draggable="true"
              class="flex items-center gap-2 px-3 py-2 border-b border-border/40 transition-colors group"
              :class="{
                'opacity-40': dragFromIdx === idx,
                'border-t-2 border-t-primary': dragOverIdx === idx && dragFromIdx !== idx,
              }"
              @dragstart="onDragStart(idx, $event)"
              @dragover="onDragOver(idx, $event)"
              @drop="onDrop(idx)"
              @dragend="onDragEnd"
            >
              <GripVertical class="size-3.5 text-muted-foreground/20 cursor-grab active:cursor-grabbing shrink-0" />
              <span class="text-[10px] font-mono text-muted-foreground/40 w-6 text-right shrink-0 tabular-nums">
                {{ entryStartAddress(idx) }}
              </span>
              <template v-if="ch(entry.channelId)">
                <span class="size-2 rounded-full ring-1 ring-black/10 shrink-0"
                  :style="{ backgroundColor: CHANNEL_CAPABILITY_META[ch(entry.channelId)!.capabilityType].color }" />
                <span class="flex-1 text-sm truncate">{{ ch(entry.channelId)!.name }}</span>
                <span class="text-[9px] font-mono bg-muted/40 rounded px-1 text-muted-foreground/50 shrink-0">
                  {{ ch(entry.channelId)!.resolution }}
                </span>
              </template>
              <span v-else class="flex-1 text-xs text-destructive/60 italic">deleted</span>

              <Select v-if="headCount > 1"
                :model-value="entry.perHead ? 'perHead' : 'single'"
                @update:model-value="patchEntry(entry.entryId, { perHead: $event === 'perHead' })">
                <SelectTrigger class="h-6 w-[7.5rem] text-[10px] px-2 shrink-0"
                  :class="entry.perHead ? 'border-primary/40 text-primary' : ''">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single" class="text-xs">Single</SelectItem>
                  <SelectItem value="perHead" class="text-xs">Per Head</SelectItem>
                </SelectContent>
              </Select>

              <button class="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/40 hover:text-destructive shrink-0"
                @click="removeEntry(entry.entryId)">
                <X class="size-3.5" />
              </button>
            </div>

            <!-- Collapsible per-head group preview -->
            <div v-if="isGroupEnd(idx)" class="border-b border-border/40 bg-muted/5">
              <button
                class="w-full flex items-center gap-2 px-4 py-1.5 text-[10px] text-muted-foreground/60 hover:text-foreground hover:bg-muted/10 transition-colors"
                @click="toggleGroup(idx)"
              >
                <component :is="isGroupExpanded(idx) ? ChevronDown : ChevronRight" class="size-3 shrink-0" />
                <span class="flex items-center gap-1 flex-1 flex-wrap">
                  <template v-for="g in groupEntries(idx)" :key="g.entry.entryId">
                    <span v-if="ch(g.entry.channelId)" class="flex items-center gap-1">
                      <span class="size-1.5 rounded-full"
                        :style="{ backgroundColor: CHANNEL_CAPABILITY_META[ch(g.entry.channelId)!.capabilityType].color }" />
                      {{ ch(g.entry.channelId)!.name }}
                    </span>
                  </template>
                  <span class="text-muted-foreground/40">
                    × {{ headCount }} heads
                    ({{ groupEntries(idx).reduce((s, g) => s + (ch(g.entry.channelId)?.resolution === '16bit' ? 2 : 1), 0) * headCount }} addr total)
                  </span>
                </span>
                <div class="flex items-center gap-0 rounded overflow-hidden border border-border/50 h-5 text-[9px] shrink-0 ml-auto"
                  @click.stop>
                  <button
                    class="px-1.5 h-full transition-colors"
                    :class="groupOrder(idx) === 'perPixel' ? 'bg-muted/60 text-foreground font-semibold' : 'text-muted-foreground/40 hover:bg-muted/30'"
                    @click="setGroupOrder(idx, 'perPixel')">Per Pixel</button>
                  <button
                    class="px-1.5 h-full border-l border-border/50 transition-colors"
                    :class="groupOrder(idx) === 'perChannel' ? 'bg-muted/60 text-foreground font-semibold' : 'text-muted-foreground/40 hover:bg-muted/30'"
                    @click="setGroupOrder(idx, 'perChannel')">Per Channel</button>
                </div>
              </button>
              <template v-if="isGroupExpanded(idx)">
                <template v-for="head in Math.min(headCount - 1, 4)" :key="head">
                  <div class="border-t border-dashed border-border/30 px-4 py-1">
                    <p class="text-[9px] text-muted-foreground/30 mb-0.5">Head {{ head + 1 }}</p>
                    <div class="flex flex-wrap gap-x-4 gap-y-0.5">
                      <span v-for="(g, chIdx) in groupEntries(idx)" :key="g.entry.entryId"
                        class="flex items-center gap-1.5 text-[10px] text-muted-foreground/40">
                        <span class="font-mono tabular-nums text-muted-foreground/25">{{ previewAddr(idx, chIdx, head + 1) }}</span>
                        <span v-if="ch(g.entry.channelId)" class="size-1.5 rounded-full opacity-50"
                          :style="{ backgroundColor: CHANNEL_CAPABILITY_META[ch(g.entry.channelId)!.capabilityType].color }" />
                        {{ ch(g.entry.channelId)?.name ?? '?' }}
                      </span>
                    </div>
                  </div>
                </template>
                <div v-if="headCount > 5"
                  class="px-4 py-1.5 text-[9px] text-muted-foreground/30 border-t border-dashed border-border/30">
                  … and {{ headCount - 5 }} more heads
                </div>
              </template>
            </div>

          </template>
        </template>
      </div>

      <!-- Floating Next button -->
      <div class="absolute bottom-4 right-4">
        <Button class="gap-2 h-9 shadow-lg" @click="emit('next')">
          Next →
        </Button>
      </div>
    </div>

  </div>

  <!-- ── Wheel slot overlay ─────────────────────────────────────────────── -->
  <Dialog :open="wheelOverlayOpen" @update:open="wheelOverlayOpen = $event">
    <DialogContent class="!max-w-xl p-0 overflow-hidden flex flex-col gap-0">
      <template v-if="selectedChannelWheel">
        <!-- Header -->
        <div class="px-4 py-3 border-b flex items-center gap-3">
          <Disc3 class="size-4 text-muted-foreground/50 shrink-0" />
          <Input
            :model-value="selectedChannelWheel.name"
            @update:model-value="patchWheel({ name: String($event) })"
            class="h-8 text-sm flex-1"
          />
          <div class="flex rounded overflow-hidden border border-border/50 text-[10px] shrink-0">
            <button class="px-2 py-1 transition-colors"
              :class="!selectedChannelWheel.direction ? 'bg-muted/60 text-foreground font-semibold' : 'text-muted-foreground/40 hover:bg-muted/30'"
              @click="patchWheel({ direction: undefined })">—</button>
            <button class="px-2 py-1 border-l border-border/50 transition-colors"
              :class="selectedChannelWheel.direction === 'CW' ? 'bg-muted/60 text-foreground font-semibold' : 'text-muted-foreground/40 hover:bg-muted/30'"
              @click="patchWheel({ direction: 'CW' })">CW</button>
            <button class="px-2 py-1 border-l border-border/50 transition-colors"
              :class="selectedChannelWheel.direction === 'CCW' ? 'bg-muted/60 text-foreground font-semibold' : 'text-muted-foreground/40 hover:bg-muted/30'"
              @click="patchWheel({ direction: 'CCW' })">CCW</button>
          </div>
        </div>

        <!-- Visual slot strip -->
        <div v-if="selectedChannelWheel.slots.length" class="flex gap-px h-8 bg-muted/20 border-b">
          <div v-for="(slot, i) in selectedChannelWheel.slots" :key="slot.slotId"
            class="flex-1 flex items-center justify-center text-[9px] font-mono text-black/50 min-w-0"
            :style="{ background: slotBg(slot) }"
            :title="`Slot ${i + 1}: ${slot.name || slot.type}`">
            {{ i + 1 }}
          </div>
        </div>

        <!-- Slot list -->
        <div class="overflow-y-auto" style="max-height: 55vh">
          <div v-if="!selectedChannelWheel.slots.length"
            class="py-6 text-center text-xs text-muted-foreground/30">No slots yet</div>

          <div v-for="(slot, i) in selectedChannelWheel.slots" :key="slot.slotId"
            class="flex items-start gap-3 px-4 py-2.5 border-b border-border/40 group hover:bg-muted/5">
            <span class="text-[10px] font-mono text-muted-foreground/30 w-4 pt-2 tabular-nums shrink-0">{{ i + 1 }}</span>
            <div class="size-7 rounded ring-1 ring-black/10 mt-1 shrink-0"
              :style="{ background: slotBg(slot) }" />
            <div class="flex-1 space-y-1.5 min-w-0">
              <div class="flex gap-2">
                <Select :model-value="slot.type"
                  @update:model-value="patchSlot(slot.slotId, { type: $event as any })">
                  <SelectTrigger class="h-7 w-20 text-xs shrink-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="t in SLOT_TYPES" :key="t" :value="t" class="text-xs">{{ t }}</SelectItem>
                  </SelectContent>
                </Select>
                <Input :model-value="slot.name"
                  @update:model-value="patchSlot(slot.slotId, { name: String($event) })"
                  :placeholder="slot.type === 'Open' ? 'Open' : slot.type === 'Color' ? 'e.g. Red' : 'e.g. Hypnotic'"
                  class="h-7 text-xs flex-1" />
              </div>
              <div v-if="slot.type === 'Color'" class="flex items-center gap-2">
                <input type="color" :value="slot.colors[0] ?? '#ffffff'"
                  @input="patchSlot(slot.slotId, { colors: slot.colors.length > 1 ? [($event.target as HTMLInputElement).value, slot.colors[1]!] : [($event.target as HTMLInputElement).value] })"
                  class="size-6 rounded cursor-pointer border border-border/50 p-0.5" />
                <span class="text-[9px] font-mono text-muted-foreground/40">{{ slot.colors[0] ?? '#ffffff' }}</span>
                <template v-if="slot.colors.length >= 2">
                  <span class="text-muted-foreground/30">/</span>
                  <input type="color" :value="slot.colors[1]"
                    @input="patchSlot(slot.slotId, { colors: [slot.colors[0] ?? '#ffffff', ($event.target as HTMLInputElement).value] })"
                    class="size-6 rounded cursor-pointer border border-border/50 p-0.5" />
                  <button class="text-[9px] text-muted-foreground/30 hover:text-destructive"
                    @click="patchSlot(slot.slotId, { colors: [slot.colors[0] ?? '#ffffff'] })">✕</button>
                </template>
                <button v-else class="text-[9px] text-muted-foreground/30 hover:text-foreground transition-colors"
                  @click="patchSlot(slot.slotId, { colors: [slot.colors[0] ?? '#ffffff', '#000000'] })">
                  + split
                </button>
              </div>
            </div>
            <button class="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/30 hover:text-destructive mt-1.5 shrink-0"
              @click="deleteSlot(slot.slotId)">
              <Trash2 class="size-3.5" />
            </button>
          </div>

          <div class="p-3">
            <button
              class="w-full flex items-center justify-center gap-1.5 py-2 rounded border border-dashed border-border/50 hover:border-primary/50 hover:bg-primary/5 text-xs text-muted-foreground/50 hover:text-foreground transition-colors"
              @click="addSlot">
              <Plus class="size-3.5" /> Add slot
            </button>
          </div>
        </div>
      </template>
    </DialogContent>
  </Dialog>

</template>
