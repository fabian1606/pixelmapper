import { reactive } from 'vue';

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export interface Point {
  x: number;
  y: number;
}

const MIN_SCALE = 0.05; // More zoom out for "infinite" feel
const MAX_SCALE = 10;

export function useCamera() {
  const camera = reactive<Camera>({ x: 0, y: 0, scale: 1 });

  /**
   * Converts a viewport-space point (px from viewport top-left) to world-space px.
   */
  function viewportToWorld(vx: number, vy: number): Point {
    return {
      x: (vx - camera.x) / camera.scale,
      y: (vy - camera.y) / camera.scale,
    };
  }

  /**
   * Converts a world-space point (px) to viewport-space px.
   */
  function worldToViewport(wx: number, wy: number): Point {
    return {
      x: wx * camera.scale + camera.x,
      y: wy * camera.scale + camera.y,
    };
  }

  /**
   * Handles wheel events for pan and zoom.
   */
  function onWheel(event: WheelEvent, rect: DOMRect) {
    event.preventDefault();
    const vx = event.clientX - rect.left;
    const vy = event.clientY - rect.top;

    if (event.ctrlKey || event.metaKey) {
      const factor = event.deltaY < 0 ? 1.05 : 0.95;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * factor));

      // Zoom anchored to the cursor
      camera.x = vx - (vx - camera.x) * (newScale / camera.scale);
      camera.y = vy - (vy - camera.y) * (newScale / camera.scale);
      camera.scale = newScale;
    } else {
      camera.x -= event.deltaX;
      camera.y -= event.deltaY;
    }
  }

  /**
   * Centers the camera on a specific world position.
   */
  function centerOn(wx: number, wy: number, viewportWidth: number, viewportHeight: number) {
    camera.x = viewportWidth / 2 - wx * camera.scale;
    camera.y = viewportHeight / 2 - wy * camera.scale;
  }

  /**
   * Adjusts scale and translation so that all provided world-space points
   * fit inside the viewport with the given padding ratio (0–1).
   */
  function fitAll(
    points: Array<{ wx: number; wy: number }>,
    viewportWidth: number,
    viewportHeight: number,
    padding = 0.15,
  ) {
    if (points.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { wx, wy } of points) {
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wx > maxX) maxX = wx;
      if (wy > maxY) maxY = wy;
    }

    const boundsW = maxX - minX || 1;
    const boundsH = maxY - minY || 1;
    const padW = viewportWidth * padding;
    const padH = viewportHeight * padding;

    const scaleX = (viewportWidth - padW * 2) / boundsW;
    const scaleY = (viewportHeight - padH * 2) / boundsH;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(scaleX, scaleY)));

    const centerWX = (minX + maxX) / 2;
    const centerWY = (minY + maxY) / 2;

    camera.scale = newScale;
    camera.x = viewportWidth / 2 - centerWX * newScale;
    camera.y = viewportHeight / 2 - centerWY * newScale;
  }

  return { camera, viewportToWorld, worldToViewport, onWheel, centerOn, fitAll };
}
