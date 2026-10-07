<script setup lang="ts">
/**
 * Renders core notifications (`useNotifications`) bottom-right.
 */
import { dismiss, notifications } from '~/composables/use-notifications';
</script>

<template>
  <div class="fixed bottom-4 right-4 z-[300] flex flex-col gap-2 w-80 pointer-events-none" aria-live="polite">
    <div
      v-for="n in notifications"
      :key="n.id"
      data-overlay-root
      class="pointer-events-auto rounded-md border bg-popover text-popover-foreground shadow-lg p-3 text-sm"
      :class="n.variant === 'error' ? 'border-destructive' : n.variant === 'warning' ? 'border-yellow-500/60' : 'border-border'"
      role="status"
    >
      <div class="flex items-start gap-2">
        <div class="flex-1 min-w-0">
          <p class="font-medium">{{ n.title }}</p>
          <p v-if="n.description" class="text-xs text-muted-foreground mt-0.5 break-words">{{ n.description }}</p>
        </div>
        <button type="button" class="text-muted-foreground hover:text-foreground text-xs" aria-label="Dismiss" @click="dismiss(n.id)">✕</button>
      </div>
    </div>
  </div>
</template>
