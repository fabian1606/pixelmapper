<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Library, Pencil, FileText, Clock, ChevronLeft, Trash2 } from 'lucide-vue-next';
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

// ─── View State ───────────────────────────────────────────────────────────────

type View = 'landing' | 'library';
const view = ref<View>('landing');

// ─── LocalStorage ─────────────────────────────────────────────────────────────

interface RecentFixture {
  key: string;
  name: string;
  manufacturer: string;
  addedAt: number;
}

interface StoredCustomFixture {
  id: string;
  name: string;
  ofl: OflFixture;
  createdAt: number;
}

const RECENT_KEY = 'pixelmapper:recentFixtures';
const CUSTOM_KEY = 'pixelmapper:customFixtures';
const MAX_RECENT = 8;

const recentFixtures = ref<RecentFixture[]>([]);
const customFixtures = ref<StoredCustomFixture[]>([]);

function loadFromStorage() {
  try {
    const r = localStorage.getItem(RECENT_KEY);
    recentFixtures.value = r ? JSON.parse(r) : [];
  } catch { recentFixtures.value = []; }
  try {
    const c = localStorage.getItem(CUSTOM_KEY);
    customFixtures.value = c ? JSON.parse(c) : [];
  } catch { customFixtures.value = []; }
}

function saveRecentFixture(summary: FixtureSummary) {
  const entry: RecentFixture = {
    key: summary.key,
    name: summary.name,
    manufacturer: summary.manufacturer ?? '',
    addedAt: Date.now(),
  };
  const filtered = recentFixtures.value.filter(r => r.key !== summary.key);
  recentFixtures.value = [entry, ...filtered].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recentFixtures.value));
}

function saveCustomFixture(ofl: OflFixture) {
  const existing = customFixtures.value.find(c => c.name === ofl.name);
  if (existing) {
    existing.ofl = ofl;
  } else {
    const entry: StoredCustomFixture = {
      id: `custom-${Date.now()}`,
      name: ofl.name,
      ofl,
      createdAt: Date.now(),
    };
    customFixtures.value = [entry, ...customFixtures.value];
  }
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(customFixtures.value));
}

function removeCustomFixture(id: string) {
  customFixtures.value = customFixtures.value.filter(c => c.id !== id);
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(customFixtures.value));
}

// ─── Fixture Selection State ──────────────────────────────────────────────────

const selectedSummary = ref<FixtureSummary | null>(null);
const fullFixtureData = ref<OflFixture | null>(null);
const loadingDetails = ref(false);
const isCustomFixtureEditorOpen = ref(false);
const customFixtureToEdit = ref<OflFixture | null>(null);
const customFixtureStartWithAi = ref(false);

const engineStore = useEngineStore();

function triggerPdfUpload() {
  customFixtureToEdit.value = null;
  customFixtureStartWithAi.value = true;
  isCustomFixtureEditorOpen.value = true;
}

function openCustomEditor() {
  customFixtureToEdit.value = null;
  customFixtureStartWithAi.value = false;
  isCustomFixtureEditorOpen.value = true;
}

function editStoredCustomFixture(stored: StoredCustomFixture) {
  customFixtureToEdit.value = stored.ofl;
  customFixtureStartWithAi.value = false;
  isCustomFixtureEditorOpen.value = true;
}

function handleAddCustomFixtures(fixtures: Fixture[]) {
  const def = fixtures[0]?.definition;
  if (def) saveCustomFixture(def);
  emit('add', fixtures);
  isCustomFixtureEditorOpen.value = false;
  customFixtureToEdit.value = null;
  customFixtureStartWithAi.value = false;
  emit('update:open', false);
}

function handleUpdateCustomFixtureType(ofl: OflFixture) {
  saveCustomFixture(ofl);
  isCustomFixtureEditorOpen.value = false;
  customFixtureToEdit.value = null;
}

// ─── DMX Config ───────────────────────────────────────────────────────────────

const config = ref({
  modeIndex: '0',
  universe: 1,
  address: 1,
  amount: 1,
});

function getSelectedFootprint(): number {
  if (!fullFixtureData.value) return 1;
  const modeIdx = parseInt(config.value.modeIndex, 10);
  const selectedMode = fullFixtureData.value.modes[modeIdx];
  return selectedMode ? selectedMode.channels.length : 1;
}

function autoAssignFreeAddress() {
  const footprint = getSelectedFootprint();
  const requiredSpan = footprint * config.value.amount;
  const occupiedRanges = engineStore.flatFixtures.map(f => ({
    start: f.startAddress, end: f.startAddress + f.channels.length - 1,
  })).sort((a, b) => a.start - b.start);

  let searchStart = 1;
  for (const range of occupiedRanges) {
    if (searchStart + requiredSpan - 1 < range.start) break;
    searchStart = Math.max(searchStart, range.end + 1);
  }
  config.value.universe = Math.floor((searchStart - 1) / 512) + 1;
  config.value.address = ((searchStart - 1) % 512) + 1;
}

