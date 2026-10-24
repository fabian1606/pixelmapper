<script setup lang="ts">
import { ref } from 'vue';
import { Button } from '@/components/ui/button';
import { FileJson } from 'lucide-vue-next';

const props = defineProps<{
  steps: readonly { id: string; label: string }[];
  currentStepIdx: number;
  /** Shows the "Import OFL JSON" action (hidden while an AI extraction runs). */
  canImport?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:currentStepIdx', val: number): void;
  /** A `.json` file was picked for the OFL import (plan M4.7). */
  (e: 'importOflJson', file: File): void;
}>();

// Hidden file input behind the import button.
const importInput = ref<HTMLInputElement | null>(null);

/** Forwards the picked file and resets the input so the same file can be re-picked. */
function onImportFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) emit('importOflJson', file);
  target.value = '';
}
</script>

<template>
  <div class="shrink-0 border-b bg-muted/20 px-6 py-4 flex items-center">
    <h2 class="text-base font-bold tracking-tight shrink-0 flex-1">Create Custom Fixture</h2>

    <div class="flex items-center bg-muted/50 p-1 rounded-lg border border-border/50">
      <button
        v-for="(step, idx) in steps"
        :key="step.id"
        class="px-4 py-1.5 text-[13px] font-medium rounded-md transition-all duration-200 ease-out"
        :class="currentStepIdx === idx ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'"
        @click="emit('update:currentStepIdx', idx)"
      >
        {{ step.label }}
      </button>
    </div>

    <!-- Right side: OFL JSON import (loads a fixture file into the form) -->
    <div class="flex-1 flex justify-end pr-8">
      <template v-if="props.canImport">
        <Button
          variant="outline"
          size="sm"
          class="h-8 gap-1.5 text-xs"
          title="Load an Open Fixture Library fixture file (.json) into the editor"
          @click="importInput?.click()"
        >
          <FileJson class="size-3.5" />
          Import OFL JSON
        </Button>
        <input
          ref="importInput"
          type="file"
          accept=".json,application/json"
          class="hidden"
          @change="onImportFileChange"
        />
      </template>
    </div>
  </div>
</template>
