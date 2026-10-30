/**
 * Proportions of the procedural moving-head model, in meters, in the
 * fixture's local frame: origin = center of the base's bottom face (the
 * mounting plane), +Y = away from the base. A hanging fixture is the same
 * model flipped by the fixture's Tilt (180°).
 *
 *            ┌───┐          ← head (cylinder, lens on +Y), pivots on tiltAxisY
 *        ┃   │   │   ┃      ← yoke arms (rotate with pan)
 *        ┗━━━┷━━━┷━━━┛      ← yoke crossbar
 *            ═════          ← pan bearing
 *        ┌───────────┐
 *        └───────────┘      ← base (selection body box)
 *
 * Pure — shared by the scene adapter (base box) and the beam rig (yoke, head).
 */
export interface MovingHeadDims {
  /** Housing width (X), height (Y), depth (Z). */
  width: number;
  height: number;
  depth: number;
  baseHeight: number;
  bearingRadius: number;
  bearingHeight: number;
  /** Yoke crossbar: top face height and size. */
  crossbarTop: number;
  crossbarHeight: number;
  crossbarDepth: number;
  /** Yoke arm thickness (X) / depth (Z) and X offset of the arm centers. */
  armThickness: number;
  armDepth: number;
  armX: number;
  /** Height of the tilt axis above the mounting plane. */
  tiltAxisY: number;
  /** Head cylinder: radius and length along its beam axis. */
  headRadius: number;
  headLength: number;
  /** Lens disc radius on the head's front face. */
  lensRadius: number;
}

/** Median OFL moving head housing (mm) — used when a fixture has no dimensions. */
const DEFAULT_DIMS_MM: [number, number, number] = [296, 389, 243];

/** Clamps a housing extent to a plausible range so broken data can't explode the model. */
function clampExtent(m: number): number {
  return Math.min(2, Math.max(0.08, m));
}

/**
 * Builds the model proportions from the OFL housing size [w, h, d] in mm.
 * Without dimensions the median OFL moving head is used, scaled to
 * `fallbackWidthM` (the fixture footprint) when given.
 */
export function movingHeadDims(dimensionsMm?: [number, number, number], fallbackWidthM?: number): MovingHeadDims {
  let [w, h, d] = (dimensionsMm ?? DEFAULT_DIMS_MM).map(v => v / 1000) as [number, number, number];
  if (!dimensionsMm && fallbackWidthM) {
    const k = fallbackWidthM / w;
    w *= k; h *= k; d *= k;
  }
  const width = clampExtent(w);
  const height = clampExtent(h);
  const depth = clampExtent(d);

  const baseHeight = height * 0.26;
  const bearingHeight = height * 0.03;
  const crossbarHeight = height * 0.06;
  const crossbarTop = baseHeight + bearingHeight + crossbarHeight;
  const armThickness = width * 0.11;
  // Head swings through the space above the crossbar: its half length must
  // clear the crossbar when pointing down and reach the housing top when up.
  const tiltAxisY = (crossbarTop + height) / 2;
  const headLength = (height - crossbarTop) * 0.94;
  // Inner gap between the arms, minus a small clearance.
  const innerHalfGap = width / 2 - armThickness - width * 0.02;
  const headRadius = Math.min(innerHalfGap, depth * 0.48, headLength * 0.45);

  return {
    width,
    height,
    depth,
    baseHeight,
    bearingRadius: Math.min(width, depth) * 0.3,
    bearingHeight,
    crossbarTop,
    crossbarHeight,
    crossbarDepth: Math.min(depth * 0.5, headRadius * 1.6),
    armThickness,
    armDepth: Math.min(depth * 0.5, headRadius * 1.6),
    armX: width / 2 - armThickness / 2,
    tiltAxisY,
    headRadius,
    headLength,
    lensRadius: headRadius * 0.78,
  };
}
