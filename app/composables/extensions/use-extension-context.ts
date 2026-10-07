/**
 * `useExtensionContext` — host implementation (ADR §5.2).
 *
 * Gives a component rendered by the extension host its owning extension id,
 * slot id, all inherited scopes, and command execution through history.
 */
import { inject } from 'vue';
import type { Command, ExtensionContext } from '@pixelmapper/extension-api';
import { useHistory } from '~/components/engine/composables/use-history';
import { createCoreCommandFactory } from '~/utils/extensions/core-command-factory';
import { EXTENSION_OWNER_KEY, SLOT_ID_KEY } from './scope-keys';
import { useScopes } from './use-scope';

/** Shared, stateless factory instance. */
let factory: ReturnType<typeof createCoreCommandFactory> | null = null;

/** Hook invoked after an extension runs a command (requires bookkeeping, plan P5.5). */
let afterRunHook: ((extensionId: string | null, command: Command) => void) | null = null;

/** Registers the post-run hook (used by the requires bookkeeping). */
export function setExtensionRunHook(hook: typeof afterRunHook): void {
  afterRunHook = hook;
}

/** Returns the extension context of the calling component. Call during `setup`. */
export function useExtensionContext(): ExtensionContext {
  const extensionId = inject(EXTENSION_OWNER_KEY, null);
  const slotId = inject(SLOT_ID_KEY, null);
  const scopes = useScopes();
  const history = useHistory();
  factory ??= createCoreCommandFactory();

  return {
    extensionId,
    slotId,
    scopes,
    commands: factory,
    run(command: Command) {
      history.execute(command);
      afterRunHook?.(extensionId, command);
    },
  };
}
