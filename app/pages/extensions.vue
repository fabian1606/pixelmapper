<script setup lang="ts">
/**
 * Extensions (ADR §5.9, plan P6.7): what is active (built in or installed),
 * the catalog to install from, install by id or link, updates, uninstall.
 * Installed = active (D19); every change reloads the app.
 */
import { computed, onMounted, ref } from 'vue';
import semver from 'semver';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getExtensions } from '~/utils/extensions/registry';
import { listAvailableExtensions, listInstalled, uninstallExtension, extensionsReady, type InstalledExtension, type LoadResult } from '~/utils/extensions/loader';
import type { ExtensionListing } from '~/utils/extensions/extension-sources';
import ExtensionInstallDialog from '~/components/extensions/ExtensionInstallDialog.vue';

const available = ref<ExtensionListing[]>([]);
const installed = ref<InstalledExtension[]>([]);
const loadResults = ref<LoadResult[]>([]);
const query = ref('');
const refInput = ref('');
const refError = ref<string | null>(null);
const installing = ref<{ listing: ExtensionListing; range?: string } | null>(null);

onMounted(async () => {
  [available.value, installed.value, loadResults.value] = await Promise.all([listAvailableExtensions(), listInstalled(), extensionsReady()]);
});

/** Registered extensions (layers and loaded bundles). */
const active = computed(() => getExtensions().filter(e => !e.manifest.id.startsWith('_')));

/** Newest listing per id. */
const latest = computed(() => {
  const by = new Map<string, ExtensionListing>();
  for (const l of available.value) {
    const cur = by.get(l.id);
    if (!cur || semver.gt(l.version, cur.version)) by.set(l.id, l);
  }
  return by;
});

/** Catalog entries not active yet, filtered by the search. */
const installable = computed(() => {
  const q = query.value.trim().toLowerCase();
  return [...latest.value.values()]
    .filter(l => !active.value.some(a => a.manifest.id === l.id))
    .filter(l => !q || `${l.id} ${l.displayName} ${l.description}`.toLowerCase().includes(q));
});

/** Update available for an installed bundle. */
function updateFor(id: string, version: string): ExtensionListing | null {
  const l = latest.value.get(id);
  return l && semver.gt(l.version, version) ? l : null;
}

/** Install by `id`, `id@range` or a link ending in the id. */
function installByRef() {
  refError.value = null;
  const text = refInput.value.trim();
  const m = /([a-z0-9]+(?:-[a-z0-9]+)*)(?:@([\^~]?[\d.x*]+))?\/?$/.exec(text);
  if (!m) { refError.value = 'Enter an extension id (e.g. neopixel-strip), id@version or a link.'; return; }
  const [, id, range] = m;
  const candidates = available.value.filter(l => l.id === id && (!range || semver.satisfies(l.version, range)));
  const best = candidates.sort((a, b) => semver.rcompare(a.version, b.version))[0];
  if (!best) { refError.value = `No published version of ${id}${range ? `@${range}` : ''}.`; return; }
  installing.value = { listing: best, range };
}

const statusOf = (id: string) => loadResults.value.find(r => r.id === id);
</script>

<template>
  <div class="min-h-screen bg-background p-8">
    <div class="max-w-3xl mx-auto space-y-8">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-semibold">Extensions</h1>
          <p class="text-muted-foreground text-sm mt-1">Installed extensions are active in every project. Changes reload the app.</p>
        </div>
        <NuxtLink to="/" class="text-sm text-primary hover:underline">← Projects</NuxtLink>
      </div>

      <section class="space-y-2">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active</h2>
        <ul class="divide-y divide-border rounded-lg border border-border">
          <li v-for="e in active" :key="e.manifest.id" class="flex items-center gap-3 px-4 py-3">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium">{{ e.manifest.displayName }} <span class="text-xs text-muted-foreground font-mono">{{ e.manifest.version }}</span></div>
              <div class="text-xs text-muted-foreground truncate">{{ e.manifest.description }}</div>
            </div>
            <span v-if="e.source === 'layer'" class="text-[10px] rounded border px-1.5 py-0.5 text-muted-foreground">Built in</span>
            <template v-else>
              <Button v-if="updateFor(e.manifest.id, e.manifest.version)" size="sm" variant="outline" @click="installing = { listing: updateFor(e.manifest.id, e.manifest.version)! }">
                Update to {{ updateFor(e.manifest.id, e.manifest.version)!.version }}
              </Button>
              <Button size="sm" variant="ghost" @click="uninstallExtension(e.manifest.id)">Uninstall</Button>
            </template>
          </li>
          <li v-for="i in installed.filter(x => !active.some(a => a.manifest.id === x.id))" :key="i.id" class="flex items-center gap-3 px-4 py-3">
            <div class="flex-1 text-sm">
              <span class="font-mono">{{ i.id }}</span> <span class="text-xs text-muted-foreground">{{ i.versionRange }}</span>
              <div class="text-xs text-destructive">{{ statusOf(i.id)?.error ?? 'not loaded' }}</div>
            </div>
            <Button size="sm" variant="ghost" @click="uninstallExtension(i.id)">Remove</Button>
          </li>
        </ul>
      </section>

      <section class="space-y-3">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Install</h2>
        <div class="flex gap-2">
          <Input v-model="refInput" placeholder="Extension id, id@version or link" class="font-mono text-sm" @keydown.enter="installByRef" />
          <Button @click="installByRef">Install…</Button>
        </div>
        <p v-if="refError" class="text-xs text-destructive">{{ refError }}</p>
        <Input v-model="query" placeholder="Search the catalog…" class="text-sm" />
        <ul class="divide-y divide-border rounded-lg border border-border">
          <li v-for="l in installable" :key="l.id" class="flex items-center gap-3 px-4 py-3">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium">{{ l.displayName }} <span class="text-xs text-muted-foreground font-mono">{{ l.version }}</span></div>
              <div class="text-xs text-muted-foreground">{{ l.description }}</div>
            </div>
            <Button size="sm" variant="outline" @click="installing = { listing: l }">Install…</Button>
          </li>
          <li v-if="!installable.length" class="px-4 py-6 text-center text-xs text-muted-foreground">Nothing to install.</li>
        </ul>
      </section>
    </div>
    <ExtensionInstallDialog :listing="installing?.listing ?? null" :range="installing?.range" @close="installing = null" />
  </div>
</template>
