import {
  Fog,
  GridHelper,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
} from 'three';
import { STAGE_SIZE_METERS } from '~/utils/engine/constants';

export interface Stage {
  /** Resizes/recenters the floor + grid to cover a width (world X) × depth (world Z) rect. Cheap: only touches scale/position. */
  update: (width: number, depth: number, centerX: number, centerZ: number) => void;
  dispose: () => void;
}

/**
 * Stage floor: a depth-writing near-black plane (so additive beams get
 * clipped by it) plus a subtle grid. Built once at STAGE_SIZE_METERS and
 * resized live by scaling, so `update()` can be called every frame during a
 * drag without regenerating geometry.
 */
export function buildStage(scene: Scene): Stage {
  const floorGeo = new PlaneGeometry(STAGE_SIZE_METERS, STAGE_SIZE_METERS);
  const floorMat = new MeshBasicMaterial({ color: 0x0a0a0c });
  const floor = new Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.001; // just below the grid to avoid z-fighting
  scene.add(floor);

  const grid = new GridHelper(STAGE_SIZE_METERS, STAGE_SIZE_METERS, 0x333340, 0x1c1c24);
  scene.add(grid);

  scene.fog = new Fog(0x000004, 25, 70);

  const update = (width: number, depth: number, centerX: number, centerZ: number): void => {
    const sx = width / STAGE_SIZE_METERS;
    const sz = depth / STAGE_SIZE_METERS;
    // floor is rotated -90° about X, so its local X/Y axes map to world X/Z
    // (its local Z, left at 1, becomes world height — irrelevant, it's flat).
    floor.scale.set(sx, sz, 1);
    floor.position.x = centerX;
    floor.position.z = centerZ;
    // grid has no rotation: local X/Z map directly to world X/Z.
    grid.scale.set(sx, 1, sz);
    grid.position.x = centerX;
    grid.position.z = centerZ;
  };

  const dispose = (): void => {
    scene.remove(floor, grid);
    floorGeo.dispose();
    floorMat.dispose();
    grid.dispose();
  };

  return { update, dispose };
}
