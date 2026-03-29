<script setup lang="ts">
import { ref, computed } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, RotateCw } from 'lucide-vue-next';
import {
  CHANNEL_CAPABILITY_META,
  type ChannelDraft,
  type WheelDraft,
  type WheelSlotDraft,
} from '~/utils/engine/custom-fixture-types';

const props = defineProps<{
  wheels: WheelDraft[];
  channels: ChannelDraft[];
}>();

const emit = defineEmits<{
  (e: 'update:wheels', value: WheelDraft[]): void;
  (e: 'next'): void;
}>();

// ─── Wheel selection ──────────────────────────────────────────────────────────

const selectedWheelId = ref<string | null>(props.wheels[0]?.wheelId ?? null);
const selectedWheel = computed(() => props.wheels.find(w => w.wheelId === selectedWheelId.value) ?? null);

const channelOf = (channelId: string) => props.channels.find(c => c.id === channelId) ?? null;

// ─── Wheel mutations ──────────────────────────────────────────────────────────

function patchWheel(wheelId: string, patch: Partial<WheelDraft>) {
  emit('update:wheels', props.wheels.map(w => w.wheelId === wheelId ? { ...w, ...patch } : w));
}

// ─── Slot mutations ───────────────────────────────────────────────────────────

function addSlot() {
  if (!selectedWheel.value) return;
  const slot: WheelSlotDraft = {
    slotId: crypto.randomUUID(),
    type: 'Color',
    name: '',
    colors: ['#ffffff'],
  };
  patchWheel(selectedWheel.value.wheelId, { slots: [...selectedWheel.value.slots, slot] });
}

function deleteSlot(slotId: string) {
  if (!selectedWheel.value) return;
  patchWheel(selectedWheel.value.wheelId, {
    slots: selectedWheel.value.slots.filter(s => s.slotId !== slotId),
  });
}

function patchSlot(slotId: string, patch: Partial<WheelSlotDraft>) {
  if (!selectedWheel.value) return;
  patchWheel(selectedWheel.value.wheelId, {
    slots: selectedWheel.value.slots.map(s => s.slotId === slotId ? { ...s, ...patch } : s),
  });
}

function setSlotColor(slotId: string, hex: string) {
  if (!selectedWheel.value) return;
  const slot = selectedWheel.value.slots.find(s => s.slotId === slotId);
  if (!slot) return;
  patchSlot(slotId, { colors: slot.colors.length > 1 ? [hex, slot.colors[1]!] : [hex] });
}

function setSlotColor2(slotId: string, hex: string) {
  if (!selectedWheel.value) return;
  const slot = selectedWheel.value.slots.find(s => s.slotId === slotId);
  if (!slot) return;
  patchSlot(slotId, { colors: [slot.colors[0] ?? '#ffffff', hex] });
}

function addSecondColor(slotId: string) {
  const slot = selectedWheel.value?.slots.find(s => s.slotId === slotId);
  if (!slot) return;
  patchSlot(slotId, { colors: [slot.colors[0] ?? '#ffffff', '#000000'] });
}

function removeSecondColor(slotId: string) {
  const slot = selectedWheel.value?.slots.find(s => s.slotId === slotId);
  if (!slot) return;
  patchSlot(slotId, { colors: [slot.colors[0] ?? '#ffffff'] });
}

// ─── Slot type options ────────────────────────────────────────────────────────

const SLOT_TYPES = ['Open', 'Color', 'Gobo', 'Prism', 'Frost', 'Iris'] as const;

const SLOT_TYPE_COLOR: Record<string, string> = {
  Open:  '#e2e8f0',
  Color: '#ffffff',
  Gobo:  '#78716c',
  Prism: '#a78bfa',
  Frost: '#bfdbfe',
  Iris:  '#94a3b8',
};

function slotDisplayColor(slot: WheelSlotDraft): string {
  if (slot.type === 'Color' && slot.colors[0]) return slot.colors[0];
  return SLOT_TYPE_COLOR[slot.type] ?? '#64748b';
}
</script>

