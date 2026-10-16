/**
 * Integration test for plan P1.6: mounts the core UI migrated onto layout
 * primitives with the dev-only `_debug-slots` extension registered and
 * checks that the expected slot ids are rendered.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderedSlots } from '~/utils/extensions/slot-matching';
import { defineComponent, h, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import debugSlots from '~~/extensions/_debug-slots/extension';
import { resetRegistry } from '~/utils/extensions/registry';
import { installSharedGlobals } from '~/utils/extensions/shared-globals';
import { Fixture } from '~/utils/engine/core/fixture';
import { BUILTIN_ALIASES, builtinHash, createModifier } from '~/utils/engine/modifiers';

// ── Slot catalog (plan P7.2) ────────────────────
// With PM_COLLECT_SLOTS=1 the slots rendered by these mounts (and their
// scopes) are written for `scripts/generate-ai-docs.ts`.
afterAll(() => {
  if (process.env.PM_COLLECT_SLOTS !== '1') return;
  mkdirSync('docs/ai', { recursive: true });
  const slots = Object.fromEntries([...renderedSlots.entries()].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync('docs/ai/.slots.collected.json', JSON.stringify(slots, null, 2));
});

// ── Environment stubs ───────────────────────────
beforeAll(() => {
  // EffectEngine spawns a worker in the browser; not needed here.
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
  // Nuxt auto-imports used by some components.
  vi.stubGlobal('useRoute', () => ({ params: { id: 'p1' }, path: '/project/p1' }));
  vi.stubGlobal('useSupabaseClient', () => ({}));
  vi.stubGlobal('useSupabaseUser', () => ({ value: null }));
});

beforeEach(() => {
  setActivePinia(createPinia());
  resetRegistry();
  installSharedGlobals();
  globalThis.__PIXELMAPPER_SHARED__!.api.registerExtension(debugSlots);
});

/** Slot ids rendered by the debug label, in document order. */
function slotIds(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('span[title^="scopes:"]')].map(e => e.textContent!.trim());
}

/** Scopes listed in the label of a slot id. */
function scopesOf(html: string, slotId: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const el = [...doc.querySelectorAll('span[title^="scopes:"]')].find(e => e.textContent!.trim() === slotId);
  return el?.getAttribute('title') ?? '';
}

/** A DRGB test fixture. */
function makeFixture(id: string): Fixture {
  const f = Fixture.createRGBFixture(id);
  f.name = `Par ${id}`;
  return f;
}

const NuxtLink = defineComponent({ props: ['to'], setup: (_, { slots }) => () => h('a', slots.default?.()) });
const global = { stubs: { NuxtLink, ClientOnly: true } };

describe('P1.6 debug-slots labels', () => {
  it('scene sidebar: panel header and fixture rows', async () => {
    const { SidebarProvider } = await import('@/components/ui/sidebar');
    const FixtureSidebar = (await import('~/components/engine/FixtureSidebar.vue')).default;
    const fixture = makeFixture('a');
    const w = mount(() => h(SidebarProvider, () => h(FixtureSidebar, {
      nodes: [fixture], selectedIds: new Set<string | number>(), fixtures: [fixture], effects: [],
    })), { global, attachTo: document.body });
    await flushPromises();
    const ids = slotIds(w.html());
    expect(ids).toContain('scene:header');
    expect(ids).toContain('scene/fixture:actions');
    expect(scopesOf(w.html(), 'scene/fixture:actions')).toContain('fixture');
    w.unmount();
  });

  it('properties sidebar: section actions and channel rows', async () => {
    const { useEngineStore } = await import('~/stores/engine-store');
    const store = useEngineStore();
    const FixturePropertiesSidebar = (await import('~/components/engine/FixturePropertiesSidebar.vue')).default;
    const fixture = makeFixture('b');
    const w = mount(FixturePropertiesSidebar, {
      props: { selectedIds: new Set([fixture.id]), fixtures: [fixture], nodes: [fixture] },
      global: { ...global, provide: { effectEngine: store.engine } },
      attachTo: document.body,
    });
    (w.vm as unknown as { openTab: (t: string) => void }).openTab('color');
    await nextTick();
    await flushPromises();
    const ids = slotIds(w.html());
    expect(ids).toContain('properties:header');
    expect(ids).toContain('properties/color:actions');
    expect(ids).toContain('properties/color/channel:actions');
    const channelScopes = scopesOf(w.html(), 'properties/color/channel:actions');
    expect(channelScopes).toContain('channel');
    expect(channelScopes).toContain('signature');
    expect(channelScopes).toContain('fixture');
    w.unmount();
  });

  it('modifier list: modifier rows', async () => {
    const ChaserModifiersList = (await import('~/components/engine/ChaserModifiersList.vue')).default;
    const effect = createModifier(builtinHash(BUILTIN_ALIASES.waveform), { targetChannels: ['DIMMER'] });
    const w = mount(ChaserModifiersList, {
      props: {
        activeModifiers: [effect], activeModifier: null, availableChannelTypes: ['DIMMER'],
        pinnedModifiers: [], pinnedEffectIds: new Set<string>(),
      },
      global,
    });
    await flushPromises();
    expect(slotIds(w.html())).toEqual(expect.arrayContaining(['modifiers:header', 'modifiers/modifier:actions']));
    expect(scopesOf(w.html(), 'modifiers/modifier:actions')).toContain('modifier');
  });

  it('library browser: panel + category menu items', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => []));
    const FixtureLibraryBrowser = (await import('~/components/engine/FixtureLibraryBrowser.vue')).default;
    const w = mount(FixtureLibraryBrowser, { global });
    await flushPromises();
    expect(slotIds(w.html())).toContain('library:header');
    expect(w.text()).toContain('Debug: log scopes');
  });
});
