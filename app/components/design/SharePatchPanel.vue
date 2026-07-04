<script setup lang="ts">
import { ref } from 'vue';
import { Check, Copy, Loader2, RotateCw, X } from 'lucide-vue-next';
import { Button } from '~/components/ui/button';

const props = defineProps<{
  loading: boolean;
  error: string;
  shareUrl: string;
  qrDataUrl: string;
}>();
const emit = defineEmits<{ close: []; refresh: [] }>();

const copied = ref(false);

async function copyUrl() {
  try {
    await navigator.clipboard.writeText(props.shareUrl);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch { /* clipboard unavailable */ }
}
</script>

<template>
  <aside class="flex flex-col gap-3 p-4 bg-muted/10 min-w-0">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h3 class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
          Auf dem Handy öffnen
        </h3>
        <p class="text-[11px] text-muted-foreground/70 mt-0.5 leading-snug">
          QR scannen — zeigt die Patch-Tabelle ohne Login.
        </p>
      </div>
      <div class="flex items-center shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="loading"
          title="Aktualisieren (aktuellen Stand teilen)"
          @click="emit('refresh')"
        >
          <RotateCw class="w-3.5 h-3.5" :class="{ 'animate-spin': loading }" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Schließen"
          @click="emit('close')"
        >
          <X class="w-4 h-4" />
        </Button>
      </div>
    </div>

    <div
      class="self-center flex items-center justify-center bg-white rounded-lg p-2 w-full max-w-[220px] aspect-square"
    >
      <Loader2 v-if="loading" class="size-7 animate-spin text-muted-foreground" />
      <p v-else-if="error" class="text-xs text-destructive text-center px-3">
        {{ error }}
      </p>
      <img
        v-else-if="qrDataUrl"
        :src="qrDataUrl"
        alt="QR-Code zur Patch-Tabelle"
        class="max-w-full max-h-full h-auto object-contain"
      />
    </div>

    <div v-if="shareUrl && !error" class="flex items-center gap-2 w-full min-w-0">
      <code
        class="flex-1 min-w-0 truncate text-[10px] bg-muted rounded px-2 py-1.5 font-mono text-muted-foreground"
      >
        {{ shareUrl }}
      </code>
      <Button variant="outline" size="icon-sm" class="shrink-0" @click="copyUrl">
        <Check v-if="copied" :size="14" class="text-green-500" />
        <Copy v-else :size="14" />
      </Button>
    </div>
  </aside>
</template>
