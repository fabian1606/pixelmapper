/**
 * Operations layer (ADR 0002 §4): registry, read API, transaction runner
 * and the core catalog. See `architecture/operations.md`.
 */
export { createOperationRegistry, operations, operationNamespace } from './registry';
export type { CoreOperation, OperationRegistry, RegisterOptions } from './registry';
export { createCoreReadApi, readApi, fixtureInfo, fixtureSignatures } from './read-api';
export type { CoreReadApi, FixtureInfo, GroupInfo } from './read-api';
export { applyOperations, expectationState, undoLabel } from './apply';
export type { ApplyOptions } from './apply';
export { captureState, diffStates, affectedEntities } from './diff';
export { defineCoreOperation } from './define';
export { CORE_OPERATIONS, registerCoreOperations } from './core';
