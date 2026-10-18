<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
      </DialogHeader>
      <form class="space-y-4" @submit.prevent="submit">
        <div class="space-y-2">
          <Label for="projectName">Name</Label>
          <Input id="projectName" v-model="name" placeholder="My Show" required autofocus />
        </div>
        <div class="space-y-2">
          <Label for="projectDesc">Description <span class="text-muted-foreground">(optional)</span></Label>
          <Input id="projectDesc" v-model="description" placeholder="…" />
        </div>
        <div v-if="targets.length > 1" class="space-y-2">
          <Label>Save to</Label>
          <Select v-model="target">
            <SelectTrigger class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="t in targets" :key="t.value" :value="t.value" :disabled="t.disabled">
                {{ t.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p v-if="hint" class="text-xs text-muted-foreground">{{ hint }}</p>
        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="outline" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="busy">
            {{ busy ? busyLabel : submitLabel }}
          </Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
/**
 * Create / rename form for projects. In create mode on desktop while signed
 * in, the user picks where the project lives (account or this device).
 */
import { computed, ref, watch } from 'vue';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '~/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';
import type { ProjectTarget } from '~/utils/account/project-list';

const props = defineProps<{
  open: boolean;
  mode: 'create' | 'rename';
  initialName?: string;
  initialDescription?: string;
  /** Targets offered in create mode (first enabled one is the default). */
  targets?: { value: ProjectTarget; label: string; disabled?: boolean }[];
  hint?: string | null;
  /** Runs the operation; resolves with an error message or null. */
  onSubmit: (name: string, description: string, target: ProjectTarget) => Promise<string | null>;
}>();

const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const name = ref('');
const description = ref('');
const target = ref<ProjectTarget>('cloud');
const busy = ref(false);
const error = ref('');

const targets = computed(() => props.targets ?? []);
const title = computed(() => (props.mode === 'create' ? 'New project' : 'Rename project'));
const submitLabel = computed(() => (props.mode === 'create' ? 'Create' : 'Save'));
const busyLabel = computed(() => (props.mode === 'create' ? 'Creating…' : 'Saving…'));

// Reset the form every time the dialog opens.
watch(() => props.open, (open) => {
  if (!open) return;
  name.value = props.initialName ?? '';
  description.value = props.initialDescription ?? '';
  target.value = targets.value.find(t => !t.disabled)?.value ?? 'local';
  error.value = '';
}, { immediate: true });

/** Runs the operation and closes on success. */
async function submit(): Promise<void> {
  error.value = '';
  busy.value = true;
  try {
    const err = await props.onSubmit(name.value, description.value, target.value);
    if (err) error.value = err;
    else emit('update:open', false);
  }
  finally {
    busy.value = false;
  }
}
</script>
