<script setup lang="ts">
/**
 * One-time choice dialog for conflicting `pm.*` replacements (ADR §5.4).
 *
 * When several installed extensions replace the same input and the user has
 * not chosen yet, the core default is used and this dialog asks once. The
 * choice is stored per user (localStorage) via `setReplacementChoice`.
 */
import { computed } from 'vue';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getExtension } from '~/utils/extensions/registry';
import {
  CORE_CHOICE,
  getReplacementCandidates,
  pendingConflicts,
  setReplacementChoice,
} from '~/utils/extensions/replacements';

/** The conflict currently asked about. */
const current = computed(() => pendingConflicts.value[0] ?? null);

/** Options: each installed replacement plus the core default. */
const options = computed(() => {
  const name = current.value;
  if (!name) return [];
  return [
    ...getReplacementCandidates(name).map(c => ({
      id: c.extensionId,
      label: getExtension(c.extensionId)?.manifest.displayName ?? c.extensionId,
    })),
    { id: CORE_CHOICE, label: 'Built-in default' },
  ];
});

/** Stores the choice; closing without choosing keeps the default for now. */
function choose(id: string) {
  if (current.value) setReplacementChoice(current.value, id);
}

function onOpenChange(open: boolean) {
  if (!open && current.value) choose(CORE_CHOICE);
}
</script>

<template>
  <Dialog :open="!!current" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Choose a control</DialogTitle>
        <DialogDescription>
          Several installed extensions replace <code class="font-mono">{{ current }}</code>. Which one should be used?
        </DialogDescription>
      </DialogHeader>
      <div class="flex flex-col gap-2">
        <Button v-for="opt in options" :key="opt.id" variant="outline" class="justify-start" @click="choose(opt.id)">
          {{ opt.label }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
