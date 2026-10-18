<template>
  <AlertDialog :open="!!item" @update:open="(v: boolean) => { if (!v) emit('close'); }">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ title }}</AlertDialogTitle>
        <AlertDialogDescription>{{ description }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction class="bg-destructive text-white hover:bg-destructive/90" @click="emit('confirm')">
          {{ localOnly ? 'Remove' : 'Delete' }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
/**
 * Confirmation for deleting a project: a server delete for own cloud
 * projects, or removing the copy on this device for local / kept projects.
 */
import { computed } from 'vue';
import type { ProjectListItem } from '~/utils/account/project-list';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog';

const props = defineProps<{ item: ProjectListItem | null }>();
const emit = defineEmits<{ close: []; confirm: [] }>();

/** Only the copy on this device is affected. */
const localOnly = computed(() => !!props.item && (props.item.kind !== 'cloud' || props.item.remoteDeleted));

const title = computed(() => {
  const name = props.item?.name ?? '';
  if (!props.item) return '';
  if (props.item.kind === 'local') return `Delete "${name}"?`;
  return localOnly.value ? `Remove "${name}" from this device?` : `Delete "${name}"?`;
});

const description = computed(() => {
  if (!props.item) return '';
  if (props.item.kind === 'local') return 'This project only exists on this device. It will be deleted permanently.';
  if (localOnly.value) return 'The local copy and its unsynced changes will be removed from this device.';
  return 'The project will be deleted from the server for you and every collaborator. This cannot be undone.';
});
</script>
