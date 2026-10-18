<script setup lang="ts">
/**
 * Renders core notifications (`useNotifications`) bottom-right, including
 * optional bullet `lines` and `actions` buttons.
 */
import { ref } from 'vue';
import type { AppNotification, AppNotificationAction } from '~/composables/use-notifications';
import { dismiss, notifications } from '~/composables/use-notifications';
import { Button } from '@/components/ui/button';

/** Keys (`<notificationId>:<actionIndex>`) of actions that are running. */
const running = ref(new Set<string>());

/** Runs an action and keeps its button disabled until it settles. */
async function runAction(n: AppNotification, index: number, action: AppNotificationAction): Promise<void> {
  const key = `${n.id}:${index}`;
  if (running.value.has(key)) return;
  running.value = new Set(running.value).add(key);
  try {
    await action.run();
  }
  catch (err) {
    console.error('[toast] action failed:', err);
  }
  finally {
    const next = new Set(running.value);
    next.delete(key);
    running.value = next;
  }
}
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
          <ul v-if="n.lines?.length" class="mt-1.5 list-disc pl-4 text-xs space-y-0.5 break-words">
            <li v-for="(line, i) in n.lines" :key="i">{{ line }}</li>
          </ul>
          <div v-if="n.actions?.length" class="mt-2 flex flex-wrap gap-2">
            <Button
              v-for="(action, i) in n.actions"
              :key="i"
              size="sm"
              variant="outline"
              class="h-7 text-xs"
              :disabled="running.has(`${n.id}:${i}`)"
              @click="runAction(n, i, action)"
            >
              {{ action.label }}
            </Button>
          </div>
        </div>
        <button type="button" class="text-muted-foreground hover:text-foreground text-xs" aria-label="Dismiss" @click="dismiss(n.id)">✕</button>
      </div>
    </div>
  </div>
</template>
