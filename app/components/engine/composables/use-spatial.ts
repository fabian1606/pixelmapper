import { reactive, computed } from 'vue';
import type { SpatialVector } from '~/utils/engine/types';
import type { Camera, Point } from './use-camera';

/** Default: arrow pointing right, centered, moderate spread */
const DEFAULT_VECTOR: SpatialVector = {
  originX: 0.5,
  originY: 0.5,
  angle: 0,
  magnitude: 0.35,
};

/**
 * Manages the reactive spatial direction vector used to control
 * the direction and fanning of spatial effects in the editor.
 */
export function useSpatial(worldWidth: number, worldHeight: number) {
  const vector = reactive<SpatialVector>({ ...DEFAULT_VECTOR });

  // ─── Computed endpoint in world pixels ─────────────────────────────────────
  const endpointWorld = computed(() => ({
    x: vector.originX * worldWidth + Math.cos(vector.angle) * vector.magnitude * worldWidth,
    y: vector.originY * worldHeight + Math.sin(vector.angle) * vector.magnitude * worldHeight,
  }));

  const originWorld = computed(() => ({
    x: vector.originX * worldWidth,
    y: vector.originY * worldHeight,
  }));

  /**
   * Converts a world-space point to viewport screen space using the camera.
   */
  function toViewport(wx: number, wy: number, camera: Camera): Point {
    return {
      x: wx * camera.scale + camera.x,
      y: wy * camera.scale + camera.y,
    };
  }

  // ─── Handle drag state ───────────────────────────────────────────────────
  let dragOrigin: { mx: number; my: number; angle: number; magnitude: number } | null = null;

  function onHandleDragStart(event: MouseEvent) {
    dragOrigin = {
      mx: event.clientX,
      my: event.clientY,
      angle: vector.angle,
      magnitude: vector.magnitude,
    };
  }

  /**
   * Called on mousemove when the handle is being dragged.
   * Recalculates angle and magnitude from the pointer's world position relative to the origin.
   */
  function onHandleDrag(event: MouseEvent, camera: Camera) {
    if (!dragOrigin) return;

    // Convert viewport mouse position to world space
    const vx = event.clientX;
    const vy = event.clientY;
    const wx = (vx - camera.x) / camera.scale;
    const wy = (vy - camera.y) / camera.scale;

    const ox = vector.originX * worldWidth;
    const oy = vector.originY * worldHeight;

    const dx = wx - ox;
    const dy = wy - oy;

    vector.angle = Math.atan2(dy, dx);
    vector.magnitude = Math.sqrt(dx * dx + dy * dy) / worldWidth; // normalized to world width
  }

  function onHandleDragEnd() {
    dragOrigin = null;
  }

  return {
    vector,
    endpointWorld,
    originWorld,
    toViewport,
    onHandleDragStart,
    onHandleDrag,
    onHandleDragEnd,
  };
}

export type Spatial = ReturnType<typeof useSpatial>;
