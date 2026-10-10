/**
 * Curve shape registry for app code (plan M1.6). The single registry lives in
 * the plugin toolchain (it also samples curve params into their LUT on the
 * wire); extension shapes are registered into it on activation.
 */
export {
  BUILTIN_SHAPE_IDS,
  clampArgs,
  defaultArgs,
  domainT,
  domainX,
  evaluateCurve,
  getShape,
  listShapes,
  registerShape,
  sampleCurveLut,
  shapeToPoints,
} from '@pixelmapper/plugin-toolchain/curve-shapes';
