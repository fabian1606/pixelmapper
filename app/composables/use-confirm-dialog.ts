/**
 * Promise-based core confirm dialog (plan M4.5).
 *
 * `requestConfirm()` queues a request that `ConfirmDialogHost.vue` (mounted
 * once in `app.vue`) shows; it resolves `true` when the user confirms and
 * `false` on cancel / close. Requests are shown one after another.
 */
import { computed, shallowRef } from 'vue';

/** What the dialog shows. */
export interface ConfirmRequest {
  title: string;
  /** Body text; several paragraphs are separated by blank lines. */
  message: string;
  /** Confirm button label (default "Confirm"). */
  confirmLabel?: string;
  /** Cancel button label (default "Cancel"). */
  cancelLabel?: string;
  /** Styles the confirm button as destructive. */
  destructive?: boolean;
}

/** A queued request with its resolver. */
interface PendingConfirm extends ConfirmRequest {
  id: number;
  resolve: (confirmed: boolean) => void;
}

let nextId = 1;
/** Pending requests; the first one is visible. */
const queue = shallowRef<PendingConfirm[]>([]);

/** The request currently shown, or `null`. */
export const currentConfirm = computed(() => queue.value[0] ?? null);

/** Asks the user; resolves `true` on confirm. */
export function requestConfirm(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    queue.value = [...queue.value, { ...request, id: nextId++, resolve }];
  });
}

/** Answers the visible request (called by the host component). */
export function answerConfirm(confirmed: boolean): void {
  const [head, ...rest] = queue.value;
  if (!head) return;
  queue.value = rest;
  head.resolve(confirmed);
}
