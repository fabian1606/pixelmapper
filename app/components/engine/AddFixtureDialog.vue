<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
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
import AddFixtureConfigForm from './AddFixtureConfigForm.vue';
import CustomFixtureEditorDialog from './custom-fixture-editor/CustomFixtureEditorDialog.vue';
import type { FixtureSummary, OflFixture } from '~/utils/ofl/types';
import { createFixtureFromOfl } from '~/utils/ofl/fixture-factory';
import type { Fixture } from '~/utils/engine/core/fixture';
import { useEngineStore } from '~/stores/engine-store';

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
const isCustomFixtureEditorOpen = ref(false);

const customFixtureStartWithAi = ref(false);

const engineStore = useEngineStore();

function triggerPdfUpload() {
  customFixtureStartWithAi.value = true;
  isCustomFixtureEditorOpen.value = true;
}

function handleAddCustomFixtures(fixtures: Fixture[]) {
  emit('add', fixtures);
  isCustomFixtureEditorOpen.value = false;
  customFixtureStartWithAi.value = false;
  emit('update:open', false);
}

const config = ref({
  modeIndex: '0', 
  universe: 1,
  address: 1,
  amount: 1,
});

// Calculate the footprint length of the selected mode (or 1 if none selected)
function getSelectedFootprint(): number {
  if (!fullFixtureData.value) return 1;
  const modeIdx = parseInt(config.value.modeIndex, 10);
  const selectedMode = fullFixtureData.value.modes[modeIdx];
  return selectedMode ? selectedMode.channels.length : 1;
}

// Finds the first available address block capable of fitting the requested amount of channels
function autoAssignFreeAddress() {
  const footprint = getSelectedFootprint();
  const requiredSpan = footprint * config.value.amount;

  // Extract occupied chunks from flatFixtures
  const occupiedRanges = engineStore.flatFixtures.map(f => {
    return { start: f.startAddress, end: f.startAddress + f.channels.length - 1 };
  }).sort((a, b) => a.start - b.start);

  let searchStart = 1;
  for (const range of occupiedRanges) {
    if (searchStart + requiredSpan - 1 < range.start) {
      break; // Found a large enough gap!
    }
    searchStart = Math.max(searchStart, range.end + 1);
  }

  // searchStart is an absolute address. Convert back to Universe & local address
  config.value.universe = Math.floor((searchStart - 1) / 512) + 1;
  config.value.address = ((searchStart - 1) % 512) + 1;
}

watch(() => config.value.amount, () => autoAssignFreeAddress());
watch(() => config.value.modeIndex, () => autoAssignFreeAddress());

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
    // Set auto-assigned address natively
    autoAssignFreeAddress();
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
  
  let currentLocalAddress = config.value.address;
  let currentUniverse = config.value.universe;
  const count = Math.max(1, Math.min(config.value.amount, 50)); // Cap to 50 for safety

  const fixtures: Fixture[] = [];
  for (let i = 0; i < count; i++) {
    const fixture = createFixtureFromOfl(
      fullFixtureData.value, 
      modeIdx,
      undefined,
      selectedSummary.value?.manufacturer
    );
    
    // Compute absolute address across dynamic universes
    fixture.startAddress = (currentUniverse - 1) * 512 + currentLocalAddress;

    // Tag with DMX info
    (fixture as any).dmxConfig = {
      universe: currentUniverse,
      address: currentLocalAddress
    };

    // If adding multiple, uniquely name them if they don't have a unique name already
    if (count > 1) {
      fixture.name = `${fixture.name} ${i + 1}`;
    }
    
    fixtures.push(fixture);

    // Increment address for the next fixture
    currentLocalAddress += channelCount;

    // Auto-wrap Universe if local address overflows
    if (currentLocalAddress + channelCount - 1 > 512) {
      currentUniverse++;
      currentLocalAddress = 1;
    }
  }
  
  emit('add', fixtures);
  
  emit('update:open', false);
  resetState();
}

function resetState() {
  selectedSummary.value = null;
  fullFixtureData.value = null;
  customFixtureStartWithAi.value = false;
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
  } else {
    // When opened, seed with the next free address in advance
    autoAssignFreeAddress();
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
            @create-custom-fixture="isCustomFixtureEditorOpen = true; customFixtureStartWithAi = false"
            @auto-create-fixture="triggerPdfUpload"
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

            <AddFixtureConfigForm
              v-model="config"
              :full-fixture-data="fullFixtureData"
              class="mt-2"
              @add="handleAdd"
            />
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <CustomFixtureEditorDialog 
    v-model:open="isCustomFixtureEditorOpen"
    :startWithAiUpload="customFixtureStartWithAi"
    @add="handleAddCustomFixtures"
  />
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
