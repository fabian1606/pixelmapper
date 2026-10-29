<template>
  <div class="flex items-center justify-between gap-4">
    <div class="min-w-0">
      <h1 class="text-2xl font-semibold">Projects</h1>
      <p class="text-muted-foreground text-sm mt-1 truncate">
        <template v-if="account">{{ account.label }}</template>
        <template v-else>Not signed in · projects are stored on this device</template>
        <span v-if="!online" class="ml-2 inline-flex items-center gap-1"><WifiOff :size="12" />Offline</span>
      </p>
    </div>
    <div class="flex items-center gap-3 shrink-0">
      <NuxtLink to="/extensions" class="text-sm text-muted-foreground hover:text-foreground">Extensions</NuxtLink>
      <label class="text-sm text-muted-foreground hover:text-foreground cursor-pointer">
        {{ importing ? 'Importing…' : 'Import .pmproject' }}
        <input type="file" accept=".pmproject,application/zip" class="hidden" :disabled="importing" @change="onFile">
      </label>
      <Button v-if="account" variant="outline" size="sm" @click="emit('sign-out')">Sign out</Button>
      <Button v-else variant="outline" size="sm" as-child>
        <NuxtLink to="/auth/login"><Cloud :size="14" />Sign in to sync</NuxtLink>
      </Button>
      <Button size="sm" @click="emit('create')">New project</Button>
    </div>
  </div>
</template>

<script setup lang="ts">
/** Header of the project list: account, import, sign in/out, new project. */
import type { AccountIdentity } from '~/utils/account/known-accounts';
import { Button } from '~/components/ui/button';
import { Cloud, WifiOff } from 'lucide-vue-next';

defineProps<{
  account: AccountIdentity | null;
  online: boolean;
  importing: boolean;
}>();

const emit = defineEmits<{
  'create': [];
  'sign-out': [];
  'import': [file: File];
}>();

/** Forwards the picked file and resets the input (same file can be picked again). */
function onFile(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) emit('import', file);
}
</script>
