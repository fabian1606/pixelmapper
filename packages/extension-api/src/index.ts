/**
 * @pixelmapper/extension-api
 *
 * The only module an extension may import besides `vue`, `pinia` and its own
 * files. Contains types, `define*` identity helpers and declared composables
 * whose implementation the host provides at runtime via
 * `globalThis.__PIXELMAPPER_SHARED__.api`.
 *
 * Spec: architecture/adr/0001-extension-and-content-plugin-system.md §5.
 */
export * from './model';
export * from './params';
export * from './scopes';
export * from './slots';
export * from './replaceables';
export * from './live';
export * from './kinds';
export * from './connectors';
export * from './commands';
export * from './manifest';
export { getHostApi } from './host';
export type { HostApi, SharedGlobals } from './host';
