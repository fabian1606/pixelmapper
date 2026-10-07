/**
 * Host side of extension registration (ADR §5.8, D21): an extension's
 * serializable commands join the core command registry (so they replay from
 * the change log and sync to collaborators), and its optional `activate`
 * hook runs once with the extension API.
 */
import type { Command, ExtensionApi } from '@pixelmapper/extension-api';
import { registerCommand } from '~/components/engine/commands/serializable-command';
import { useHistory } from '~/components/engine/composables/use-history';
import { getFixture } from '~/composables/extensions/use-extension-context';
import { createCoreCommandFactory } from './core-command-factory';
import { onExtensionRegistered, type RegisteredExtension } from './registry';

/** Disposers returned by `activate`, by extension id. */
const disposers = new Map<string, () => void>();

/** Registers commands and runs `activate` for one extension. */
export function activateExtension({ manifest }: RegisteredExtension): void {
  const commands = createCoreCommandFactory(manifest.id);
  for (const def of manifest.contributes?.commands ?? []) {
    registerCommand(def.type, payload => def.fromPayload(payload, {
      extensionId: manifest.id,
      getFixture: id => getFixture(id) as never,
      commands,
    }) as never);
  }
  if (manifest.activate && !disposers.has(manifest.id)) {
    const api: ExtensionApi = {
      extensionId: manifest.id,
      commands,
      run: (command: Command) => useHistory().execute(command as never),
    };
    const dispose = manifest.activate(api);
    disposers.set(manifest.id, typeof dispose === 'function' ? dispose : () => {});
  }
}

let installed = false;

/** Installs the hook (idempotent; called with the shared globals). */
export function installActivation(): void {
  if (installed) return;
  installed = true;
  onExtensionRegistered(activateExtension);
}
