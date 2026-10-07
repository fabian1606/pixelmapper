<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-vue-next';
import type { EnrichmentProposal } from '~/composables/engine/useAiFixtureEnrichment';

const props = defineProps<{
  open: boolean;
  isEnriching: boolean;
  status: string;
  error: string;
  proposals: EnrichmentProposal[];
}>();

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void;
  (e: 'apply', accepted: EnrichmentProposal[]): void;
}>();

const accepted = ref<Set<number>>(new Set());

watch(() => props.proposals, (list) => {
  accepted.value = new Set(list.map((_, i) => i));
}, { immediate: true });

function toggle(i: number) {
  if (accepted.value.has(i)) accepted.value.delete(i);
  else accepted.value.add(i);
  accepted.value = new Set(accepted.value);
}

function summaryFor(p: EnrichmentProposal): string {
  if (p.kind === 'shutter') return `"${p.channelName}": ${p.shutterEffect} at DMX ${p.dmxMin}-${p.dmxMax}${p.speed ? ` (${p.speed})` : ''}`;
  if (p.kind === 'wheelSlotColor') return `"${p.wheelName}" slot ${p.slotNumber}: ${p.slotType}${p.colors?.length ? ` (${p.colors.join(', ')})` : ''}`;
  return `"${p.channelName}" dimmer range: DMX ${p.dmxMin}-${p.dmxMax}`;
}

const hasProposals = computed(() => props.proposals.length > 0);

function handleApply() {
  emit('apply', props.proposals.filter((_, i) => accepted.value.has(i)));
  emit('update:open', false);
}
</script>

<template>
  <Dialog :open="open" @update:open="val => emit('update:open', val)">
    <DialogContent class="!max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle>AI Manual Comparison</DialogTitle>
      </DialogHeader>

      <div v-if="isEnriching" class="flex flex-col items-center justify-center gap-4 py-12">
        <Loader2 class="size-8 animate-spin text-primary" />
        <div class="text-sm text-muted-foreground">{{ status }}</div>
      </div>

      <div v-else-if="error" class="py-8 text-center text-sm text-destructive">{{ error }}</div>

      <div v-else-if="!hasProposals" class="py-8 text-center text-sm text-muted-foreground">
        No corrections found — the current definition already matches the manual.
      </div>

      <div v-else class="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0">
        <p class="text-sm text-muted-foreground mb-2">
          Review each proposed correction to shutter, dimmer, or color wheel behavior before applying.
        </p>
        <label
          v-for="(p, i) in proposals"
          :key="i"
          class="flex items-start gap-3 p-3 rounded-md border border-border hover:bg-muted/40 cursor-pointer"
        >
          <input
            type="checkbox"
            :checked="accepted.has(i)"
            class="mt-1 size-4 accent-primary"
            @change="toggle(i)"
          />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium">{{ summaryFor(p) }}</div>
            <div class="text-xs text-muted-foreground mt-0.5">{{ p.reason }}</div>
          </div>
        </label>
      </div>

      <div v-if="!isEnriching" class="flex justify-end gap-2 pt-4 border-t border-border">
        <Button variant="ghost" @click="emit('update:open', false)">Cancel</Button>
        <Button v-if="hasProposals" @click="handleApply">Apply {{ accepted.size }} Change{{ accepted.size === 1 ? '' : 's' }}</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
