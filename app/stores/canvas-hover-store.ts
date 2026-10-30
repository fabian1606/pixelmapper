/**
 * Fixture under the pointer in the 2D editor canvas. The scene sidebar reads
 * it to highlight the hovered row — e.g. to find a single member inside a
 * selected group (which only highlights the group row itself).
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useCanvasHoverStore = defineStore('canvas-hover', () => {
  /** Id of the fixture under the pointer (stringified, as the WASM hit test returns it), or null. */
  const hoveredFixtureId = ref<string | null>(null);
  /** True while a swap-handle drag is on: the hovered id is then the swap partner, not the grabbed fixture. */
  const isSwapTarget = ref(false);

  /** Sets the hovered fixture; skips writes when unchanged to avoid needless reactivity. */
  function setHovered(id: string | null, swapTarget = false) {
    if (hoveredFixtureId.value !== id) hoveredFixtureId.value = id;
    if (isSwapTarget.value !== swapTarget) isSwapTarget.value = swapTarget;
  }

  return { hoveredFixtureId, isSwapTarget, setHovered };
});
