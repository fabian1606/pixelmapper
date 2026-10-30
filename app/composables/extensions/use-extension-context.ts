/**
 * `useExtensionContext` — host implementation (ADR §5.2).
 *
 * Gives a component rendered by the extension host its owning extension id,
 * slot id, all inherited scopes, and command execution through history.
 */
import { getCurrentInstance, inject, onBeforeUnmount } from 'vue';
import type { Command, ExtensionContext, FixtureId, OutputPreview } from '@pixelmapper/extension-api';
import { useHistory } from '~/components/engine/composables/use-history';
import { useEngineStore } from '~/stores/engine-store';
import { createCoreCommandFactory } from '~/utils/extensions/core-command-factory';
import { fixtureView } from '~/utils/extensions/scope-views';
import { runAsExtension } from '~/utils/extensions/fixture-patch-observer';
import { findFixtureInTree } from '~/utils/engine/scene-tree';
import type { SceneNode } from '~/utils/engine/core/group';
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

/**
 * Read-only fixture view by id (reactive through the engine store + model
 * tick). Views are frozen in dev, so the readonly typing is enforced at runtime.
 */
export const getFixture: ExtensionContext['getFixture'] = (id: FixtureId) => {
  // Live tree (tracks `sceneNodes` like `flatFixtures`, but is never stale
  // right after a command added a fixture).
  const fixture = findFixtureInTree(useEngineStore().sceneNodes as SceneNode[], id);
  return fixture ? (fixtureView(fixture) as unknown as ReturnType<ExtensionContext['getFixture']>) : undefined;
};

/**
 * Output preview backed by the engine store's DMX override map. Tracks what
 * it set so `clear()` (and unmount) only removes its own values.
 */
function createOutputPreview(): OutputPreview {
  const owned = new Set<number>();
  const store = () => useEngineStore();
  return {
    setChannel(fixtureId, channelIndex, dmxValue) {
      const fixture = store().flatFixtures.find(f => f.id === fixtureId);
      const ch = fixture?.channels[channelIndex];
      if (!fixture || !ch) return;
      const idx = fixture.startAddress - 1 + ch.addressOffset;
      store().setOverride(idx, Math.max(0, Math.min(255, Math.round(dmxValue))));
      owned.add(idx);
    },
    clear() {
      for (const idx of owned) store().clearOverride(idx);
      owned.clear();
    },
  };
}

/** Returns the extension context of the calling component. Call during `setup`. */
export function useExtensionContext(): ExtensionContext {
  const extensionId = inject(EXTENSION_OWNER_KEY, null);
  const slotId = inject(SLOT_ID_KEY, null);
  const scopes = useScopes();
  const history = useHistory();
  // Per-extension factory so `setExtensionData` defaults to the caller's id.
  const commands = extensionId ? createCoreCommandFactory(extensionId) : (factory ??= createCoreCommandFactory());

  const preview = createOutputPreview();
  if (getCurrentInstance()) onBeforeUnmount(() => preview.clear());

  return {
    extensionId,
    slotId,
    scopes,
    commands,
    getFixture,
    preview,
    run(command: Command) {
      // Attributed to the extension for patch observers (`initiator`, plan M4.6).
      runAsExtension(extensionId, () => history.execute(command));
      afterRunHook?.(extensionId, command);
    },
  };
}
