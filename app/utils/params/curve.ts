/**
 * Curve param sampling (ADR §6.2). The single implementation lives in the
 * plugin toolchain (it also encodes curve params into their 128-slot LUT);
 * this module re-exports it for app code.
 */
export { CURVE_LUT_SIZE, sampleCurve, sampleCurveLut } from '@pixelmapper/plugin-toolchain/params';
