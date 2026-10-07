<script setup lang="ts">
/**
 * Confirmation before installing an extension (ADR §5.9): id, version,
 * source and the full-access warning. Installing reloads the app.
 */
import { ref } from 'vue';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ExtensionListing } from '~/utils/extensions/extension-sources';
import { installExtension } from '~/utils/extensions/loader';

const props = defineProps<{
  /** Extension to install (null = closed). */
  listing: ExtensionListing | null;
  /** Range to install (default `^major.minor` of the chosen version). */
  range?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const busy = ref(false);
const error = ref<string | null>(null);

/** Installs and reloads (or reports why it failed). */
async function confirm() {
  if (!props.listing) return;
  busy.value = true;
  error.value = null;
  try {
    const ok = await installExtension(props.listing.id, props.range ?? `^${props.listing.version.split('.').slice(0, 2).join('.')}`);
    if (!ok) error.value = 'No compatible version could be downloaded.';
  }
  catch (err) {
    error.value = (err as Error).message;
  }
  finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog :open="!!listing" @update:open="v => { if (!v) emit('close'); }">
    <DialogContent v-if="listing" class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Install {{ listing.displayName }}?</DialogTitle>
        <DialogDescription class="text-xs">
          <span class="font-mono">{{ listing.id }}@{{ listing.version }}</span>
          · {{ listing.source === 'catalog' ? 'Pixelmapper catalog' : 'Community registry' }}
        </DialogDescription>
      </DialogHeader>
      <p class="text-sm text-muted-foreground">{{ listing.description }}</p>
      <div class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        Extensions run with full access to your projects and this app. Only install extensions you trust.
      </div>
      <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
      <DialogFooter>
        <Button variant="ghost" @click="emit('close')">Cancel</Button>
        <Button :disabled="busy" @click="confirm">{{ busy ? 'Installing…' : 'Install & reload' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
