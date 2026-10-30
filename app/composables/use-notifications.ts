/**
 * Minimal toast notifications (core). `notify()` adds a message that
 * `ToastStack.vue` shows for a few seconds.
 *
 * Optional `lines` (a short bullet list) and `actions` (buttons) are additive
 * extensions used e.g. by the sync conflict toast (ADR 0004 D17).
 */
import { shallowRef } from 'vue';

/** A button shown in a notification. */
export interface AppNotificationAction {
  label: string;
  /** Runs on click; the button is disabled until a returned promise settles. */
  run: () => void | Promise<void>;
}

/** One notification. */
export interface AppNotification {
  id: number;
  title: string;
  description?: string;
  variant: 'info' | 'warning' | 'error';
  /** Optional bullet lines below the description. */
  lines?: string[];
  /** Optional action buttons. */
  actions?: AppNotificationAction[];
}

/** Input of `notify()`: everything except the id; variant defaults to info. */
export type NotifyInput = Omit<AppNotification, 'id' | 'variant'> & { variant?: AppNotification['variant'] };

let nextId = 1;
/** Visible notifications (newest last). */
export const notifications = shallowRef<AppNotification[]>([]);

/** Shows a notification; returns its id. Auto-dismissed after `durationMs` (0 = never). */
export function notify(n: NotifyInput, durationMs = 6000): number {
  const id = nextId++;
  const entry: AppNotification = {
    id,
    title: n.title,
    description: n.description,
    variant: n.variant ?? 'info',
    lines: n.lines,
    actions: n.actions,
  };
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
