// @vitest-environment node
/**
 * `.pmproject` archives (plan P6.8): plugins and extension bundles travel
 * with the snapshot; import verifies plugins and caches bundles.
 */
import { describe, expect, it } from 'vitest';
import { buildFromCode, TEMPLATE_MANIFEST, TEMPLATE_SOURCE } from '~/utils/plugins/create-plugin';
import { configureLoader, listAvailableExtensions } from '~/utils/extensions/loader';
import { createMemoryBundleCache } from '~/utils/extensions/extension-cache';
import { BUILTIN_PLUGINS } from '~/utils/plugins/builtin-index';
import type { ProjectSnapshot } from '~/utils/engine/serialize';
import { buildProjectArchive, readProjectArchive, referencedPluginHashes } from './project-archive';
import { importArchive } from './project-transfer';

/** Minimal snapshot referencing two plugins. */
function snapshot(custom: string): ProjectSnapshot {
  return {
    schemaVersion: 2, sceneNodes: [], savedPresets: [], pinnedModifiers: [], globalBases: {},
    modifiers: [{ plugin: custom } as never, { plugin: BUILTIN_PLUGINS[0]!.hash } as never],
    requires: [{ id: 'demo', version: '^1.0' }],
  };
}

describe('project archives', () => {
  it('finds plugin hashes anywhere in a snapshot', () => {
    const h = `sha256:${'a'.repeat(64)}`;
    expect([...referencedPluginHashes({ a: [{ b: h }], c: 'x' })]).toEqual([h]);
  });

  it('round-trips snapshot, plugins and bundles; import rebuilds and caches', async () => {
    const built = await buildFromCode({ manifest: { ...TEMPLATE_MANIFEST, name: 'Archived' }, source: { 'modifier.ts': TEMPLATE_SOURCE } });
    const pkg = built.pkg!;
    const bundle = { key: 'demo@1.2.0', id: 'demo', version: '1.2.0', js: 'export default {}', css: '.x{}', info: { displayName: 'Demo' } };
    const bytes = buildProjectArchive({ name: 'Show', snapshot: snapshot(pkg.hash), plugins: [pkg], bundles: [bundle] });

    const read = readProjectArchive(bytes);
    expect(read.project.name).toBe('Show');
    expect(read.plugins.map(p => p.hash)).toEqual([pkg.hash]);
    expect(read.bundles).toEqual([bundle]);

    const cache = createMemoryBundleCache();
    configureLoader({ cache, sources: [] });
    const imported = await importArchive(bytes);
    expect(imported.pluginErrors).toEqual({});
    expect(imported.cachedExtensions).toEqual(['demo@1.2.0']);
    expect((await listAvailableExtensions()).map(l => [l.id, l.source])).toEqual([['demo', 'cache']]);
  }, 60_000);

  it('rejects files that are not archives', () => {
    expect(() => readProjectArchive(new Uint8Array([1, 2, 3]))).toThrow(/not a zip/);
  });
});