watch(() => config.value.amount, () => autoAssignFreeAddress());
watch(() => config.value.modeIndex, () => autoAssignFreeAddress());

// ─── Select & Add ─────────────────────────────────────────────────────────────

async function handleSelect(summary: FixtureSummary) {
  selectedSummary.value = summary;
  loadingDetails.value = true;
  fullFixtureData.value = null;
  config.value.modeIndex = '0';
  try {
    const [mf, fix] = summary.key.split('/');
    const data = await $fetch<OflFixture>(`/api/fixtures/${mf}/${fix}`);
    fullFixtureData.value = data;
    autoAssignFreeAddress();
  } catch (err) {
    console.error('Failed to load fixture details:', err);
  } finally {
    loadingDetails.value = false;
  }
}

async function selectRecentFixture(recent: RecentFixture) {
  // Load inline on landing page — do NOT switch to library view
  await handleSelect({ key: recent.key, name: recent.name, manufacturer: recent.manufacturer } as FixtureSummary);
}

function handleAdd() {
  if (!fullFixtureData.value || !selectedSummary.value) return;

  const modeIdx = parseInt(config.value.modeIndex, 10);
  const selectedMode = fullFixtureData.value.modes[modeIdx];
  if (!selectedMode) return;

  const channelCount = selectedMode.channels.length;
  let currentLocalAddress = config.value.address;
  let currentUniverse = config.value.universe;
  const count = Math.max(1, Math.min(config.value.amount, 50));

  const fixtures: Fixture[] = [];
  for (let i = 0; i < count; i++) {
    if (currentLocalAddress + channelCount - 1 > 512) {
      currentUniverse++;
      currentLocalAddress = 1;
    }
    const fixture = createFixtureFromOfl(
      fullFixtureData.value,
      modeIdx,
      undefined,
      selectedSummary.value?.manufacturer,
    );
    fixture.startAddress = (currentUniverse - 1) * 512 + currentLocalAddress;
    (fixture as any).dmxConfig = { universe: currentUniverse, address: currentLocalAddress };
    if (count > 1) fixture.name = `${fixture.name} ${i + 1}`;
    fixtures.push(fixture);
    currentLocalAddress += channelCount;
  }

  saveRecentFixture(selectedSummary.value);
  emit('add', fixtures);
  emit('update:open', false);
  resetState();
}

function resetState() {
  selectedSummary.value = null;
  fullFixtureData.value = null;
  customFixtureStartWithAi.value = false;
  customFixtureToEdit.value = null;
  view.value = 'landing';
  config.value = { modeIndex: '0', universe: 1, address: 1, amount: 1 };
}

watch(() => props.open, (isOpen) => {
  if (!isOpen) {
    resetState();
  } else {
    loadFromStorage();
    autoAssignFreeAddress();
  }
});
</script>

