<script setup lang="ts">
/**
 * Renders the core confirm dialog requested via `requestConfirm()`
 * (`app/composables/use-confirm-dialog.ts`, plan M4.5). Mounted once in
 * `app.vue`; closing the dialog counts as cancel.
 */
import { computed } from 'vue';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { answerConfirm, currentConfirm } from '~/composables/use-confirm-dialog';

/** Message paragraphs (blank-line separated). */
const paragraphs = computed(() => (currentConfirm.value?.message ?? '').split(/\n\s*\n/).filter(Boolean));

/** Closing without a button press cancels. */
function onOpenChange(open: boolean) {
  if (!open && currentConfirm.value) answerConfirm(false);
}
</script>

<template>
  <AlertDialog :open="!!currentConfirm" @update:open="onOpenChange">
    <AlertDialogContent v-if="currentConfirm" :key="currentConfirm.id">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ currentConfirm.title }}</AlertDialogTitle>
        <AlertDialogDescription as="div" class="space-y-2">
          <p v-for="(p, i) in paragraphs" :key="i">{{ p }}</p>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="answerConfirm(false)">
          {{ currentConfirm.cancelLabel ?? 'Cancel' }}
        </AlertDialogCancel>
        <AlertDialogAction
          :class="currentConfirm.destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''"
          @click="answerConfirm(true)"
        >
          {{ currentConfirm.confirmLabel ?? 'Confirm' }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
