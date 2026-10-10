/**
 * Modifier cards with plugins that are not known locally (plan P4.5): a
 * spinner while the hash resolves, an error with retry when it fails.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { resetRegistry } from '~/utils/extensions/registry';
import { installSharedGlobals } from '~/utils/extensions/shared-globals';
import { BUILTIN_ALIASES, builtinHash, createModifier } from '~/utils/engine/modifiers';
import { createMemoryCache } from '~/utils/plugins/plugin-cache';
import { configurePluginStore, resolve } from '~/utils/plugins/plugin-store';

beforeAll(() => {
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
  vi.stubGlobal('useRoute', () => ({ params: { id: 'p1' }, path: '/project/p1' }));
  vi.stubGlobal('useSupabaseClient', () => ({}));
  vi.stubGlobal('useSupabaseUser', () => ({ value: null }));
});

beforeEach(() => {
  setActivePinia(createPinia());
  resetRegistry();
  installSharedGlobals();
});

/** Mounts the list with one modifier whose plugin hash is `hash`. */
async function mountWith(hash: string) {
  const List = (await import('./ChaserModifiersList.vue')).default;
  const m = { ...createModifier(builtinHash(BUILTIN_ALIASES.waveform), { targetChannels: ['DIMMER'] }), plugin: hash };
  return mount(List, {
    props: { activeModifiers: [m], activeModifier: null, availableChannelTypes: ['DIMMER'], pinnedModifiers: [], pinnedEffectIds: new Set<string>() },
  });
}

describe('modifier card plugin status', () => {
  it('shows a spinner while resolving and an error with retry on failure', async () => {
    const hash = `sha256:${'cd'.repeat(32)}`;
    configurePluginStore({ remote: null, cache: createMemoryCache() });

    const w = await mountWith(hash);
    expect(w.text()).toContain('Loading plugin');

    await resolve(hash); // fails: offline
    await flushPromises();
    expect(w.text()).toContain('Plugin unavailable');
    expect(w.text()).toContain('Retry');
  });

  it('renders known plugins normally', async () => {
    const w = await mountWith(builtinHash(BUILTIN_ALIASES.waveform));
    expect(w.text()).not.toContain('Loading plugin');
    expect(w.text()).toContain('Profile');
  });

  it('card order: header, params, tempo, distribution; extension slots render (plan M5.6)', async () => {
    const w = await mountWith(builtinHash(BUILTIN_ALIASES.waveform));
    const html = w.html();
    const pos = (sel: string) => html.indexOf(sel);
    expect(pos('data-card-title')).toBeGreaterThan(-1);
    expect(pos('data-param=')).toBeGreaterThan(pos('data-card-title'));
    expect(pos('data-card-tempo')).toBeGreaterThan(pos('data-param='));
    expect(pos('data-distribution-section')).toBeGreaterThan(pos('data-card-tempo'));
    // One channel type → no channel chips.
    expect(pos('data-card-channels')).toBe(-1);
  });
});
