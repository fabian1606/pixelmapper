/**
 * Minimal toast notifications (core). `notify()` adds a message that
 * `ToastStack.vue` shows for a few seconds.
 */
import { shallowRef } from 'vue';

/** One notification. */
export interface AppNotification {
  id: number;
  title: string;
  description?: string;
  variant: 'info' | 'warning' | 'error';
}

let nextId = 1;
/** Visible notifications (newest last). */
export const notifications = shallowRef<AppNotification[]>([]);

/** Shows a notification; returns its id. Auto-dismissed after `durationMs`. */
export function notify(n: Omit<AppNotification, 'id' | 'variant'> & { variant?: AppNotification['variant'] }, durationMs = 6000): number {
  const id = nextId++;
  const entry: AppNotification = { id, title: n.title, description: n.description, variant: n.variant ?? 'info' };
  notifications.value = [...notifications.value, entry].slice(-5);
  if (durationMs > 0) setTimeout(() => dismiss(id), durationMs);
  return id;
}

/** Removes a notification. */
export function dismiss(id: number): void {
  notifications.value = notifications.value.filter(n => n.id !== id);
}

/** Composable access. */
export function useNotifications() {
  return { notifications, notify, dismiss };
}
