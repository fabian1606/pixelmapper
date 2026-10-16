/**
 * Runtime extension loader (plan P6.6): version choice, caching, blob-URL
 * import with shared globals, registration, install/uninstall.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getExtension, resetRegistry } from './registry';
import { installSharedGlobals } from './shared-globals';
import { createMemoryBundleCache } from './extension-cache';
import type { ExtensionSource } from './extension-sources';
import { configureLoader, installExtension, listInstalled, localInstalledStore, pickVersion, startLoading, uninstallExtension } from './loader';

/** A minimal bundle as the extension builder emits it. */
function bundleJs(id: string, version: string): string {
  return `const s = globalThis.__PIXELMAPPER_SHARED__;
const { defineExtension } = s.api;
export default defineExtension({ id: ${JSON.stringify(id)}, version: ${JSON.stringify(version)}, apiVersion: '^1.0.0', displayName: 'T', description: 'Loaded from a bundle.', contributes: {} });`;
}

/** Fake source with two versions. */
function fakeSource(): ExtensionSource & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    list: async () => ['1.0.0', '1.4.0', '2.0.0'].map(v => ({ id: 'demo', version: v, apiVersion: '^1.0.0', displayName: 'Demo', description: 'd', source: 'catalog' as const })),
    fetch: async (id, version) => { fetched.push(version); return { js: bundleJs(id, version), css: '.demo{color:red}', info: {} }; },
  };
}

beforeEach(() => {
  resetRegistry();
  installSharedGlobals();
  localStorage.clear();
  document.head.querySelectorAll('style[data-pm-extension]').forEach(e => e.remove());
  // happy-dom cannot import blob: URLs; serve them as data URLs instead.
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => `data:text/javascript;base64,${Buffer.from((b as unknown as { __text: string }).__text ?? '').toString('base64')}`);
  const RealBlob = globalThis.Blob;
  vi.stubGlobal('Blob', class extends RealBlob { __text: string; constructor(parts: BlobPart[], o?: BlobPropertyBag) { super(parts, o); this.__text = parts.map(String).join(''); } });
});

describe('extension loader', () => {
  it('picks the highest satisfying version', () => {
    expect(pickVersion(['1.0.0', '1.4.0', '2.0.0'], '^1.0')).toBe('1.4.0');
    expect(pickVersion(['1.0.0'], '^2')).toBeNull();
  });

  it('loads installed bundles, injects CSS and caches them', async () => {
    const source = fakeSource();
    const cache = createMemoryBundleCache();
    const installed = localInstalledStore('u');
    await installed.set([{ id: 'demo', versionRange: '^1.0' }]);
    configureLoader({ cache, sources: [source], installed });

    const results = await startLoading();
    expect(results).toEqual([{ id: 'demo', version: '1.4.0', status: 'loaded' }]);
    expect(getExtension('demo')?.source).toBe('bundle');
    expect(document.head.querySelector('style[data-pm-extension="demo@1.4.0"]')?.textContent).toContain('red');
    expect(await cache.versions('demo')).toEqual(['1.4.0']);
  });

  it('reports missing versions instead of failing boot', async () => {
    const installed = localInstalledStore('u');
    await installed.set([{ id: 'demo', versionRange: '^3' }]);
    configureLoader({ cache: createMemoryBundleCache(), sources: [fakeSource()], installed });
    expect((await startLoading())[0]!.status).toBe('missing');
  });

  it('installs (pinning ^major.minor) and uninstalls with a reload', async () => {
    const reload = vi.fn();
    configureLoader({ cache: createMemoryBundleCache(), sources: [fakeSource()], installed: localInstalledStore('u'), reload });
    expect(await installExtension('demo')).toBe(true);
    expect(await listInstalled()).toEqual([{ id: 'demo', versionRange: '^2.0' }]);
    await uninstallExtension('demo');
    expect(await listInstalled()).toEqual([]);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
