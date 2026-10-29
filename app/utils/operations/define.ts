/**
 * Typed helper for core operation definitions.
 *
 * Keeps the Zod input/output types inside `run` / `verify` while producing
 * the erased `CoreOperation` the registry stores.
 */
import type { OperationDefinition } from '@pixelmapper/agent-kit';
import type { z } from 'zod';
import type { Command } from '~/components/engine/composables/use-history';
import type { CoreReadApi } from './read-api';
import type { CoreOperation } from './registry';

/** Defines a core operation (read API = `CoreReadApi`, commands = app `Command`). */
export function defineCoreOperation<I extends z.ZodType, O extends z.ZodType>(
  def: OperationDefinition<I, O, CoreReadApi, Command>,
): CoreOperation {
  return def as unknown as CoreOperation;
}
