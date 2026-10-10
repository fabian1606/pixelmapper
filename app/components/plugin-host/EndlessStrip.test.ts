/**
 * Endless strip (plan M5.4): a canvas for scalar/rgb, nothing for panTilt,
 * paused while off-screen.
 */
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { ModifierInstance } from '~/utils/engine/types';
import EndlessStrip from './EndlessStrip.vue';

const inst = (signature: ModifierInstance['signature']) => ({ id: 's', plugin: 'sha256:x', signature, distribution: {}, speed: {} }) as unknown as ModifierInstance;

describe('EndlessStrip', () => {
  it('renders a strip for scalar and rgb, none for panTilt', () => {
    setActivePinia(createPinia());
    expect(mount(EndlessStrip, { props: { modifier: inst('scalar') } }).find('[data-endless-strip]').exists()).toBe(true);
    expect(mount(EndlessStrip, { props: { modifier: inst('rgb') } }).find('[data-endless-strip]').exists()).toBe(true);
    expect(mount(EndlessStrip, { props: { modifier: inst('panTilt') } }).find('[data-endless-strip]').exists()).toBe(false);
  });

  it('pauses when off-screen', () => {
    let cb: ((e: { isIntersecting: boolean }[]) => void) | null = null;
    vi.stubGlobal('IntersectionObserver', class { constructor(f: typeof cb) { cb = f; } observe() {} disconnect() {} });
    const w = mount(EndlessStrip, { props: { modifier: inst('scalar') } });
    cb!([{ isIntersecting: false }]);
    expect((w.vm as unknown as { visible: boolean }).visible).toBe(false);
    vi.unstubAllGlobals();
  });
});
