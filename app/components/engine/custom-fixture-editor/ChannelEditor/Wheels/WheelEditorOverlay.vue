<script setup lang="ts">
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, X } from 'lucide-vue-next';
import {
  type WheelDraft,
  type WheelSlotDraft,
} from '~/utils/engine/custom-fixture-types';

const props = defineProps<{
  open: boolean;
  wheel: WheelDraft;
}>();

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void;
  (e: 'update:wheel', val: Partial<WheelDraft>): void;
}>();

const SLOT_TYPES = ['Open', 'Color', 'Gobo', 'Prism', 'Frost', 'Iris'] as const;

function patchWheel(patch: Partial<WheelDraft>) {
  emit('update:wheel', { ...props.wheel, ...patch });
}

function addSlot() {
  const slot: WheelSlotDraft = { slotId: crypto.randomUUID(), type: 'Color', name: '', colors: ['#ffffff'] };
  patchWheel({ slots: [...props.wheel.slots, slot] });
}

function deleteSlot(slotId: string) {
  patchWheel({ slots: props.wheel.slots.filter(s => s.slotId !== slotId) });
}

function patchSlot(slotId: string, patch: Partial<WheelSlotDraft>) {
  patchWheel({ slots: props.wheel.slots.map(s => s.slotId === slotId ? { ...s, ...patch } : s) });
}

function slotBg(slot: WheelSlotDraft): string {
  if (slot.type === 'Color') {
    if (slot.colors.length >= 2) return `linear-gradient(135deg, ${slot.colors[0]} 50%, ${slot.colors[1]} 50%)`;
    return slot.colors[0] ?? '#ffffff';
  }
  const fallback: Record<string, string> = { Open: '#1e293b', Gobo: '#78716c', Prism: '#a78bfa', Frost: '#bfdbfe', Iris: '#94a3b8' };
  return fallback[slot.type] ?? '#64748b';
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-2xl h-[80vh] flex flex-col p-0 overflow-hidden bg-background border shadow-2xl">
      <div class="px-6 py-4 border-b shrink-0 flex items-center justify-between">
        <h3 class="font-bold flex items-center gap-2">Edit Wheel: {{ wheel.name }}</h3>
        <Button variant="ghost" size="sm" @click="emit('update:open', false)"><X class="size-4" /></Button>
      </div>
      
      <div class="flex-1 overflow-y-auto p-6 space-y-4">
        <div v-for="(slot, si) in wheel.slots" :key="slot.slotId" class="flex items-start gap-4 p-4 rounded-lg bg-muted/20 border border-border/40 relative group">
          <div class="size-12 rounded-full border border-white/10 shrink-0 shadow-inner" :style="{ background: slotBg(slot) }" />
          
          <div class="flex-1 grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <p class="text-[10px] uppercase font-bold text-muted-foreground/50 px-1">Type</p>
              <Select :model-value="slot.type" @update:model-value="patchSlot(slot.slotId, { type: $event as any, colors: $event === 'Color' ? ['#ffffff'] : [] })">
                <SelectTrigger class="h-8 text-xs font-medium"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="t in SLOT_TYPES" :key="t" :value="t" class="text-xs">{{ t }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div class="space-y-1">
              <p class="text-[10px] uppercase font-bold text-muted-foreground/50 px-1">Name</p>
              <Input :model-value="slot.name" @update:model-value="patchSlot(slot.slotId, { name: String($event) })" placeholder="Slot name" class="h-8 text-xs" />
            </div>

            <div v-if="slot.type === 'Color'" class="col-span-2 flex items-center gap-2">
              <div v-for="(c, ci) in slot.colors" :key="ci" class="flex items-center gap-1.5 bg-background p-1 rounded border border-border/40">
                <input type="color" :value="c" @input="patchSlot(slot.slotId, { colors: slot.colors.map((v, i) => i === ci ? ($event.target as HTMLInputElement).value : v) })" class="size-5 border-none bg-transparent cursor-pointer" />
                <button v-if="slot.colors.length > 1" class="text-muted-foreground/30 hover:text-destructive" @click="patchSlot(slot.slotId, { colors: slot.colors.filter((_, i) => i !== ci) })"><X class="size-3" /></button>
              </div>
              <Button v-if="slot.colors.length < 2" variant="outline" size="sm" class="h-7 text-[10px] gap-1" @click="patchSlot(slot.slotId, { colors: [...slot.colors, '#ffffff'] })"><Plus class="size-3" /> Split Color</Button>
            </div>
          </div>
          
          <button class="text-muted-foreground/20 hover:text-destructive transition-colors ml-4" @click="deleteSlot(slot.slotId)"><Trash2 class="size-4" /></button>
        </div>
      </div>
      
      <div class="p-4 border-t bg-muted/10 shrink-0 flex justify-between">
        <Button variant="outline" class="gap-2 h-9" @click="addSlot"><Plus class="size-4" /> Add Slot</Button>
        <Button class="h-9 px-8" @click="emit('update:open', false)">Done</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
