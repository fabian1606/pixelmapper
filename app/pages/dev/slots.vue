<script setup lang="ts">
/**
 * Dev-only slot catalog (plan P7.3): every slot id rendered in this session
 * (navigate through the app, then open this page) with the scopes available
 * there and the extensions currently contributing to it. Helps humans and
 * agents pick a slot. Production builds answer 404.
 */
import { computed, ref } from 'vue';
import { getSlotContributions, renderedSlots } from '~/utils/extensions/slot-matching';

if (!import.meta.dev) throw createError({ statusCode: 404, statusMessage: 'Not found' });

const query = ref('');
const copied = ref<string | null>(null);

/** Rendered slots, filtered, with their contributions. */
const rows = computed(() => {
  const q = query.value.trim().toLowerCase();
  return [...renderedSlots.entries()]
    .filter(([id]) => !q || id.toLowerCase().includes(q))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, scopes]) => ({ id, scopes, contributions: getSlotContributions(id).map(c => c.extensionId) }));
});

/** Copies a slot id. */
async function copy(id: string) {
  try {
    await navigator.clipboard.writeText(id);
    copied.value = id;
    setTimeout(() => { if (copied.value === id) copied.value = null; }, 1200);
  }
  catch (err) {
    console.warn('[dev/slots] clipboard failed:', err);
  }
}
</script>

<template>
  <div class="min-h-screen bg-background p-8">
    <div class="max-w-4xl mx-auto space-y-4">
      <div class="flex items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold">Slot catalog <span class="text-xs font-normal text-muted-foreground">dev only</span></h1>
          <p class="text-sm text-muted-foreground mt-1">
            Slots rendered in this session ({{ renderedSlots.size }}). Open more views (properties, modifiers, live, context menus) and come back to see their slots.
            Global scopes <code>project</code>, <code>selection</code>, <code>viewport</code> are available everywhere.
          </p>
        </div>
        <NuxtLink to="/" class="text-sm text-primary hover:underline shrink-0">← Projects</NuxtLink>
      </div>
      <input v-model="query" placeholder="Filter slot ids…" class="w-full h-9 rounded-md border border-border bg-background px-3 text-sm">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
            <th class="py-2 pr-3">Slot id</th>
            <th class="py-2 pr-3">Scopes</th>
            <th class="py-2">Contributions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="border-b border-border/50 align-top">
            <td class="py-1.5 pr-3">
              <button class="font-mono text-xs hover:text-primary" :title="'Copy'" @click="copy(r.id)">{{ r.id }}</button>
              <span v-if="copied === r.id" class="ml-2 text-[10px] text-primary">copied</span>
            </td>
            <td class="py-1.5 pr-3 text-xs text-muted-foreground">{{ r.scopes.join(', ') || '—' }}</td>
            <td class="py-1.5 text-xs">{{ r.contributions.join(', ') || '—' }}</td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="3" class="py-6 text-center text-xs text-muted-foreground">No slots rendered yet — open a project first.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
