<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Search, Columns3 } from 'lucide-vue-next';
import { Input } from '~/components/ui/input';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from '~/components/ui/dropdown-menu';

// Public, unauthenticated read-only patch table. Reached via QR share link.
definePageMeta({ layout: false });

interface PatchRow {
  id: string | number;
  name: string;
  manufacturer: string;
  fixtureType: string;
  universe: number;
  localAddress: number;
  channels: number;
}

type ColKey = 'index' | 'name' | 'manufacturer' | 'fixtureType' | 'universe' | 'localAddress' | 'channels';

interface ColumnDef {
  key: ColKey;
  label: string;
  align: 'left' | 'center' | 'right';
  mono?: boolean;
}

// Order = display order. Default-visible: Fixture, Mode, Universe, Address.
const COLUMNS: ColumnDef[] = [
  { key: 'index', label: '#', align: 'left', mono: true },
  { key: 'name', label: 'Fixture', align: 'left' },
  { key: 'manufacturer', label: 'Type', align: 'left' },
  { key: 'fixtureType', label: 'Mode', align: 'left' },
  { key: 'universe', label: 'Universe', align: 'center', mono: true },
  { key: 'localAddress', label: 'Address', align: 'center', mono: true },
  { key: 'channels', label: 'Channels', align: 'right', mono: true },
];

const DEFAULT_VISIBLE: ColKey[] = ['name', 'fixtureType', 'universe', 'localAddress'];

const route = useRoute();
const supabase = useSupabaseClient();

const loading = ref(true);
const notFound = ref(false);
const projectName = ref('');
const fixtures = ref<PatchRow[]>([]);

const search = ref('');
const visible = ref<Record<ColKey, boolean>>(
  Object.fromEntries(COLUMNS.map((c) => [c.key, DEFAULT_VISIBLE.includes(c.key)])) as Record<ColKey, boolean>,
);

const shownColumns = computed(() => COLUMNS.filter((c) => visible.value[c.key]));

const filteredFixtures = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return fixtures.value;
  return fixtures.value.filter((f) =>
    [f.name, f.manufacturer, f.fixtureType, `u${f.universe}`, String(f.localAddress)]
      .join(' ')
      .toLowerCase()
      .includes(q),
  );
});

function cellValue(row: PatchRow, key: ColKey, idx: number): string | number {
  switch (key) {
    case 'index': return idx + 1;
    case 'manufacturer': return row.manufacturer || 'Generic';
    case 'fixtureType': return row.fixtureType || 'Standard';
    case 'channels': return `${row.channels}ch`;
    default: return row[key];
  }
}

function alignClass(align: ColumnDef['align']): string {
  return align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';
}

onMounted(async () => {
  const token = String(route.params.token ?? '');
  const { data, error } = await supabase.functions.invoke('load-shared-project', {
    body: { token },
  });
  if (error || !data) {
    notFound.value = true;
  } else {
    projectName.value = data.projectName ?? '';
    fixtures.value = data.fixtures ?? [];
  }
  loading.value = false;
});
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <div class="w-full px-3 sm:px-4 py-4">
      <header class="mb-3">
        <p class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
          Address Patch
        </p>
        <h1 class="text-lg font-semibold">{{ projectName || 'Patch' }}</h1>
      </header>

      <div v-if="loading" class="text-sm text-muted-foreground py-12 text-center">
        Lade Patch-Tabelle…
      </div>

      <div v-else-if="notFound" class="text-sm text-muted-foreground py-12 text-center">
        Dieser Share-Link ist ungültig oder wurde deaktiviert.
      </div>

      <template v-else>
        <!-- Toolbar: filter + column visibility -->
        <div class="flex items-center gap-2 mb-3">
          <div class="relative flex-1 min-w-0">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              v-model="search"
              placeholder="Filter…"
              class="pl-8 h-9"
              type="search"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" size="sm" class="h-9 gap-1.5 shrink-0">
                <Columns3 class="w-4 h-4" />
                <span class="hidden sm:inline">Spalten</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-44">
              <DropdownMenuLabel>Spalten</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                v-for="col in COLUMNS"
                :key="col.key"
                :model-value="visible[col.key]"
                @update:model-value="visible[col.key] = $event"
                @select="(e: Event) => e.preventDefault()"
              >
                {{ col.label }}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div v-if="filteredFixtures.length === 0" class="text-sm text-muted-foreground py-12 text-center">
          {{ fixtures.length === 0 ? 'Keine Fixtures gepatcht.' : 'Keine Treffer.' }}
        </div>

        <!-- Horizontally scrollable when too wide -->
        <div v-else class="overflow-x-auto rounded-lg border border-border/40">
          <table class="w-full text-xs">
            <thead class="bg-muted/40 text-muted-foreground">
              <tr>
                <th
                  v-for="col in shownColumns"
                  :key="col.key"
                  class="py-2 px-3 font-medium whitespace-nowrap"
                  :class="alignClass(col.align)"
                >
                  {{ col.label }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(fixture, idx) in filteredFixtures"
                :key="fixture.id"
                class="border-t border-border/30"
              >
                <td
                  v-for="col in shownColumns"
                  :key="col.key"
                  class="py-2 px-3 whitespace-nowrap"
                  :class="[
                    alignClass(col.align),
                    col.mono ? 'font-mono' : '',
                    col.key === 'name' ? 'font-medium' : '',
                    (col.key === 'manufacturer' || col.key === 'fixtureType' || col.key === 'channels' || col.key === 'index') ? 'text-muted-foreground' : '',
                  ]"
                >
                  {{ cellValue(fixture, col.key, idx) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </div>
</template>
