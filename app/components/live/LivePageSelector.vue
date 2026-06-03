<script setup lang="ts">
import { computed, ref } from 'vue';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useHistory } from '~/components/engine/composables/use-history';
import { AddLivePageCommand, RemoveLivePageCommand, UpdateLivePageCommand } from '~/components/engine/commands/live-widget-commands';
import { defaultLivePage } from '~/utils/live/types';
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

const store = useLiveModeStore();
const history = useHistory();

const editingPageId = ref<string | null>(null);
// Dialog visibility is kept separate from the target id so that the dialog's
// auto-close (which fires update:open) doesn't wipe the id before confirm reads it.
const deleteDialogOpen = ref(false);
const deleteTargetId = ref<string | null>(null);

const deleteTargetPage = computed(() =>
  store.pages.find((p) => p.id === deleteTargetId.value) ?? null,
);

function addPage() {
  const page = defaultLivePage({ name: `Page ${store.pages.length + 1}` });
  history.execute(new AddLivePageCommand(page));
  store.setActivePage(page.id);
}

function requestRemovePage(pageId: string) {
  if (store.pages.length <= 1) return;
  deleteTargetId.value = pageId;
  deleteDialogOpen.value = true;
}

function confirmRemovePage() {
  const pageId = deleteTargetId.value;
  deleteDialogOpen.value = false;
  if (!pageId || store.pages.length <= 1) return;
  history.execute(new RemoveLivePageCommand(pageId));
}

// Only toggles visibility — deleteTargetId is intentionally left as-is so the
// dialog's auto-close can't race confirmRemovePage. It's overwritten on next open.
function cancelRemovePage() {
  deleteDialogOpen.value = false;
}

function startRename(pageId: string) {
  editingPageId.value = pageId;
}

function commitRename(pageId: string, name: string) {
  if (name.trim()) {
    history.execute(new UpdateLivePageCommand(pageId, { name: name.trim() }));
  }
  editingPageId.value = null;
}
</script>

<template>
  <div class="flex items-center gap-0.5 bg-background/90 backdrop-blur-sm border border-border/60 rounded-full shadow-lg p-1 overflow-x-auto max-w-[80vw]">
    <button
      v-for="page in store.pages"
      :key="page.id"
      class="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-all duration-150 font-medium group"
      :class="page.id === store.activePageId
        ? 'bg-accent text-primary'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'"
      @click="store.setActivePage(page.id)"
      @dblclick.stop="startRename(page.id)"
    >
      <input
        v-if="editingPageId === page.id"
        :value="page.name"
        class="bg-transparent outline-none w-20 text-xs"
        autofocus
        @blur="(e) => commitRename(page.id, (e.target as HTMLInputElement).value)"
        @keydown.enter="(e) => commitRename(page.id, (e.target as HTMLInputElement).value)"
        @keydown.escape="editingPageId = null"
        @click.stop
      />
      <span v-else>{{ page.name }}</span>

      <button
        v-if="store.pages.length > 1"
        class="opacity-0 group-hover:opacity-60 hover:!opacity-100 ml-0.5 leading-none"
        @click.stop="requestRemovePage(page.id)"
      >
        ×
      </button>
    </button>

    <button
      class="px-3 py-1.5 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0 font-medium"
      @click="addPage"
    >
      + Page
    </button>

    <AlertDialog
      :open="deleteDialogOpen"
      @update:open="(open) => { if (!open) cancelRemovePage(); }"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{{ deleteTargetPage?.name }}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove this page and all its widgets. You can press
            <kbd class="px-1 py-0.5 text-xs font-mono bg-muted rounded">Cmd+Z</kbd> to undo it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="cancelRemovePage">Cancel</AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            @click="confirmRemovePage"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
