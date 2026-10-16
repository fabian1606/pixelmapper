// @vitest-environment node
/**
 * Extension bundles (plan P6.5): a first-party extension builds into an ESM
 * bundle without bare imports, whose manifest registers with the host.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildExtension, sharedModulesPlugin, summarizeManifest } from './index';

const out = await mkdtemp(join(tmpdir(), 'pm-ext-'));
afterAll(() => rm(out, { recursive: true, force: true }));

describe('shared modules', () => {
  it('re-exports host modules with named exports', () => {
    const plugin = sharedModulesPlugin({ vue: ['ref', 'computed', 'default'] });
    const id = (plugin.resolveId as (id: string) => string | null)('vue')!;
    const code = (plugin.load as (id: string) => string)(id);
    expect(code).toContain('globalThis.__PIXELMAPPER_SHARED__');
    expect(code).toContain('export const ref = m["ref"];');
    expect(code).not.toContain('export const default');
    expect((plugin.resolveId as (id: string) => string | null)('lodash')).toBeNull();
  });

  it('summarizes manifests without components', () => {
    const info = summarizeManifest({ id: 'x', version: '1.0.0', apiVersion: '^1.0.0', displayName: 'X', description: 'd', contributes: { fixtureKinds: [{ id: 'k', version: '1.0.0', label: 'K', requiredWhenUsed: false }] } }, { js: 'index.js', css: null });
    expect(info.contributes.fixtureKinds).toEqual([{ id: 'k', version: '1.0.0', label: 'K', requiredWhenUsed: false }]);
  });
});

describe('buildExtension', () => {
  it('bundles neopixel-strip with shared imports and metadata', async () => {
    const info = await buildExtension({ root: join(import.meta.dirname, '../../../extensions/neopixel-strip'), outDir: out, minify: false });
    expect(info.id).toBe('neopixel-strip');
    expect(info.contributes.fixtureKinds[0]!.id).toBe('neopixel-strip');
    const js = await readFile(join(out, 'neopixel-strip', info.version, 'index.js'), 'utf8');
    expect(js).not.toMatch(/from\s*["'](vue|pinia|@pixelmapper\/extension-api)["']/);

    // Load like the runtime loader: host modules on the shared global.
    (globalThis as Record<string, unknown>).__PIXELMAPPER_SHARED__ = { vue: await import('vue'), pinia: await import('pinia'), api: await import('@pixelmapper/extension-api') };
    const manifest = (await import(pathToFileURL(join(out, 'neopixel-strip', info.version, 'index.js')).href)).default;
    expect(manifest.contributes.fixtureKinds[0].build({ ledCount: 3, ledsPerMeter: 3, groupSize: 1, shapeType: 'line', points: [] }, { pixelsPerMeter: 250, worldWidth: 3000, worldHeight: 3000, fixtureId: 'f' }).beams).toHaveLength(3);
  }, 60_000);
});