<template>
  <div class="flex flex-1 min-h-0 min-w-0">

    <!-- ── Left: Wheel list ───────────────────────────────────────────────── -->
    <div class="w-56 border-r flex flex-col min-h-0 shrink-0">
      <div class="border-b bg-muted/10 shrink-0 px-3 py-2">
        <p class="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/60">Wheels</p>
      </div>
      <div class="flex-1 overflow-y-auto min-h-0">
        <div
          v-for="wheel in wheels" :key="wheel.wheelId"
          class="flex items-center gap-2.5 px-3 py-2.5 border-b border-border/40 cursor-pointer hover:bg-muted/20 transition-colors"
          :class="selectedWheelId === wheel.wheelId
            ? 'bg-muted/30 border-l-2 border-l-primary'
            : 'border-l-2 border-l-transparent'"
          @click="selectedWheelId = wheel.wheelId"
        >
          <!-- Channel color dot -->
          <span v-if="channelOf(wheel.channelId)" class="size-2.5 rounded-full shrink-0 ring-1 ring-black/10"
            :style="{ backgroundColor: CHANNEL_CAPABILITY_META[channelOf(wheel.channelId)!.capabilityType].color }" />
          <div class="flex-1 min-w-0">
            <p class="text-xs font-medium truncate">{{ wheel.name }}</p>
            <p class="text-[9px] text-muted-foreground/40">{{ wheel.slots.length }} slots</p>
          </div>
          <RotateCw v-if="wheel.direction" class="size-3 text-muted-foreground/30 shrink-0" />
        </div>
        <div v-if="wheels.length === 0"
          class="flex items-center justify-center py-8 text-xs text-muted-foreground/30 text-center px-4">
          No wheel channels defined in step 2
        </div>
      </div>
    </div>

    <!-- ── Main: Slot editor ─────────────────────────────────────────────── -->
    <div class="flex-1 flex flex-col min-h-0 min-w-0 relative">

      <template v-if="selectedWheel">
        <!-- Wheel header -->
        <div class="shrink-0 border-b bg-muted/10 px-4 py-2 flex items-center gap-3">
          <Input
            :model-value="selectedWheel.name"
            @update:model-value="patchWheel(selectedWheel!.wheelId, { name: String($event) })"
            class="h-8 text-sm max-w-[14rem]"
          />
          <!-- Direction toggle -->
          <div class="flex items-center gap-0 rounded overflow-hidden border border-border/50 h-7 text-[10px] shrink-0">
            <button
              class="px-2.5 h-full transition-colors"
              :class="!selectedWheel.direction ? 'bg-muted/60 text-foreground font-semibold' : 'text-muted-foreground/40 hover:bg-muted/30'"
              @click="patchWheel(selectedWheel!.wheelId, { direction: undefined })">—</button>
            <button
              class="px-2.5 h-full border-l border-border/50 transition-colors"
              :class="selectedWheel.direction === 'CW' ? 'bg-muted/60 text-foreground font-semibold' : 'text-muted-foreground/40 hover:bg-muted/30'"
              @click="patchWheel(selectedWheel!.wheelId, { direction: 'CW' })">CW</button>
            <button
              class="px-2.5 h-full border-l border-border/50 transition-colors"
              :class="selectedWheel.direction === 'CCW' ? 'bg-muted/60 text-foreground font-semibold' : 'text-muted-foreground/40 hover:bg-muted/30'"
              @click="patchWheel(selectedWheel!.wheelId, { direction: 'CCW' })">CCW</button>
          </div>
          <span class="text-[9px] text-muted-foreground/40 ml-auto">{{ selectedWheel.slots.length }} slots</span>
        </div>

        <!-- Visual slot strip -->
        <div v-if="selectedWheel.slots.length > 0" class="shrink-0 border-b px-4 py-2 flex gap-1 items-center bg-muted/5">
          <div
            v-for="(slot, i) in selectedWheel.slots" :key="slot.slotId"
            class="h-7 rounded flex items-center justify-center text-[9px] font-mono text-black/60 shrink-0 ring-1 ring-black/10 transition-all"
            :style="{
              width: `${Math.max(28, 256 / Math.max(selectedWheel.slots.length, 1))}px`,
              background: slot.colors.length === 2
                ? `linear-gradient(135deg, ${slot.colors[0]} 50%, ${slot.colors[1]} 50%)`
                : slotDisplayColor(slot),
            }"
            :title="`Slot ${i + 1}: ${slot.name || slot.type}`"
          >{{ i + 1 }}</div>
        </div>

        <!-- Slot list -->
        <div class="flex-1 overflow-y-auto pb-16">
          <div v-if="selectedWheel.slots.length === 0"
            class="flex items-center justify-center h-32 text-xs text-muted-foreground/30">
            No slots yet — add the first one below
          </div>

          <div
            v-for="(slot, i) in selectedWheel.slots" :key="slot.slotId"
            class="flex items-start gap-3 px-4 py-3 border-b border-border/40 group hover:bg-muted/5 transition-colors"
          >
            <!-- Slot number -->
            <span class="text-[10px] font-mono text-muted-foreground/30 w-5 pt-1.5 text-right shrink-0 tabular-nums">{{ i + 1 }}</span>

            <!-- Color swatch / type indicator -->
            <div class="size-8 rounded shrink-0 ring-1 ring-black/10 mt-0.5"
              :style="{
                background: slot.colors.length === 2
                  ? `linear-gradient(135deg, ${slot.colors[0]} 50%, ${slot.colors[1]} 50%)`
                  : slotDisplayColor(slot),
              }" />

            <!-- Slot fields -->
            <div class="flex-1 space-y-1.5 min-w-0">
              <div class="flex items-center gap-2">
                <!-- Type -->
                <Select :model-value="slot.type"
                  @update:model-value="patchSlot(slot.slotId, { type: $event as any })">
                  <SelectTrigger class="h-7 w-24 text-xs shrink-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="t in SLOT_TYPES" :key="t" :value="t" class="text-xs">{{ t }}</SelectItem>
                  </SelectContent>
                </Select>
                <!-- Name -->
                <Input :model-value="slot.name"
                  @update:model-value="patchSlot(slot.slotId, { name: String($event) })"
                  :placeholder="slot.type === 'Open' ? 'Open' : slot.type === 'Color' ? 'e.g. Red' : 'e.g. Hypnotic'"
                  class="h-7 text-xs flex-1" />
              </div>

              <!-- Color inputs (only for Color slots) -->
              <div v-if="slot.type === 'Color'" class="flex items-center gap-2">
                <div class="flex items-center gap-1.5">
                  <input type="color" :value="slot.colors[0] ?? '#ffffff'"
                    @input="setSlotColor(slot.slotId, ($event.target as HTMLInputElement).value)"
                    class="size-6 rounded cursor-pointer border border-border/50 bg-transparent p-0.5" />
                  <span class="text-[9px] font-mono text-muted-foreground/50">{{ slot.colors[0] ?? '#ffffff' }}</span>
                </div>
                <template v-if="slot.colors.length >= 2">
                  <span class="text-muted-foreground/30 text-xs">/</span>
                  <div class="flex items-center gap-1.5">
                    <input type="color" :value="slot.colors[1] ?? '#000000'"
                      @input="setSlotColor2(slot.slotId, ($event.target as HTMLInputElement).value)"
                      class="size-6 rounded cursor-pointer border border-border/50 bg-transparent p-0.5" />
                    <span class="text-[9px] font-mono text-muted-foreground/50">{{ slot.colors[1] }}</span>
                    <button class="text-muted-foreground/30 hover:text-destructive text-[9px] transition-colors"
                      @click="removeSecondColor(slot.slotId)">✕</button>
                  </div>
                </template>
                <button v-else
                  class="text-[9px] text-muted-foreground/30 hover:text-foreground transition-colors"
                  @click="addSecondColor(slot.slotId)">+ split color</button>
              </div>
            </div>

            <!-- Delete -->
            <button class="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/30 hover:text-destructive mt-1.5 shrink-0"
              @click="deleteSlot(slot.slotId)">
              <Trash2 class="size-3.5" />
            </button>
          </div>

          <!-- Add slot -->
          <div class="px-4 py-3">
            <button
              class="w-full flex items-center justify-center gap-1.5 py-2 rounded border border-dashed border-border/50 hover:border-primary/50 hover:bg-primary/5 text-xs text-muted-foreground/50 hover:text-foreground transition-colors"
              @click="addSlot">
              <Plus class="size-3.5" /> Add slot
            </button>
          </div>
        </div>
      </template>

      <div v-else class="flex items-center justify-center flex-1 text-sm text-muted-foreground/30">
        Select a wheel on the left
      </div>

      <!-- Floating Next button -->
      <div class="absolute bottom-4 right-4">
        <Button class="gap-2 h-9 shadow-lg" @click="emit('next')">
          Next →
        </Button>
      </div>
    </div>

  </div>
</template>
