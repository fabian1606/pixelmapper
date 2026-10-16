<script setup lang="ts">
/**
 * Plugin library (plan P4.4): browse available modifier plugins (built-in,
 * mine, project, public, local), import by hash / alias / link or from a
 * `.pmplugin.json` file, share (copy link, download file), add to the stack.
 */
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Loader2, Plus, Link2, Download, Upload } from 'lucide-vue-next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listAvailable, type AvailablePlugin } from '~/utils/plugins/plugin-store';
import { exportPluginFile, importPlugin, importPluginFile, pluginLink, type ImportResult } from '~/utils/plugins/import-plugin';

const open = defineModel<boolean>('open', { default: false });

const emit = defineEmits<{
  /** Add an instance of this plugin to the current stack. */
  add: [hash: string];
}>();

const route = useRoute();
const projectId = computed(() => (typeof route.params.id === 'string' ? route.params.id : undefined));

// ── Browse ───────────────────────────────────────
const loading = ref(false);
const available = ref<AvailablePlugin[]>([]);
const query = ref('');

/** Loads the listing when the dialog opens. */
async function refresh() {
  loading.value = true;
  try {
    available.value = (await listAvailable({ projectId: projectId.value, includePublic: true })).filter(p => p.manifest.kind === 'modifier');
  }
  finally {
    loading.value = false;
  }
}
watch(open, (v) => { if (v) void refresh(); }, { immediate: true });

/** Listing filtered by name, alias or description. */
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return available.value;
  return available.value.filter(p => `${p.manifest.name} ${p.manifest.alias} ${p.manifest.description}`.toLowerCase().includes(q));
});

/** Origin → badge label. */
const ORIGIN_LABEL = { builtin: 'Built-in', mine: 'Mine', project: 'Project', public: 'Public', local: 'Local' } as const;

/** Adds a listed plugin (resolving it first if needed). */
async function addListed(p: AvailablePlugin) {
  if (p.origin !== 'builtin') {
    const res = await importPlugin(p.hash);
    if (!res.ok) {
      importState.value = res;
      return;
    }
  }
  emit('add', p.hash);
  open.value = false;
}

/** Copies a plugin's share link. */
async function copyLink(hash: string) {
  try {
    await navigator.clipboard.writeText(pluginLink(hash));
  }
  catch (err) {
    console.warn('[plugin-library] clipboard failed:', err);
  }
}

/** Downloads a package file (resolves it first). */
async function download(p: AvailablePlugin) {
  if (p.origin !== 'builtin') await importPlugin(p.hash);
  const file = exportPluginFile(p.hash);
  if (!file) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${p.manifest.alias.replace(/[@/]/g, '_')}.pmplugin.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Import ───────────────────────────────────────
const ref_ = ref('');
const importing = ref(false);
const importState = ref<ImportResult | null>(null);

/** Imports by hash / alias / link. */
async function importRef() {
  importing.value = true;
  try {
    importState.value = await importPlugin(ref_.value);
  }
  finally {
    importing.value = false;
  }
}

/** Imports a package file. */
async function importFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  importing.value = true;
  try {
    importState.value = await importPluginFile(await file.text());
  }
  finally {
    importing.value = false;
    (e.target as HTMLInputElement).value = '';
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-2xl w-[95vw] max-h-[85vh] flex flex-col gap-3" data-overlay-root>
      <DialogHeader>
        <DialogTitle>Modifier plugins</DialogTitle>
        <DialogDescription class="text-xs">Plugins are identified by content hash; imports are rebuilt from source and verified.</DialogDescription>
      </DialogHeader>

      <Tabs default-value="browse" class="min-h-0 flex flex-col">
        <TabsList class="self-start">
          <TabsTrigger value="browse">Browse</TabsTrigger>
          <TabsTrigger value="import">Import</TabsTrigger>
        </TabsList>

        <TabsContent value="browse" class="min-h-0 flex flex-col gap-2">
          <Input v-model="query" placeholder="Search plugins…" class="h-8 text-xs" />
          <div v-if="loading" class="py-6 flex justify-center"><Loader2 class="h-4 w-4 animate-spin" /></div>
          <ul v-else class="overflow-y-auto max-h-[55vh] divide-y divide-border/60">
            <li v-for="p in filtered" :key="p.hash" class="py-2 flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium">{{ p.manifest.name }}</span>
                  <span class="text-[10px] rounded border px-1.5 py-0.5 text-muted-foreground">{{ ORIGIN_LABEL[p.origin] }}</span>
                  <span class="text-[10px] text-muted-foreground">{{ p.manifest.signatures.join(', ') }}</span>
                </div>
                <div class="text-[11px] text-muted-foreground line-clamp-2">{{ p.manifest.description }}</div>
              </div>
              <Button v-if="p.origin !== 'builtin'" variant="ghost" size="icon" class="h-7 w-7" title="Copy link" @click="copyLink(p.hash)">
                <Link2 class="h-3.5 w-3.5" />
              </Button>
              <Button v-if="p.origin !== 'builtin'" variant="ghost" size="icon" class="h-7 w-7" title="Download package" @click="download(p)">
                <Download class="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="outline" class="h-7 gap-1" @click="addListed(p)">
                <Plus class="h-3.5 w-3.5" /> Add
              </Button>
            </li>
            <li v-if="filtered.length === 0" class="py-6 text-center text-xs text-muted-foreground">No plugins found.</li>
          </ul>
        </TabsContent>

        <TabsContent value="import" class="flex flex-col gap-3">
          <div class="flex gap-2">
            <Input v-model="ref_" placeholder="sha256:…, @scope/name or link" class="h-8 text-xs font-mono" @keydown.enter="importRef" />
            <Button size="sm" :disabled="importing || !ref_.trim()" @click="importRef">
              <Loader2 v-if="importing" class="h-3.5 w-3.5 animate-spin" />
              <span v-else>Import</span>
            </Button>
          </div>
          <label class="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Upload class="h-3.5 w-3.5" /> Import a .pmplugin.json file
            <input type="file" accept=".json,application/json" class="hidden" @change="importFile">
          </label>
        </TabsContent>
      </Tabs>

      <div v-if="importState" class="rounded-md border p-2 text-xs flex items-center gap-2">
        <template v-if="importState.ok">
          <span class="text-emerald-500 flex-1">Imported {{ importState.plugin.manifest.name }}.</span>
          <Button size="sm" class="h-7 gap-1" @click="emit('add', importState.plugin.hash); open = false">
            <Plus class="h-3.5 w-3.5" /> Add to stack
          </Button>
        </template>
        <span v-else class="text-destructive whitespace-pre-wrap">{{ importState.error }}</span>
      </div>
    </DialogContent>
  </Dialog>
</template>
