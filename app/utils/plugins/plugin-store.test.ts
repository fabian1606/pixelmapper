// @vitest-environment node
/**
 * Plugin store (plan P4.2): resolution order, integrity and source
 * verification, publishing and listings — against an in-memory cache and a
 * fake remote.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildPackage, type ContentPluginManifest, type ContentPluginPackage } from '@pixelmapper/plugin-toolchain';
import { BUILTIN_PLUGINS } from './builtin-index';
import { createMemoryCache } from './plugin-cache';
import type { PluginRemote, RemotePluginInfo } from './plugin-remote';
import { configurePluginStore, getManifest, listAvailable, publish, resolve, resolveErrors } from './plugin-store';

const SOURCE = `
import { Modifier, Frame, Sample, Out, register, fract } from "@pixelmapper/plugin-sdk";
class Saw extends Modifier { render(ctx: Frame, s: Sample, out: Out): void { out.setScalar(fract(s.phase) * 2.0 - 1.0); } }
register(new Saw());
`;

/** Builds a distinct package per name. */
async function pkg(name: string): Promise<ContentPluginPackage> {
  const manifest: ContentPluginManifest = {
    schema: 1, kind: 'modifier', alias: '@test/saw', name, version: '1.0.0', apiVersion: '^1.0.0',
    description: 'Sawtooth test modifier.', signatures: ['scalar'], output: 'bipolar', params: [],
  };
  const res = await buildPackage(manifest, { 'modifier.ts': SOURCE });
  if (!res.pkg) throw new Error(res.diagnostics.map(d => d.message).join('\n'));
  return res.pkg;
}

/** Fake remote holding packages with owners. */
function fakeRemote(me: string) {
  const rows = new Map<string, { pkg: ContentPluginPackage; ownerId: string; visibility: RemotePluginInfo['visibility']; projectId: string | null }>();
  const remote: PluginRemote = {
    userId: async () => me,
    fetch: vi.fn(async (hash: string) => {
      const r = rows.get(hash);
      return r ? { ...r.pkg, ownerId: r.ownerId } : null;
    }),
    publish: vi.fn(async (p, visibility, projectId) => {
      rows.set(p.hash, { pkg: p, ownerId: me, visibility, projectId: projectId ?? null });
    }),
    findByAlias: async alias => [...rows.values()].filter(r => r.pkg.manifest.alias === alias).map(r => ({
      hash: r.pkg.hash, manifest: r.pkg.manifest, ownerId: r.ownerId, visibility: r.visibility, projectId: r.projectId, createdAt: null,
    })),
    list: async () => [...rows.values()].map(r => ({
      hash: r.pkg.hash, manifest: r.pkg.manifest, ownerId: r.ownerId, visibility: r.visibility, projectId: r.projectId, createdAt: null,
    })),
  };
  return { remote, rows };
}

let a: ContentPluginPackage, b: ContentPluginPackage, c: ContentPluginPackage, d: ContentPluginPackage;

beforeAll(async () => {
  [a, b, c, d] = await Promise.all(['A', 'B', 'C', 'D'].map(pkg)) as [ContentPluginPackage, ContentPluginPackage, ContentPluginPackage, ContentPluginPackage];
}, 60_000);

describe('plugin store', () => {
  it('resolves own remote packages without recompiling and caches them', async () => {
    const cache = createMemoryCache();
    const verify = vi.fn(async () => ({ ok: true }));
    const { remote, rows } = fakeRemote('me');
    rows.set(a.hash, { pkg: a, ownerId: 'me', visibility: 'private', projectId: null });
    configurePluginStore({ remote, cache, verify });

    const known = await resolve(a.hash);
    expect(known?.manifest.name).toBe('A');
    expect(getManifest(a.hash)?.name).toBe('A');
    expect(verify).not.toHaveBeenCalled();
    expect(await cache.get(a.hash)).not.toBeNull();
  });

  it('recompiles foreign packages and rejects mismatches', async () => {
    const { remote, rows } = fakeRemote('me');
    rows.set(b.hash, { pkg: b, ownerId: 'other', visibility: 'public', projectId: null });
    const verify = vi.fn(async () => ({ ok: false, error: 'hash mismatch' }));
    configurePluginStore({ remote, cache: createMemoryCache(), verify });

    expect(await resolve(b.hash)).toBeNull();
    expect(verify).toHaveBeenCalledOnce();
    expect(resolveErrors.value.get(b.hash)).toBe('hash mismatch');
  });

  it('rejects packages whose bytes do not match the hash', async () => {
    const { remote, rows } = fakeRemote('me');
    const tampered = { ...c, wasm: c.wasm.slice() };
    tampered.wasm[tampered.wasm.length - 1]! ^= 0xff;
    rows.set(c.hash, { pkg: tampered, ownerId: 'me', visibility: 'private', projectId: null });
    configurePluginStore({ remote, cache: createMemoryCache(), verify: async () => ({ ok: true }) });
    expect(await resolve(c.hash)).toBeNull();
    expect(resolveErrors.value.get(c.hash)).toMatch(/hash/);
  });

  it('serves cached packages offline', async () => {
    const cache = createMemoryCache();
    await cache.put(d);
    configurePluginStore({ remote: null, cache });
    expect((await resolve(d.hash))?.manifest.name).toBe('D');
  });

  it('publishes non-built-ins and lists by origin', async () => {
    const { remote } = fakeRemote('me');
    configurePluginStore({ remote, cache: createMemoryCache() });
    await publish(a, 'project', 'p1');
    expect(remote.publish).toHaveBeenCalledWith(a, 'project', 'p1');

    // Built-ins are never uploaded.
    await publish({ ...a, hash: BUILTIN_PLUGINS[0]!.hash }, 'public');
    expect(remote.publish).toHaveBeenCalledTimes(1);

    const list = await listAvailable({ projectId: 'p1' });
    expect(list.filter(p => p.origin === 'builtin')).toHaveLength(BUILTIN_PLUGINS.length);
    expect(list.find(p => p.hash === a.hash)?.origin).toBe('mine');
  });
});
