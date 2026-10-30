/**
 * Shared Vitest helpers for operation tests (not a test file itself).
 *
 * Mirrors the store setup of `app/utils/extensions/requires.test.ts`: a
 * fresh Pinia per test, a stubbed engine `Worker`, no Supabase / network.
 * The engine is never initialized, so commands only touch store state.
 */
import { vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { useEngineStore } from '~/stores/engine-store';
import { Beam } from '~/utils/engine/core/beam';
import { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import { clearHistory } from '~/components/engine/composables/use-history';
import { captureState } from './diff';
import { createCoreReadApi } from './read-api';
import { createOperationRegistry, type CoreOperation, type OperationRegistry } from './registry';

/** Stubs browser/Nuxt globals the stores touch. Call in `beforeAll`. */
export function stubOperationGlobals(): void {
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
  vi.stubGlobal('useSupabaseClient', () => ({}));
  vi.stubGlobal('useSupabaseUser', () => ref(null));
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { supabase: { url: 'http://localhost' } } }));
  vi.stubGlobal('useRouter', () => ({ push: vi.fn(), currentRoute: ref({ path: '/' }) }));
  vi.stubGlobal('useRoute', () => ({ path: '/', params: {}, query: {} }));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
}

/** Fresh Pinia + empty history. Call in `beforeEach`. */
export function resetOperationState(): void {
  setActivePinia(createPinia());
  clearHistory();
}

/** Fixture spec for `seedScene`. */
export interface FixtureSpec {
  id: string;
  name?: string;
  x?: number;
  y?: number;
  z?: number;
}

/**
 * Puts RGB fixtures (DRGB channels: RED, GREEN, BLUE, DIMMER) into the
 * engine store. `groups` wraps fixtures into groups by id.
 */
export function seedScene(fixtures: FixtureSpec[], groups: { id: string; name: string; fixtureIds: string[] }[] = []): Fixture[] {
  const store = useEngineStore();
  const made = fixtures.map((spec, i) => {
    const f = Fixture.createRGBFixture(spec.id);
    f.name = spec.name ?? spec.id;
    f.fixturePosition = { x: spec.x ?? (i + 1) / (fixtures.length + 1), y: spec.y ?? 0.5 };
    f.positionZ = spec.z ?? 0;
    f.startAddress = 1 + i * 4;
    return f;
  });
  const grouped = new Set<string>();
  const nodes: SceneNode[] = [];
  for (const g of groups) {
    const group = new FixtureGroup(g.id, g.name);
    for (const id of g.fixtureIds) {
      const f = made.find(m => m.id === id);
      if (f) {
        group.addChild(f);
        grouped.add(id);
      }
    }
    nodes.push(group);
  }
  for (const f of made) if (!grouped.has(String(f.id))) nodes.push(f);
  store.sceneNodes = nodes;
  return made;
}

/** Comparable JSON of the diffable project state (fixtures, modifiers, live, bpm). */
export function stateFingerprint(): string {
  return JSON.stringify([...captureState(createCoreReadApi())]);
}

/** Registry with only the given operations. */
export function registryWith(...defs: CoreOperation[]): OperationRegistry {
  const registry = createOperationRegistry();
  for (const d of defs) registry.register(d);
  return registry;
}

/**
 * A pixel bar (RGB per pixel) whose heads run along its local +x axis:
 * head 0 on the left at rotation 0. Channels start at address 1.
 */
export function makeBarFixture(id: string, x: number, y: number, rotation = 0, pixels = 4): Fixture {
  const f = new Fixture(id, [], 1);
  f.name = id;
  f.fixturePosition = { x, y };
  f.fixtureSize = { x: pixels, y: 1 };
  f.rotation = rotation;
  f.beams = Array.from({ length: pixels }, (_, i) => new Beam(`b${i}`, (i + 0.5) / pixels - 0.5, 0));
  f.channels = f.beams.flatMap((b, i) => (['RED', 'GREEN', 'BLUE'] as const).map((type, c) => ({
    type, addressOffset: i * 3 + c, role: 'COLOR' as const, colorValue: '#ffffff', defaultValue: 0, beamId: b.id,
  }))) as Fixture['channels'];
  return f;
}
