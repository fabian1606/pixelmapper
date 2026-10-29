/**
 * Core operation catalog (ADR 0002 §4.2, amended by B3; plan A1.4).
 */
import { operations, type CoreOperation, type OperationRegistry } from '../registry';
import { channelOperations } from './channels';
import { fixtureOperations } from './fixtures';
import { liveOperations } from './live';
import { modifierOperations } from './modifiers';
import { pluginOperations } from './plugins';
import { projectOperations } from './project';
import { sceneOperations } from './scene';

/** Every core operation. */
export const CORE_OPERATIONS: readonly CoreOperation[] = [
  ...projectOperations,
  ...fixtureOperations,
  ...sceneOperations,
  ...channelOperations,
  ...modifierOperations,
  ...pluginOperations,
  ...liveOperations,
];

/** Registers the core catalog (idempotent: already registered ids are skipped). */
export function registerCoreOperations(registry: OperationRegistry = operations): OperationRegistry {
  for (const def of CORE_OPERATIONS) {
    if (!registry.has(def.id)) registry.register(def);
  }
  return registry;
}
