<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, ArrowRight } from 'lucide-vue-next';
import { WHEEL_CAPABILITY_TYPES, type ChannelDraft, type ModeDraft, type WheelDraft } from '~/utils/engine/custom-fixture-types';

import ChannelList from './ChannelList.vue';
import ChannelDetailsEditor from './ChannelDetailsEditor.vue';
import CapabilityRangeList from './CapabilityRanges/CapabilityRangeList.vue';
import WheelEditorOverlay from './Wheels/WheelEditorOverlay.vue';
import ModeTabs from './ModeManager/ModeTabs.vue';
import ModeDmxAddressList from './ModeManager/ModeDmxAddressList.vue';

import { useChannelManagement } from './useChannelManagement';
import { useCapabilityRanges } from './useCapabilityRanges';
import { useModeManagement } from './useModeManagement';

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

// --- Local Sync helpers ---
const channelsArr = computed({ get: () => props.channels, set: (v) => emit('update:channels', v) });
const modesArr = computed({ get: () => props.modes, set: (v) => emit('update:modes', v) });
const selectedId = computed({ get: () => props.selectedChannelId, set: (v) => emit('update:selectedChannelId', v) });
const wheelsArr = computed({ get: () => props.wheels, set: (v) => emit('update:wheels', v) });

const activeModeIdx = ref(0);
const wheelOverlayOpen = ref(false);

const { addChannel, deleteChannel, patchChannel, changeChannelType } = useChannelManagement(channelsArr, modesArr, selectedId);
const { addCapabilityRange, removeCapabilityRange, patchRange, onRangeMaxChange } = useCapabilityRanges(channelsArr, (id, p) => patchChannel(id, p));
const { addMode, addSingleToMode, removeEntry, patchEntry, entryStartAddress, addrOf } = useModeManagement(modesArr, activeModeIdx, channelsArr, computed(() => props.headCount));

const selectedChannel = computed(() => props.channels.find(c => c.id === props.selectedChannelId) ?? null);
const isSingleFullRange = computed(() => {
  const caps = selectedChannel.value?.capabilities ?? [];
  return caps.length === 1 && caps[0]!.dmxMin === 0 && caps[0]!.dmxMax === 255;
});
const selectedChannelWheel = computed(() =>
  selectedChannel.value && WHEEL_CAPABILITY_TYPES.has(selectedChannel.value.capabilityType)
    ? props.wheels.find(w => w.channelId === selectedChannel.value!.id) ?? null
    : null
);

function handleReorder(from: number, to: number) {
  const mode = modesArr.value[activeModeIdx.value];
  if (!mode) return;
  const entries = [...mode.entries];
  const [moved] = entries.splice(from, 1);
  if (moved) entries.splice(to, 0, moved);
  mode.entries = entries;
}
</script>

<template>
  <div class="flex flex-1 min-h-0 min-w-0">
    <!-- Col 1: Channels -->
    <ChannelList :channels="channels" :selected-channel-id="selectedChannelId" @add="addChannel" @delete="deleteChannel" @select="selectedId = $event" />

    <!-- Col 2: Details & Ranges -->
    <div class="flex-1 border-r flex flex-col min-h-0 min-w-0">
      <div class="border-b bg-muted/10 shrink-0 px-3 py-2 flex items-center justify-between">
        <p class="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/60">Edit Channel</p>
        <Button v-if="selectedChannel" size="sm" variant="ghost" class="h-6 px-2 gap-1 text-[10px] text-primary" @click="addSingleToMode(selectedChannel.id)">
          Add to Mode <ArrowRight class="size-3" />
        </Button>
      </div>
      <div class="flex-1 overflow-y-auto min-h-0">
        <template v-if="selectedChannel">
          <ChannelDetailsEditor :channel="selectedChannel" @update="patchChannel(selectedChannel!.id, $event)" @change-type="changeChannelType(selectedChannel!.id, $event, isSingleFullRange)" />
          <CapabilityRangeList :channel="selectedChannel" :is-single-full-range="isSingleFullRange" :wheel="selectedChannelWheel" @patch-range="(rid, p) => patchRange(selectedChannel!.id, rid, p)" @max-change="(rid, v) => onRangeMaxChange(selectedChannel!.id, rid, v)" @remove-range="rid => removeCapabilityRange(selectedChannel!.id, rid)" @open-wheel="wheelOverlayOpen = true" />
          <div class="p-4"><Button variant="outline" size="sm" class="w-full gap-1.5 h-8 text-xs border-dashed" @click="addCapabilityRange(selectedChannel!.id, isSingleFullRange)"><Plus class="size-3.5" /> Split DMX Range</Button></div>
        </template>
      </div>
    </div>

    <!-- Col 3: Mode Mapping -->
    <div class="flex-1 flex flex-col min-h-0 min-w-0">
      <div class="border-b bg-muted/10 shrink-0 px-3 py-2"><p class="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/60">Mode Mapping</p></div>
      <ModeTabs :modes="modes" :active-mode-idx="activeModeIdx" @update:active-mode-idx="activeModeIdx = $event" @add="addMode" @rename="(idx, name) => modesArr[idx]!.name = name" />
      <ModeDmxAddressList v-if="modes[activeModeIdx]" :mode="modes[activeModeIdx]!" :channels="channels" :head-count="headCount" :entry-start-address="entryStartAddress" :addr-of="addrOf" @remove-entry="removeEntry" @patch-entry="patchEntry" @reorder="handleReorder" />
    </div>

    <WheelEditorOverlay v-if="selectedChannelWheel" :open="wheelOverlayOpen" :wheel="selectedChannelWheel" @update:open="wheelOverlayOpen = $event" @update:wheel="patchChannel(selectedChannel!.id, {}) /* wheel sync is handled via watch in composable */" />
  </div>
</template>
