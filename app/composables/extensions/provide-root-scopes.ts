/**
 * Provides the global scopes (`project`, `selection`, `viewport`) at the app
 * root from the engine store (ADR §5.2).
 */
import { shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { storeToRefs } from 'pinia';
import type { ProjectRequirement } from '@pixelmapper/extension-api';
import { useEngineStore } from '~/stores/engine-store';
import { selectionView, viewportView, type PageViewportMode } from '~/utils/extensions/scope-views';
import { provideScope } from './provide-scope';

/** Viewport mode of the project page's mode switcher (set by that page). */
const pageViewportMode = shallowRef<PageViewportMode>('2d');

/** Called by the project page when its viewport mode changes. */
export function setPageViewportMode(mode: PageViewportMode): void {
  pageViewportMode.value = mode;
}

/** Project dependencies; maintained by the requires bookkeeping (plan P5.5). */
export const projectRequires = shallowRef<ProjectRequirement[]>([]);

/** Provides the global scopes. Call once in `app.vue` setup. */
export function provideRootScopes(): void {
  const engineStore = useEngineStore();
  const { currentProjectId, selectedIds, sceneNodes } = storeToRefs(engineStore);
  const route = useRoute();

  provideScope('project', () => ({
    id: currentProjectId.value,
    // The project name is not loaded into the engine store yet.
    name: '',
    bpm: engineStore.engine.globalBpm.value,
    requires: projectRequires.value.map(r => ({ ...r })),
  }));

  provideScope('selection', () => selectionView(selectedIds.value, sceneNodes.value));

  provideScope('viewport', () => viewportView(pageViewportMode.value, route.path));
}
