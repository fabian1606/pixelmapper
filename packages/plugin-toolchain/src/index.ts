/**
 * @pixelmapper/plugin-toolchain — compile, instrument, validate and hash
 * content plugins (ADR §6, D25). Isomorphic: Bun, browser, Tauri.
 *
 * Light subpath exports for the app: `./params`, `./curve-shapes`, `./manifest`, `./hash`,
 * `./runtime`, `./types`. The root export pulls in the AssemblyScript
 * compiler; load it lazily (e.g. `await import(...)`) in UI code.
 */
export * from './types';
export * from './params';
export { registerShape, getShape, listShapes, clampArgs, defaultArgs, shapeToPoints, domainX, domainT, BUILTIN_SHAPE_IDS } from './curve-shapes';
export * from './manifest';
export * from './hash';
export * from './runtime';
export * from './ui';
export { compile, ASC_VERSION, COMPILE_FLAGS, type CompileResult, type Diagnostic } from './compile';
export { instrument, type InstrumentResult } from './instrument';
export { validate, type ValidateOptions, type ValidationReport } from './validate';
export { buildPackage, verifyPackage, TOOLCHAIN_ID, TOOLCHAIN_VERSION, type BuildResult } from './build';
