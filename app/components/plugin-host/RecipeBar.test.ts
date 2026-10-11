/**
 * Preset row (plan M5.2, review): active name, "modified" with revert, the
 * list with 2D badges, hover previews without applying, click applies.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { markRaw } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { BUILTIN_ALIASES, builtinHash, createModifier } from '~/utils/engine/modifiers';
import { getManifest } from '~/utils/plugins/plugin-store';
import type { ModifierInstance } from '~/utils/engine/types';
import RecipeBar from './RecipeBar.vue';

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { document.body.innerHTML = ''; });

const hash = builtinHash(BUILTIN_ALIASES.waveform);
// Raw like in the app (the plugin store's manifests are never made reactive).
const manifest = markRaw(getManifest(hash)!);
const wave = (patch: Partial<ModifierInstance> = {}) => ({ ...createModifier(hash, { targetChannels: ['DIMMER'] }), ...patch });

describe('preset row', () => {
  it('names the active recipe; after an edit shows "modified" and reverts to it', async () => {
    const m = wave();
    const w = mount(RecipeBar, { props: { modifier: m, manifest } });
    expect(w.find('[data-recipe-active]').text()).toBe('Chase');
    expect(w.find('[data-recipe-modified]').exists()).toBe(false);
    await w.setProps({ modifier: { ...m, params: { ...m.params, profile: { shape: 'dot', args: { width: 0.4 } } } } });
    expect(w.find('[data-recipe-active]').text()).toBe('Chase');
    expect(w.find('[data-recipe-modified]').exists()).toBe(true);
    await w.find('[data-recipe-revert]').trigger('click');
    const [next, preset] = w.emitted('apply')!.at(-1)! as [ModifierInstance, { id: string }];
    expect(preset.id).toBe('chase');
    expect(next.params.profile).toEqual(manifest.presets!.find(p => p.id === 'chase')!.params.profile);
  });

  it('the list previews on hover, marks 2D recipes and applies on click', async () => {
    const w = mount(RecipeBar, { props: { modifier: wave(), manifest }, attachTo: document.body });
    await w.find('[data-recipe-trigger]').trigger('click');
    await flushPromises();
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-recipe]'));
    expect(items.map(e => e.dataset.recipe)).toEqual(manifest.presets!.map(p => p.id));
    const sweep = items.find(e => e.dataset.recipe === 'sweep')!;
    expect(sweep.textContent).toContain('2D');
    expect(items.find(e => e.dataset.recipe === 'chase')!.textContent).not.toContain('2D');
    sweep.dispatchEvent(new Event('pointerenter'));
    expect((w.emitted('preview')!.at(-1)![0] as ModifierInstance).distribution.mode).toBe('linear');
    expect(w.emitted('apply')).toBeUndefined();
    sweep.click();
    await flushPromises();
    expect((w.emitted('apply')!.at(-1)![1] as { id: string }).id).toBe('sweep');
    expect(w.emitted('preview')!.at(-1)![0]).toBeNull();
    w.unmount();
  });
});