<template>
  <Dialog :open="open" @update:open="val => emit('update:open', val)">
    <DialogContent class="sm:max-w-[850px] p-0 overflow-hidden bg-background border-none shadow-2xl">
      <div class="flex flex-col h-[85vh]">

        <!-- ── Landing View ──────────────────────────────────────────────── -->
        <template v-if="view === 'landing'">
          <div class="px-6 py-5 shrink-0">
            <DialogTitle class="text-lg font-bold tracking-tight">Add Fixture</DialogTitle>
          </div>

          <div class="flex-1 overflow-y-auto px-6 pb-6 flex flex-col gap-8">
            <!-- 3 Action Cards -->
            <div class="grid grid-cols-3 gap-3">
              <button
                class="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/60 hover:border-primary/40 transition-all p-5 text-center group"
                @click="view = 'library'"
              >
                <div class="size-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <Library class="size-5 text-primary" />
                </div>
                <div>
                  <p class="text-sm font-semibold text-foreground">Add from Library</p>
                  <p class="text-xs text-muted-foreground mt-0.5">Browse thousands of fixtures</p>
                </div>
              </button>

              <button
                class="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/60 hover:border-primary/40 transition-all p-5 text-center group"
                @click="openCustomEditor"
              >
                <div class="size-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <Pencil class="size-5 text-primary" />
                </div>
                <div>
                  <p class="text-sm font-semibold text-foreground">Create Custom</p>
                  <p class="text-xs text-muted-foreground mt-0.5">Define channels manually</p>
                </div>
              </button>

              <button
                class="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/60 hover:border-primary/40 transition-all p-5 text-center group"
                @click="triggerPdfUpload"
              >
                <div class="size-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <FileText class="size-5 text-primary" />
                </div>
                <div>
                  <p class="text-sm font-semibold text-foreground">Create from PDF</p>
                  <p class="text-xs text-muted-foreground mt-0.5">AI reads the manual for you</p>
                </div>
              </button>
            </div>

            <!-- Recent Fixtures -->
            <div v-if="recentFixtures.length > 0">
              <div class="flex items-center gap-2 mb-3">
                <Clock class="size-4 text-muted-foreground" />
                <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recently Added</h3>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <button
                  v-for="recent in recentFixtures"
                  :key="recent.key"
                  class="flex items-center gap-3 rounded-lg border bg-muted/20 hover:bg-muted/50 transition-all px-4 py-3 text-left group"
                  :class="selectedSummary?.key === recent.key ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/30'"
                  @click="selectRecentFixture(recent)"
                >
                  <div class="size-7 rounded bg-primary/10 flex items-center justify-center shrink-0">
                    <Library class="size-3.5 text-primary" />
                  </div>
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-foreground truncate">{{ recent.name }}</p>
                    <p class="text-xs text-muted-foreground truncate">{{ recent.manufacturer }}</p>
                  </div>
                </button>
              </div>
            </div>

            <!-- Custom Fixtures -->
            <div v-if="customFixtures.length > 0">
              <div class="flex items-center gap-2 mb-3">
                <Pencil class="size-4 text-muted-foreground" />
                <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">My Custom Fixtures</h3>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div
                  v-for="custom in customFixtures"
                  :key="custom.id"
                  class="flex items-center gap-3 rounded-lg border border-border bg-muted/20 hover:bg-muted/50 hover:border-primary/30 transition-all px-4 py-3 group"
                >
                  <div class="size-7 rounded bg-primary/10 flex items-center justify-center shrink-0">
                    <Pencil class="size-3.5 text-primary" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium text-foreground truncate">{{ custom.name }}</p>
                    <p class="text-xs text-muted-foreground truncate">{{ custom.ofl.categories?.[0] ?? 'Custom' }}</p>
                  </div>
                  <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-6 text-muted-foreground hover:text-foreground"
                      title="Edit"
                      @click.stop="editStoredCustomFixture(custom)"
                    >
                      <Pencil class="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-6 text-muted-foreground hover:text-destructive"
                      title="Delete"
                      @click.stop="removeCustomFixture(custom.id)"
                    >
                      <Trash2 class="size-3" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Config Footer (same style as library view) -->
          <div
            class="shrink-0 bg-muted/30 border-t transition-all duration-500 overflow-hidden"
            :class="selectedSummary ? 'max-h-[300px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'"
          >
            <div class="px-6 py-6 flex flex-col gap-6">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold text-foreground">
                  {{ selectedSummary?.manufacturer }} – {{ selectedSummary?.name }}
                </h3>
                <div v-if="loadingDetails" class="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 class="size-3 animate-spin text-primary" />
                  Loading...
                </div>
              </div>
              <AddFixtureConfigForm
                v-if="fullFixtureData"
                v-model="config"
                :full-fixture-data="fullFixtureData"
                class="mt-2"
                @add="handleAdd"
              />
            </div>
          </div>
        </template>

        <!-- ── Library View ──────────────────────────────────────────────── -->
        <template v-else-if="view === 'library'">
          <div class="px-6 py-5 flex items-center gap-3 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              class="size-7 text-muted-foreground hover:text-foreground shrink-0"
              @click="view = 'landing'; selectedSummary = null; fullFixtureData = null"
            >
              <ChevronLeft class="size-4" />
            </Button>
            <DialogTitle class="text-lg font-bold tracking-tight">Add from Library</DialogTitle>
          </div>

          <div class="flex-1 flex flex-col min-h-0 bg-muted/20">
            <FixtureLibraryBrowser
              class="flex-1"
              :selected-key="selectedSummary?.key"
              @select="handleSelect"
              @create-custom-fixture="openCustomEditor"
              @auto-create-fixture="triggerPdfUpload"
            />
          </div>

          <div
            class="shrink-0 bg-muted/30 border-t transition-all duration-500 overflow-hidden"
            :class="selectedSummary ? 'max-h-[300px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'"
          >
            <div class="px-6 py-6 flex flex-col gap-6">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold text-foreground">
                  {{ selectedSummary?.manufacturer }} – {{ selectedSummary?.name }}
                </h3>
                <div v-if="loadingDetails" class="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 class="size-3 animate-spin text-primary" />
                  Loading mode data...
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
        </template>

      </div>
    </DialogContent>
  </Dialog>

  <CustomFixtureEditorDialog
    v-model:open="isCustomFixtureEditorOpen"
    :startWithAiUpload="customFixtureStartWithAi"
    :fixture-to-edit="customFixtureToEdit"
    @add="handleAddCustomFixtures"
    @update-type="handleUpdateCustomFixtureType"
  />
</template>

<style scoped>
.max-h-0 {
  visibility: hidden;
}
.max-h-\[300px\] {
  visibility: visible;
}
</style>
