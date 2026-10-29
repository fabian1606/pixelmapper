import { registerChannelAdapters } from './channels';
import { registerEngineAdapters } from './engine';
import { registerFixtureAdapters } from './fixtures';
import { registerLivePageAdapters } from './live-pages';
import { registerModifierAdapters } from './modifiers';
import { registerPresetAdapters } from './presets';
import { registerSceneAdapters } from './scene';

/**
 * Registers the rebase adapters of every persisted history command and
 * persistent live-op (see `architecture/offline/wp-merge.md`). Idempotent:
 * re-registering replaces adapters with the same functions.
 */
export function registerBuiltinRebaseAdapters(): void {
  registerModifierAdapters();
  registerPresetAdapters();
  registerSceneAdapters();
  registerFixtureAdapters();
  registerChannelAdapters();
  registerLivePageAdapters();
  registerEngineAdapters();
}
