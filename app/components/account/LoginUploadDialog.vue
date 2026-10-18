<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Upload to your account?</DialogTitle>
        <DialogDescription>
          These projects only exist on this device. Selected projects are uploaded to
          {{ account?.label ?? 'your account' }} and sync from now on. The others stay local.
        </DialogDescription>
      </DialogHeader>

      <div class="max-h-72 overflow-y-auto space-y-1 -mx-1 px-1">
        <label
          v-for="p in candidates"
          :key="p.id"
          class="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/50 cursor-pointer"
        >
          <input v-model="selected" type="checkbox" :value="p.id" class="size-4 accent-primary" :disabled="busy">
          <span class="text-sm truncate">{{ p.name }}</span>
        </label>
      </div>

      <ul v-if="failed.length" class="text-sm text-destructive space-y-1">
        <li v-for="f in failed" :key="f.id">{{ f.name }}: {{ f.message }}</li>
      </ul>

      <DialogFooter>
        <Button variant="outline" :disabled="busy" @click="close">Keep local</Button>
        <Button :disabled="busy || selected.length === 0" @click="upload">
          {{ busy ? 'Uploading…' : `Upload ${selected.length || ''}`.trim() }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
/**
 * One-time dialog after signing in on desktop (ADR 0004 D14): lists the
 * local-only projects with checkboxes and uploads the selected ones. Local
 * projects are never uploaded automatically; projects bound to another
 * account are never offered.
 */
import { ref, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getProjectStore, type LocalProjectMeta } from '~/utils/persistence/project-store';
import type { RemoteClient } from '~/utils/sync/remote-api';
import { listUploadCandidates } from '~/utils/account/local-projects';
import { uploadLocalProjects, type UploadBatchResult } from '~/utils/account/upload';
import { bumpLocalProjects, pendingLoginReview, requestMirror } from '~/composables/account/account-state';
import { notify } from '~/composables/use-notifications';
import { Button } from '~/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog';

const supabase = useSupabaseClient() as unknown as SupabaseClient;

const open = ref(false);
const account = pendingLoginReview;
const candidates = ref<LocalProjectMeta[]>([]);
const selected = ref<string[]>([]);
const failed = ref<UploadBatchResult['failed']>([]);
const busy = ref(false);

// A fresh sign-in: show the dialog once, only if there is something to offer.
watch(pendingLoginReview, async (next) => {
  if (!next) {
    open.value = false;
    return;
  }
  try {
    candidates.value = await listUploadCandidates(await getProjectStore());
  }
  catch (err) {
    console.error('[account] listing local projects failed:', err);
    candidates.value = [];
  }
  if (candidates.value.length === 0) {
    pendingLoginReview.value = null;
    return;
  }
  selected.value = candidates.value.map(p => p.id);
  failed.value = [];
  open.value = true;
}, { immediate: true });

/** Closes and marks the review as done (it is not shown again for this sign-in). */
function close(): void {
  open.value = false;
  pendingLoginReview.value = null;
}

/** Closing via Escape / outside click counts as "Keep local". */
function onOpenChange(value: boolean): void {
  if (!value && !busy.value) close();
}

/** Uploads the selected projects one after another. */
async function upload(): Promise<void> {
  const user = account.value;
  if (!user) return close();
  busy.value = true;
  try {
    const res = await uploadLocalProjects(supabase as unknown as RemoteClient, await getProjectStore(), selected.value, user.id);
    bumpLocalProjects();
    if (res.uploaded.length) {
      notify({ variant: 'info', title: `Uploaded ${res.uploaded.length} project${res.uploaded.length === 1 ? '' : 's'}` });
      requestMirror();
    }
    if (res.failed.length === 0) return close();
    // Keep the dialog open with the failures; only the failed ones stay selected.
    failed.value = res.failed;
    candidates.value = candidates.value.filter(p => res.failed.some(f => f.id === p.id));
    selected.value = res.failed.map(f => f.id);
  }
  finally {
    busy.value = false;
  }
}
</script>
