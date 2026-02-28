import { ref, onMounted, onUnmounted, type Ref } from 'vue';

export function useEditorViewport(
  viewportEl: Ref<HTMLElement | null>,
  initialWidth: number,
  initialHeight: number,
  onFirstFit: () => void,
  onResizeStep: () => void
) {
  const editorWidth = ref(initialWidth);
  const editorHeight = ref(initialHeight);

  let resizeObserver: ResizeObserver | null = null;
  let initialFitDone = false;

  onMounted(() => {
    if (viewportEl.value) {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          editorWidth.value = width;
          editorHeight.value = height;

          if (!initialFitDone) {
            initialFitDone = true;
            onFirstFit();
          } else {
            onResizeStep();
          }
        }
      });
      resizeObserver.observe(viewportEl.value);
    }
  });

  onUnmounted(() => {
    resizeObserver?.disconnect();
  });

  return { editorWidth, editorHeight };
}
