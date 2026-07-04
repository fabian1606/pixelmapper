export const WORLD_WIDTH = 3000;
export const WORLD_HEIGHT = 3000;
export const FIXTURE_RADIUS = 18;
export const STAGE_SIZE_METERS = 12.0; // 3000px / 12m = 250px per meter

/** 3D floor: how far the ground plane must extend past the fixture bounding box, in meters. */
export const FLOOR_MARGIN_METERS = 2.0;
/** 3D floor: never shrinks smaller than this, so an empty/near-empty stage still reads as a stage. */
export const FLOOR_MIN_SIZE_METERS = STAGE_SIZE_METERS;

/** Zoom-tiered snap thresholds — shared concept between the 2D and 3D viewports. */
export const NEAR_ZOOM_SCALE_THRESHOLD = 1.0;
/** Zoomed out ~1/3 further than the initial 0.4 default before the coarse 0.5m grid kicks in. */
export const FAR_ZOOM_SCALE_THRESHOLD = 0.25;
export const NEAR_ZOOM_DISTANCE_METERS = 10.0;
export const FAR_ZOOM_DISTANCE_METERS = 25.0;
/** Coarse "far zoom" snap grid, in meters — shared between 2D (converted to world px) and 3D. */
export const COARSE_SNAP_METERS = 0.5;
