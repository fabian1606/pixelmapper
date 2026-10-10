// @vitest-environment node
/**
 * Plugin import (plan P4.4): references, alias lookup, package files that
 * must rebuild to their declared hash.
 */
import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_ALIASES, builtinHash } from '~/utils/engine/modifiers';
import { buildFromCode, TEMPLATE_MANIFEST, TEMPLATE_SOURCE } from './create-plugin';
import { createMemoryCache } from './plugin-cache';
import { configurePluginStore } from './plugin-store';
import { exportPluginFile, importPlugin, importPluginFile, parsePluginRef, pluginLink } from './import-plugin';

const HEX = 'ab'.repeat(32);

describe('parsePluginRef', () => {
  it('accepts hashes, bare hex, links and aliases', () => {
    expect(parsePluginRef(`sha256:${HEX}`)).toEqual({ kind: 'hash', hash: `sha256:${HEX}` });
    expect(parsePluginRef(HEX.toUpperCase())).toEqual({ kind: 'hash', hash: `sha256:${HEX}` });
    expect(parsePluginRef(pluginLink(`sha256:${HEX}`, 'https://app.example'))).toEqual({ kind: 'hash', hash: `sha256:${HEX}` });
    expect(parsePluginRef('@me/pulse-train')).toEqual({ kind: 'alias', alias: '@me/pulse-train' });
    expect(parsePluginRef('hello')).toBeNull();
  });
});

describe('importPlugin', () => {
  it('resolves built-in aliases without a remote', async () => {
    configurePluginStore({ remote: null, cache: createMemoryCache() });
    const res = await importPlugin(BUILTIN_ALIASES.noise);
    expect(res.ok && res.plugin.hash).toBe(builtinHash(BUILTIN_ALIASES.noise));
  });

  it('looks up other aliases remotely (newest first)', async () => {
    const findByAlias = vi.fn(async () => [{ hash: builtinHash(BUILTIN_ALIASES.waveform) }]);
    configurePluginStore({ remote: { findByAlias } as never, cache: createMemoryCache() });
    const res = await importPlugin('@someone/thing');
    expect(findByAlias).toHaveBeenCalledWith('@someone/thing');
    expect(res.ok).toBe(true);
  });
});

describe('plugin files', () => {
  it('round-trips through export and a verified rebuild', async () => {
    const built = await buildFromCode({ manifest: { ...TEMPLATE_MANIFEST, name: 'Roundtrip' }, source: { 'modifier.ts': TEMPLATE_SOURCE } });
    const file = exportPluginFile(built.pkg!.hash)!;
    expect(file.format).toBe('pixelmapper-plugin');
    const res = await importPluginFile(JSON.stringify(file));
    expect(res.ok && res.plugin.hash).toBe(built.pkg!.hash);
  }, 60_000);

  it('rejects files whose source does not build the declared hash', async () => {
    const built = await buildFromCode({ manifest: { ...TEMPLATE_MANIFEST, name: 'Tampered' }, source: { 'modifier.ts': TEMPLATE_SOURCE } });
    const file = exportPluginFile(built.pkg!.hash)!;
    file.source = { 'modifier.ts': TEMPLATE_SOURCE.replace('v = Mathf.sin(', 'v = 0.9 * Mathf.sin(') };
    const res = await importPluginFile(JSON.stringify(file));
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/Hash mismatch/);
  }, 60_000);

  it('rejects non-plugin files', async () => {
    expect((await importPluginFile('{}')).ok).toBe(false);
    expect((await importPluginFile('nope')).ok).toBe(false);
  });
});
