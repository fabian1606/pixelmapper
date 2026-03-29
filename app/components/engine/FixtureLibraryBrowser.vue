<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import type { FixtureSummary, ManufacturerSummary } from '~/utils/ofl/types';
import { Search, Loader2, ChevronRight, Plus } from 'lucide-vue-next';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

const props = defineProps<{
  selectedKey?: string;
}>();

const emit = defineEmits<{
  (e: 'select', item: FixtureSummary): void;
  (e: 'create-custom-fixture'): void;
}>();

// ─── State ────────────────────────────────────────────────────────────────────

const search = ref('');
const categoryFilter = ref('');
const loadingManufacturers = ref(false);
const loadingSearch = ref(false);

const manufacturers = ref<ManufacturerSummary[]>([]);
const fixtureCache = ref<Record<string, { items: FixtureSummary[], loading: boolean }>>({});
const searchResults = ref<{ items: FixtureSummary[], total: number }>({ items: [], total: 0 });

// ─── Computed ─────────────────────────────────────────────────────────────────

const isSearching = computed(() => search.value.trim().length > 0 || (categoryFilter.value && categoryFilter.value !== 'All'));

// ─── Categories ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  'All',
  'Color Changer',
  'Dimmer',
  'Moving Head',
  'Strobe',
  'Effect',
  'Pixel Bar',
];

// ─── Data Fetching ────────────────────────────────────────────────────────────

async function fetchManufacturers() {
  loadingManufacturers.value = true;
  try {
    const data = await $fetch<ManufacturerSummary[]>('/api/fixtures?mode=manufacturers');
    manufacturers.value = data;
    data.forEach(m => {
      if (!fixtureCache.value[m.key]) {
        fixtureCache.value[m.key] = { items: [], loading: false };
      }
    });
  } catch (err) {
    console.error('Failed to load manufacturers:', err);
  } finally {
    loadingManufacturers.value = false;
  }
}

async function loadManufacturerFixtures(mfKey: string) {
  if (fixtureCache.value[mfKey]?.items.length > 0 || fixtureCache.value[mfKey]?.loading) return;
  if (!fixtureCache.value[mfKey]) {
    fixtureCache.value[mfKey] = { items: [], loading: false };
  }
  fixtureCache.value[mfKey].loading = true;
  try {
    const data = await $fetch<{ items: FixtureSummary[] }>(`/api/fixtures?mode=fixtures&manufacturer=${mfKey}`);
    fixtureCache.value[mfKey].items = data.items;
  } catch (err) {
    console.error(`Failed to load fixtures for ${mfKey}:`, err);
  } finally {
    fixtureCache.value[mfKey].loading = false;
  }
}

let searchTimeout: ReturnType<typeof setTimeout> | null = null;
async function performSearch() {
  if (!isSearching.value) {
    searchResults.value = { items: [], total: 0 };
    return;
  }

  loadingSearch.value = true;
  const params = new URLSearchParams({ mode: 'fixtures' });
  if (search.value.trim()) params.set('search', search.value.trim());
  if (categoryFilter.value && categoryFilter.value !== 'All') {
    params.set('category', categoryFilter.value);
  }
  params.set('limit', '100');

  try {
    const data = await $fetch<{ items: FixtureSummary[], total: number }>(`/api/fixtures?${params.toString()}`);
    searchResults.value = { items: data.items, total: data.total };
  } catch (err) {
    console.error('Search failed:', err);
  } finally {
    loadingSearch.value = false;
  }
}

function debouncedSearch() {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(performSearch, 300);
}

// ─── Callbacks ────────────────────────────────────────────────────────────────

function handleAccordionUpdate(values: string[]) {
  values.forEach(val => {
    loadManufacturerFixtures(val);
  });
}

watch([search, categoryFilter], debouncedSearch);
onMounted(fetchManufacturers);

// ─── Helpers ──────────────────────────────────────────────────────────────────

</script>

