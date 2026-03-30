import { ref, onMounted, nextTick } from 'vue';

export function useCanvasInteraction(worldPx: number) {
  const scrollEl = ref<HTMLElement | null>(null);
  const zoom = ref(1.0);
  const isPanning = ref(false);

  const CX = worldPx / 2;
  const CY = worldPx / 2;

  onMounted(() => {
    if (scrollEl.value) {
      scrollEl.value.scrollLeft = CX - scrollEl.value.clientWidth / 2;
      scrollEl.value.scrollTop = CY - scrollEl.value.clientHeight / 2;
    }
  });

  function handleWheel(e: WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (!scrollEl.value) return;

      const rect = scrollEl.value.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const oldZoom = zoom.value;
      const zoomFactor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
      let newZoom = oldZoom * zoomFactor;
      newZoom = Math.max(0.2, Math.min(3.0, newZoom));

      const pointX = (scrollEl.value.scrollLeft + mouseX) / oldZoom;
      const pointY = (scrollEl.value.scrollTop + mouseY) / oldZoom;

      zoom.value = newZoom;

      nextTick(() => {
        if (scrollEl.value) {
          scrollEl.value.scrollLeft = pointX * newZoom - mouseX;
          scrollEl.value.scrollTop = pointY * newZoom - mouseY;
        }
      });
    }
  }

  let startX = 0, startY = 0;
  let startScrollLeft = 0, startScrollTop = 0;

  function handleMouseDown(e: MouseEvent) {
    isPanning.value = true;
    startX = e.clientX;
    startY = e.clientY;
    if (scrollEl.value) {
      startScrollLeft = scrollEl.value.scrollLeft;
      startScrollTop = scrollEl.value.scrollTop;
    }
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isPanning.value || !scrollEl.value) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    scrollEl.value.scrollLeft = startScrollLeft - dx;
    scrollEl.value.scrollTop = startScrollTop - dy;
  }

  function handleMouseUp() {
    isPanning.value = false;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }

  return {
    scrollEl,
    zoom,
    isPanning,
    handleWheel,
    handleMouseDown,
  };
}
