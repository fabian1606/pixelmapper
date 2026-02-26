<script setup lang="ts">
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

interface Props {
  open: boolean;
  nodeName: string;
  count?: number;
}

interface Emits {
  (e: 'update:open', value: boolean): void;
  (e: 'confirm'): void;
}

const props = withDefaults(defineProps<Props>(), {
  count: 1,
});

const emit = defineEmits<Emits>();

const title = computed(() => {
  if (props.count > 1) {
    return `Delete ${props.count} items?`;
  }
  return `Delete "${props.nodeName}"?`;
});

const description = computed(() => {
  if (props.count > 1) {
    return `This will permanently remove ${props.count} selected fixtures and groups from the scene. This action can be undone by pressing Cmd+Z.`;
  }
  return `This action cannot be undone directly — but you can press <kbd class="px-1 py-0.5 text-xs font-mono bg-muted rounded">Cmd+Z</kbd> to undo it. The fixture will be permanently removed from the scene.`;
});

function onConfirm() {
  emit('confirm');
  emit('update:open', false);
}

function onCancel() {
  emit('update:open', false);
}
</script>

<template>
  <AlertDialog :open="open" @update:open="emit('update:open', $event)">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ title }}</AlertDialogTitle>
        <AlertDialogDescription v-html="description" />
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="onCancel">Cancel</AlertDialogCancel>
        <AlertDialogAction
          class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          @click="onConfirm"
        >
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
