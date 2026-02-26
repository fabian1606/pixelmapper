<script setup lang="ts">
import { ref, watch } from 'vue';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Loader2, Plus, X } from 'lucide-vue-next';
import FixtureLibraryBrowser from './FixtureLibraryBrowser.vue';
import type { FixtureSummary, OflFixture } from '~/utils/ofl/types';
import { createFixtureFromOfl } from '~/utils/ofl/fixture-factory';
import type { Fixture } from '~/utils/engine/core/fixture';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void;
  (e: 'add', fixtures: Fixture[]): void;
}>();

// ─── State ────────────────────────────────────────────────────────────────────

const selectedSummary = ref<FixtureSummary | null>(null);
const fullFixtureData = ref<OflFixture | null>(null);
const loadingDetails = ref(false);

const config = ref({
  modeIndex: '0', 
  universe: 1,
  address: 1,
  amount: 1,
});

// ─── Actions ──────────────────────────────────────────────────────────────────

async function handleSelect(summary: FixtureSummary) {
  selectedSummary.value = summary;
  loadingDetails.value = true;
  fullFixtureData.value = null;
  config.value.modeIndex = '0';

  try {
    const [mf, fix] = summary.key.split('/');
    const data = await $fetch<OflFixture>(`/api/fixtures/${mf}/${fix}`);
    fullFixtureData.value = data;
    
    // Auto-select first mode
    if (data.modes.length > 0) {
      config.value.modeIndex = '0';
    }
  } catch (err) {
    console.error('Failed to load fixture details:', err);
  } finally {
    loadingDetails.value = false;
  }
}

function handleAdd() {
  if (!fullFixtureData.value) return;

  const modeIdx = parseInt(config.value.modeIndex, 10);
  const selectedMode = fullFixtureData.value.modes[modeIdx];
  if (!selectedMode) return;

  // Calculate footprint for auto-addressing
  // We use the length of the channels array in the mode
  const channelCount = selectedMode.channels.length;
  
  let currentAddress = config.value.address;
  const count = Math.max(1, Math.min(config.value.amount, 50)); // Cap to 50 for safety

  const fixtures: Fixture[] = [];
  for (let i = 0; i < count; i++) {
    const fixture = createFixtureFromOfl(
      fullFixtureData.value, 
      modeIdx
    );
    
    // Tag with DMX info
    (fixture as any).dmxConfig = {
      universe: config.value.universe,
      address: currentAddress
    };

    // If adding multiple, uniquely name them if they don't have a unique name already
    if (count > 1) {
      fixture.name = `${fixture.name} ${i + 1}`;
    }
    
    fixtures.push(fixture);

    // Increment address for the next fixture
    currentAddress += channelCount;

    // Safety: break if we exceed DMX universe
    if (currentAddress > 512) {
      console.warn('Stopping auto-add: reached end of DMX universe (512)');
      break;
    }
  }
  
  emit('add', fixtures);
  
  emit('update:open', false);
  resetState();
}

function resetState() {
  selectedSummary.value = null;
  fullFixtureData.value = null;
  config.value = {
    modeIndex: '0',
    universe: 1,
    address: 1,
    amount: 1,
  };
}

// Reset when dialog closes
watch(() => props.open, (isOpen) => {
  if (!isOpen) {
    resetState();
  }
});
</script>

<template>
  <Dialog :open="open" @update:open="val => emit('update:open', val)">
    <DialogContent class="sm:max-w-[850px] p-0 overflow-hidden bg-background border-none shadow-2xl">
      <div class="flex flex-col h-[85vh]">
        <!-- Unified Header & Browser Section -->
        <div class="flex-1 flex flex-col min-h-0 bg-muted/20">
          <div class="px-6 py-5 flex items-center justify-between">
            <div>
              <DialogTitle class="text-lg font-bold tracking-tight">Add New Fixture</DialogTitle>
            </div>
          </div>

          <!-- Browser Component sits flush -->
          <FixtureLibraryBrowser
            class="flex-1"
            :selected-key="selectedSummary?.key"
            @select="handleSelect"
          />
        </div>

        <!-- Unified Configuration & Footer Section -->
        <div 
          class="shrink-0 bg-muted/30 border-t transition-all duration-500 overflow-hidden"
          :class="selectedSummary ? 'max-h-[300px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'"
        >
          <div class="px-6 py-6 flex flex-col gap-6">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-sm font-semibold flex items-center gap-2 text-foreground">
                   {{ selectedSummary?.manufacturer }} -{{ selectedSummary?.name }}
                </h3>
              </div>
              
              <div v-if="loadingDetails" class="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 class="size-3 animate-spin text-primary" />
                Fetching mode data...
              </div>
            </div>

            <div class="grid grid-cols-14 gap-6 items-end">
              <!-- Mode Selection -->
              <div class="col-span-12 md:col-span-4 space-y-2.5">
                <Label class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">DMX Mode</Label>
                <Select 
                  v-model="config.modeIndex" 
                  :disabled="!fullFixtureData"
                >
                  <SelectTrigger class="h-10 bg-background border-border">
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem 
                      v-for="(mode, idx) in fullFixtureData?.modes" 
                      :key="idx" 
                      :value="String(idx)"
                      class="text-xs"
                    >
                      {{ mode.name }} <span class="ml-2 opacity-50">({{ mode.channels.length }}ch)</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <!-- DMX Configuration -->
              <div class="col-span-4 md:col-span-2 space-y-2.5">
                <Label class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Universe</Label>
                <Input 
                  v-model.number="config.universe" 
                  type="number" 
                  min="1" 
                  class="h-10 bg-background w-20"
                />
              </div>

              <div class="col-span-4 md:col-span-2 space-y-2.5">
                <Label class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Address</Label>
                <Input 
                  v-model.number="config.address" 
                  type="number" 
                  min="1" 
                  max="512" 
                  class="h-10 bg-background w-20"
                />
              </div>

              <div class="col-span-4 md:col-span-2 space-y-2.5">
                <Label class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Amount</Label>
                <Input 
                  v-model.number="config.amount" 
                  type="number" 
                  min="1" 
                  max="50"
                  class="h-10 bg-background w-20"
                />
              </div>

              <!-- Actions -->
              <div class="col-span-12 md:col-span-3.5 flex items-center justify-end gap-3 pb-0.5 ml-auto">
                <Button 
                  :disabled="!fullFixtureData" 
                  @click="handleAdd"
                  class="px-6 h-10 font-bold tracking-tight shadow-lg shadow-primary/20"
                >
                  <Plus class="size-4 mr-2" />
                  Add {{ config.amount }} Fixture{{ config.amount > 1 ? 's' : '' }}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.max-h-0 {
  visibility: hidden;
}
.max-h-\[300px\] {
  visibility: visible;
}

/* Fix for fractional grid columns in some browsers if needed, but standard span is safer */
.col-span-1\.5 {
  grid-column: span 2 / span 2;
}
.col-span-3\.5 {
  grid-column: span 4 / span 4;
}

@media (min-width: 768px) {
  .md\:col-span-1\.5 {
    grid-column: span 1 / span 1;
  }
  .md\:col-span-3\.5 {
    grid-column: span 4 / span 4;
  }
}
</style>
