/**
 * Canvas tool of the Distribution section (plan M4.1/M4.3): which order tool
 * is active (`click` = click fixtures in sequence, `line` = draw a line) and
 * for which modifier. While a tool is on, canvas selection is suspended
 * (`use-selection.ts`) and the `OrderTool` overlay takes the pointer.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

/** An order tool. */
export type DistributionTool = 'click' | 'line';

export const useDistributionToolStore = defineStore('distribution-tool', () => {
  /** Active tool, or null. */
  const tool = ref<DistributionTool | null>(null);
  /** Modifier the tool edits. */
  const modifierId = ref<string | null>(null);

  /** Turns `next` on for a modifier (or off when it is already on). */
  function toggle(next: DistributionTool, id: string) {
    if (tool.value === next && modifierId.value === id) stop();
    else {
      tool.value = next;
      modifierId.value = id;
    }
  }

  /** Ends any tool. */
  function stop() {
    tool.value = null;
    modifierId.value = null;
  }

  return { tool, modifierId, toggle, stop };
});
