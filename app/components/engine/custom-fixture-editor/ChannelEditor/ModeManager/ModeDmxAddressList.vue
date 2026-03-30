<script setup lang="ts">
import { 
  Plus, Trash2, GripVertical, ChevronDown, ChevronRight, ArrowLeftRight 
} from 'lucide-vue-next';
import {
  modeAddressCount,
  type ModeEntry,
  type ChannelDraft,
  type ModeDraft,
} from '~/utils/engine/custom-fixture-types';
import { ref } from 'vue';

const props = defineProps<{
  mode: ModeDraft;
  channels: ChannelDraft[];
  headCount: number;
  entryStartAddress: (idx: number) => number;
  addrOf: (id: string) => number;
}>();

const emit = defineEmits<{
  (e: 'removeEntry', entryId: string): void;
  (e: 'patchEntry', entryId: string, patch: Partial<ModeEntry>): void;
  (e: 'reorder', from: number, to: number): void;
}>();

const expandedGroups = ref(new Set<string>());
const dragFromIdx = ref<number | null>(null);
const dragOverIdx = ref<number | null>(null);

const channelMap = () => new Map(props.channels.map(c => [c.id, c]));
const ch = (id: string) => channelMap().get(id) ?? null;

function toggleGroup(idx: number) {
  const g = groupEntries(idx);
  const key = g[0]?.entry.entryId;
  if (!key) return;
  const next = new Set(expandedGroups.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  expandedGroups.value = next;
}

function groupEntries(idx: number): { entry: ModeEntry; idx: number }[] {
  const entries = props.mode.entries;
  let start = idx;
  while (start > 0 && entries[start - 1]?.perHead) start--;
  const result: { entry: ModeEntry; idx: number }[] = [];
  let i = start;
  while (i < entries.length && entries[i]?.perHead) {
    result.push({ entry: entries[i]!, idx: i });
    i++;
  }
  return result;
}

function previewAddr(groupLastIdx: number, chInGroupIdx: number, headNum: number): number {
  const group = groupEntries(groupLastIdx);
  if (!group.length) return 0;
  const baseAddr = props.entryStartAddress(group[0]!.idx);
  const order = group[0]!.entry.order ?? 'perPixel';
  if (order === 'perPixel') {
    const groupSize = group.reduce((s, g) => s + props.addrOf(g.entry.channelId), 0);
    let offsetInGroup = 0;
    for (let j = 0; j < chInGroupIdx; j++) offsetInGroup += props.addrOf(group[j]!.entry.channelId);
    return baseAddr + (headNum - 1) * groupSize + offsetInGroup;
  } else {
    let offset = 0;
    for (let j = 0; j < chInGroupIdx; j++) offset += props.addrOf(group[j]!.entry.channelId) * props.headCount;
    return baseAddr + offset + (headNum - 1) * props.addrOf(group[chInGroupIdx]!.entry.channelId);
  }
}

function onDrop(toIdx: number) {
  if (dragFromIdx.value !== null && dragFromIdx.value !== toIdx) emit('reorder', dragFromIdx.value, toIdx);
  dragFromIdx.value = null; dragOverIdx.value = null;
}
</script>

<template>
  <div class="flex-1 overflow-y-auto min-h-0 bg-muted/5">
    <div v-if="mode.entries.length === 0" class="h-full flex flex-col items-center justify-center p-8 gap-3 text-muted-foreground/30 bg-muted/5">
      <div class="size-10 rounded-full border-2 border-dashed border-current flex items-center justify-center opacity-20"><Plus class="size-5" /></div>
      <p class="text-[11px] text-center max-w-[140px] leading-relaxed">Add channels from the pool to build your mapping.</p>
    </div>
    
    <div v-for="(e, i) in mode.entries" :key="e.entryId" class="group/row" :class="dragOverIdx === i ? 'border-t-2 border-primary' : ''" draggable="true" @dragstart="dragFromIdx = i" @dragover.prevent="dragOverIdx = i" @drop="onDrop(i)" @dragend="dragFromIdx = null; dragOverIdx = null">
      <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 bg-background transition-colors" :class="e.perHead ? 'bg-indigo-500/5' : ''">
        <GripVertical class="size-3 text-muted-foreground/20 cursor-grab active:cursor-grabbing opacity-0 group-hover/row:opacity-100" />
        <span class="text-[10px] font-mono text-muted-foreground/60 w-6 text-right">{{ entryStartAddress(i) }}</span>
        <div class="flex-1 min-w-0 flex items-center gap-2">
          <span class="text-[11px] font-medium truncate">{{ ch(e.channelId)?.name }}</span>
          <span class="text-[9px] text-muted-foreground/40 font-mono">{{ ch(e.channelId)?.resolution }}</span>
        </div>
        
        <button class="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] border border-border/50 transition-colors" :class="e.perHead ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/40' : 'text-muted-foreground/40 hover:text-foreground'" @click="emit('patchEntry', e.entryId, { perHead: !e.perHead })">{{ e.perHead ? 'Per Head' : 'Global' }}</button>
        <button class="text-muted-foreground/20 hover:text-destructive p-1 opacity-0 group-hover/row:opacity-100" @click="emit('removeEntry', e.entryId)"><Trash2 class="size-3.5" /></button>
      </div>

      <!-- Per-head groups expansion / addressing options -->
      <div v-if="e.perHead && (i === mode.entries.length - 1 || !mode.entries[i+1]?.perHead)" class="bg-muted/10 border-b border-border/40 p-2 space-y-1">
        <div class="flex items-center gap-2 px-6">
          <div class="flex items-center gap-1 bg-background/50 border border-border/50 rounded p-0.5">
            <button v-for="opt in ['perPixel', 'perChannel']" :key="opt" class="px-2 py-0.5 rounded text-[9px] transition-colors" :class="(e.order ?? 'perPixel') === opt ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'" @click="emit('patchEntry', e.entryId, { order: opt as any })">{{ opt === 'perPixel' ? 'R...G...B...' : 'RRR...GGG...' }}</button>
          </div>
          <button class="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground" @click="toggleGroup(i)">
            {{ expandedGroups.has(groupEntries(i)[0]?.entry.entryId || '') ? 'Hide Addressing' : 'Preview Addressing' }}
            <ChevronDown v-if="expandedGroups.has(groupEntries(i)[0]?.entry.entryId || '')" class="size-3" />
            <ChevronRight v-else class="size-3" />
          </button>
        </div>
        
        <div v-if="expandedGroups.has(groupEntries(i)[0]?.entry.entryId || '')" class="mt-2 space-y-px overflow-x-auto no-scrollbar px-6 pb-2">
          <div v-for="h in Math.min(headCount, 8)" :key="h" class="flex gap-1">
            <span class="text-[9px] w-10 text-muted-foreground/40 shrink-0">Head {{ h }}</span>
            <div v-for="(ge, gi) in groupEntries(i)" :key="gi" class="text-[10px] font-mono text-muted-foreground/60 bg-muted/20 px-1 rounded">{{ previewAddr(i, gi, h) }}</div>
          </div>
          <p v-if="headCount > 8" class="text-[9px] text-muted-foreground/30 pt-1 italic">... and {{ headCount - 8 }} more heads</p>
        </div>
      </div>
    </div>
  </div>
</template>