<template>
  <div class="flex flex-col h-full bg-background overflow-hidden font-sans">
    <!-- Search & Filters -->
    <div class="p-4 bg-muted/20">
      <div class="flex gap-2 items-center">
        <div class="relative flex-1">
          <Search class="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input
            v-model="search"
            type="text"
            placeholder="Search fixture library..."
            class="w-full h-9 pl-9 pr-3 text-sm rounded-md bg-background border border-border focus:ring-1 focus:ring-primary focus:outline-none text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <button
          class="shrink-0 h-9 px-3 flex items-center justify-center gap-2 rounded-md bg-accent hover:bg-accent/80 text-accent-foreground text-xs font-medium transition-colors border border-border"
          @click="emit('create-custom-fixture')"
        >
          <Plus class="size-3.5" />
          Create custom fixture
        </button>
      </div>
      
      <!-- Category filter pills -->
      <div class="flex gap-1.5 flex-wrap mt-3">
        <button
          v-for="cat in CATEGORIES"
          :key="cat"
          class="px-2 py-0.5 rounded text-[11px] font-medium transition-colors"
          :class="categoryFilter === cat || (cat === 'All' && !categoryFilter)
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground border border-transparent hover:border-border'"
          @click="categoryFilter = cat === 'All' ? '' : cat"
        >
          {{ cat }}
        </button>
      </div>
    </div>

    <!-- Result Message / Count -->
    <div class="px-4 pt-2 pb-4 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground border-b border-border bg-muted/20">
      <span v-if="loadingManufacturers">Loading library...</span>
      <span v-else-if="isSearching">{{ searchResults.total }} results matching filters</span>
      <span v-else>{{ manufacturers.length }} Manufacturers available</span>
    </div>

    <!-- Fixture list -->
    <div class="flex-1 overflow-y-auto min-h-0 bg-background/50">
      
      <!-- SEARCH MODE -->
      <template v-if="isSearching">
         <div v-if="loadingSearch" class="flex items-center justify-center h-48">
          <Loader2 class="size-6 text-primary animate-spin" />
        </div>
        <div v-else-if="searchResults.items.length === 0" class="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
          <Search class="size-10 opacity-10" />
          <p class="text-xs uppercase font-bold tracking-widest">No results found</p>
        </div>
        <div v-else class="flex flex-col px-1 pt-1">
          <button
            v-for="item in searchResults.items"
            :key="item.key"
            class="flex flex-col gap-1 px-3 py-2.5 text-left rounded-md transition-all border border-transparent group/item"
            :class="selectedKey === item.key 
              ? 'bg-primary/10 border-primary/20 shadow-sm' 
              : 'hover:bg-accent/40'"
            @click="emit('select', item)"
          >
            <div class="flex items-center justify-between w-full">
              <span class="text-sm font-medium text-foreground group-hover/item:text-primary transition-colors">{{ item.name }}</span>
              <span class="text-[9px] text-muted-foreground opacity-50">{{ item.manufacturer }}</span>
            </div>
          </button>
        </div>
      </template>

      <!-- BROWSE MODE (Lazy-Loaded Accordion) -->
      <template v-else>
        <Accordion type="multiple" class="w-full" @update:model-value="handleAccordionUpdate">
          <AccordionItem
            v-for="mf in manufacturers"
            :key="mf.key"
            :value="mf.key"
            class="border-b border-border/50 px-0"
          >
            <AccordionTrigger class="px-4 py-3 hover:no-underline text-[10px] font-bold tracking-widest uppercase hover:text-primary transition-colors">
              <span class="text-foreground">
                {{ mf.name }} 
                <span class="text-muted-foreground/50 ml-1">({{ mf.fixtureCount }})</span>
              </span>
              <Loader2 v-if="fixtureCache[mf.key]?.loading" class="size-3 animate-spin text-primary ml-2" />
            </AccordionTrigger>
            <AccordionContent class="pb-2">
              <div v-if="fixtureCache[mf.key]?.loading && fixtureCache[mf.key]?.items.length === 0" class="flex items-center justify-center py-4">
                 <Loader2 class="size-4 animate-spin text-primary opacity-50" />
              </div>
              <div v-else class="flex flex-col px-1">
                <button
                  v-for="item in fixtureCache[mf.key]?.items"
                  :key="item.key"
                  class="flex flex-col gap-1 px-3 py-2.5 text-left rounded-md transition-all border border-transparent group/item"
                  :class="selectedKey === item.key 
                    ? 'bg-accent border-primary/20 shadow-sm' 
                    : 'hover:bg-accent/40'"
                  @click="emit('select', item)"
                >
                  <div class="flex items-center justify-between w-full">
                    <span class="text-sm font-medium text-muted-foreground/90 group-hover/item:text-primary transition-colors">{{ item.name }}</span>
                  </div>
                </button>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </template>

    </div>
  </div>
</template>
