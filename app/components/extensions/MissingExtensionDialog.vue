<script setup lang="ts">
/**
 * Missing/incompatible required extensions (ADR §5.10): the project is not
 * opened; each requirement can be installed or updated (reloads the app),
 * or the user goes back to the project list.
 */
import { computed, onMounted, ref } from 'vue';
import semver from 'semver';
import { Button } from '@/components/ui/button';
import type { MissingRequirement } from '~/utils/extensions/requires';
import { listAvailableExtensions } from '~/utils/extensions/loader';
import type { ExtensionListing } from '~/utils/extensions/extension-sources';
import ExtensionInstallDialog from './ExtensionInstallDialog.vue';

const props = defineProps<{ missing: MissingRequirement[] }>();

const available = ref<ExtensionListing[]>([]);
const loading = ref(true);
const installing = ref<{ listing: ExtensionListing; range: string } | null>(null);

onMounted(async () => {
  available.value = await listAvailableExtensions();
  loading.value = false;
});

/** Best available listing per requirement (highest version in range). */
const rows = computed(() => props.missing.map((m) => {
  const candidates = available.value.filter(l => l.id === m.id && semver.satisfies(l.version, m.version || '*'));
  const best = candidates.sort((a, b) => semver.rcompare(a.version, b.version))[0] ?? null;
  return { ...m, best };
}));
</script>

<template>
  <div class="flex items-center justify-center h-full">
    <div class="w-full max-w-md px-4 space-y-4">
      <div class="space-y-1 text-center">
        <h2 class="text-lg font-semibold">Extensions required</h2>
        <p class="text-sm text-muted-foreground">This project uses extensions that are not installed (or not compatible) on this device. Install them to open it.</p>
      </div>
      <ul class="divide-y divide-border rounded-md border border-border">
        <li v-for="r in rows" :key="r.id" class="flex items-center gap-3 px-3 py-2.5">
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium">{{ r.best?.displayName ?? r.id }}</div>
            <div class="text-[11px] text-muted-foreground font-mono">
              {{ r.id }} {{ r.version }}<template v-if="r.installed"> · installed {{ r.installed }}</template>
            </div>
          </div>
          <span v-if="loading" class="text-xs text-muted-foreground">…</span>
          <Button v-else-if="r.best" size="sm" @click="installing = { listing: r.best, range: r.version === '*' ? `^${r.best.version.split('.').slice(0, 2).join('.')}` : r.version }">
            {{ r.installed ? 'Update' : 'Install' }}
          </Button>
          <span v-else class="text-xs text-destructive">Not available</span>
        </li>
      </ul>
      <div class="text-center">
        <NuxtLink to="/" class="text-sm text-primary hover:underline">← Back to projects</NuxtLink>
      </div>
    </div>
    <ExtensionInstallDialog :listing="installing?.listing ?? null" :range="installing?.range" @close="installing = null" />
  </div>
</template>
