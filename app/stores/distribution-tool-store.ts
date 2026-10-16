/**
 * Reassign session of the Distribution section (plan M4.3, revision R1):
 * which modifier's order is being reassigned on the canvas. While a session
 * is on, canvas selection is suspended (`use-selection.ts`) and the
 * `OrderTool` overlay takes the pointer (clicks number fixtures, a drag
 * draws a line).
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useDistributionToolStore = defineStore('distribution-tool', () => {
  /** Modifier whose order is being reassigned, or null. */
  const modifierId = ref<string | null>(null);

  /** Starts reassigning `id` (or ends the session when it is already on). */
  function toggle(id: string) {
    modifierId.value = modifierId.value === id ? null : id;
  }

  /** Ends any session. */
  function stop() {
    modifierId.value = null;
  }

  return { modifierId, toggle, stop };
});
