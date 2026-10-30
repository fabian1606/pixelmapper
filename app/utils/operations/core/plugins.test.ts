// @vitest-environment node
/**
 * `plugins.*` operations: listing and reading built-ins, a real build via
 * the toolchain (AssemblyScript in Vitest, like `create-plugin.test.ts`),
 * build errors as findings, idempotence, publishing against a fake remote,
 * and the build → `modifiers.add` loop.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplyRequest } from '@pixelmapper/agent-kit';
import { useEngineStore } from '~/stores/engine-store';
import { BUILTIN_ALIASES, builtinHash } from '~/utils/engine/modifiers';
import { TEMPLATE_MANIFEST, TEMPLATE_SOURCE } from '~/utils/plugins/create-plugin';
import { configurePluginStore } from '~/utils/plugins/plugin-store';
import type { PluginRemote } from '~/utils/plugins/plugin-remote';
import { applyOperations } from '../apply';
import { readApi } from '../read-api';
import { registryWith, resetOperationState, seedScene, stubOperationGlobals } from '../test-utils';
import { modifierOperations } from './modifiers';
import { pluginOperations } from './plugins';

const ROOT = join(import.meta.dirname, '../../../..');
/** The real fetch: the AssemblyScript compiler loads its wasm through it. */
const realFetch = globalThis.fetch;

/** Store stubs, but keep the real fetch for the toolchain. */
function stubGlobals() {
  stubOperationGlobals();
  vi.stubGlobal('fetch', realFetch);
}

beforeAll(stubGlobals);
beforeEach(() => {
  resetOperationState();
  seedScene([{ id: 'fx-a', x: 0.2 }, { id: 'fx-b', x: 0.8 }]);
});
afterAll(() => configurePluginStore({ remote: null }));

/** Runs a batch against the plugin + modifier operations. */
function apply(request: ApplyRequest) {
  return applyOperations(request, { registry: registryWith(...pluginOperations, ...modifierOperations) });
}

/** Value of the first op of a single-op batch. */
async function run<T>(op: string, input: unknown): Promise<{ value: T; findings: Awaited<ReturnType<typeof apply>>['findings'] }> {
  const res = await apply({ label: op, ops: [{ op, input }] });
  return { value: res.results[0]?.value as T, findings: res.findings };
}

describe('plugins.list / plugins.get', () => {
  it('lists the built-ins with params and recipes', async () => {
    const { value } = await run<{ plugins: { alias: string; origin: string; params: { key: string }[]; recipes: { id: string }[] }[] }>('plugins.list', {});
    const waveform = value.plugins.find(p => p.alias === BUILTIN_ALIASES.waveform)!;
    expect(waveform.origin).toBe('builtin');
    expect(waveform.params.map(p => p.key)).toContain('invert');
    expect(waveform.recipes.map(r => r.id)).toContain('chase');
    const filtered = await run<{ plugins: { alias: string }[] }>('plugins.list', { search: 'color shift' });
    expect(filtered.value.plugins.map(p => p.alias)).toEqual([BUILTIN_ALIASES.colorAdjust]);
  });

  it('returns manifest and source of a built-in (from /plugins/<hex>.json)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(readFileSync(join(ROOT, 'public', url), 'utf8'))));
    const { value } = await run<{ hash: string; origin: string; manifest: { name: string }; source: Record<string, string> | null }>('plugins.get', { plugin: 'noise' });
    expect(value.hash).toBe(builtinHash(BUILTIN_ALIASES.noise));
    expect(value.origin).toBe('builtin');
    expect(value.manifest.name).toBe('Noise');
    expect(value.source?.['modifier.ts']).toContain('register(');
    stubGlobals();
  });

  it('reports unknown plugins', async () => {
    const res = await apply({ label: 'get', ops: [{ op: 'plugins.get', input: { plugin: 'nope' } }] });
    expect(res.findings[0]!.message).toMatch(/plugin "nope" not found/);
  });
});

describe('plugins.build / plugins.publish', () => {
  const manifest = { ...TEMPLATE_MANIFEST, alias: '@test/ops-pulse', name: 'Ops Pulse' };

  it('builds, registers idempotently and can be added as a modifier', async () => {
    const first = await run<{ ok: boolean; hash: string; alias: string; validation: { ok: boolean; metrics?: { outputMax: number } } }>('plugins.build', { manifest, source: TEMPLATE_SOURCE });
    expect(first.findings.filter(f => f.level === 'error')).toEqual([]);
    expect(first.value.ok).toBe(true);
    expect(first.value.hash).toMatch(/^sha256:/);
    expect(first.value.validation.ok).toBe(true);
    expect(first.value.validation.metrics!.outputMax).toBeLessThanOrEqual(1);

    const again = await run<{ hash: string }>('plugins.build', { manifest: JSON.stringify(manifest), source: TEMPLATE_SOURCE });
    expect(again.value.hash).toBe(first.value.hash);

    // The AI loop: build → add by alias.
    const added = await apply({ label: 'add', ops: [{ op: 'modifiers.add', input: { plugin: '@test/ops-pulse', recipe: 'swell' } }] });
    expect(added.committed).toBe(true);
    const id = (added.results[0]!.value as { modifierId: string }).modifierId;
    expect(readApi.modifier(id)!.plugin).toBe(first.value.hash);

    const listed = await run<{ plugins: { hash: string; origin: string }[] }>('plugins.list', {});
    expect(listed.value.plugins.find(p => p.hash === first.value.hash)?.origin).toBe('local');
    const got = await run<{ source: Record<string, string> | null }>('plugins.get', { plugin: first.value.hash });
    expect(got.value.source?.['modifier.ts']).toBe(TEMPLATE_SOURCE);
  }, 60_000);

  it('returns compile errors as diagnostics and error findings (no throw)', async () => {
    const res = await apply({ label: 'b', ops: [{ op: 'plugins.build', input: { manifest, source: 'this is not code' } }] });
    const value = res.results[0]!.value as { ok: boolean; hash: string | null; diagnostics: { stage: string; severity: string }[] };
    expect(value.ok).toBe(false);
    expect(value.hash).toBeNull();
    expect(value.diagnostics.some(d => d.stage === 'compile' && d.severity === 'error')).toBe(true);
    expect(res.findings.some(f => f.level === 'error' && f.code === 'plugin-compile-error')).toBe(true);
  }, 60_000);

  it('returns invalid manifest JSON as a manifest diagnostic', async () => {
    const { value, findings } = await run<{ ok: boolean; diagnostics: { stage: string }[] }>('plugins.build', { manifest: '{ nope', source: TEMPLATE_SOURCE });
    expect(value.ok).toBe(false);
    expect(value.diagnostics[0]!.stage).toBe('manifest');
    expect(findings[0]).toMatchObject({ level: 'error', code: 'plugin-manifest-error' });
  });

  it('is skipped in dry runs', async () => {
    const res = await apply({ label: 'b', dryRun: true, ops: [{ op: 'plugins.build', input: { manifest, source: TEMPLATE_SOURCE } }] });
    expect(res.results[0]).toEqual({ op: 'plugins.build', kind: 'action', skipped: true });
  });

  it('publishes a built package with project visibility', async () => {
    const built = await run<{ hash: string }>('plugins.build', { manifest, source: TEMPLATE_SOURCE });
    const publish = vi.fn(async () => {});
    const remote = { userId: async () => 'me', publish, list: async () => [], fetch: async () => null, findByAlias: async () => [] } as unknown as PluginRemote;

    // Signed out: an error finding, not an exception.
    configurePluginStore({ remote: null });
    useEngineStore().currentProjectId = 'proj-1';
    const offline = await run<{ published: boolean }>('plugins.publish', { hash: built.value.hash, visibility: 'project' });
    expect(offline.value.published).toBe(false);
    expect(offline.findings[0]).toMatchObject({ level: 'error', code: 'publish-failed' });

    configurePluginStore({ remote });
    const ok = await run<{ published: boolean; projectId: string }>('plugins.publish', { hash: '@test/ops-pulse', visibility: 'project' });
    expect(ok.value).toEqual({ published: true, hash: built.value.hash, visibility: 'project', projectId: 'proj-1' });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ hash: built.value.hash }), 'project', 'proj-1');

    const builtin = await run<{ published: boolean }>('plugins.publish', { hash: 'waveform', visibility: 'public' });
    expect(builtin.value.published).toBe(false);
    expect(builtin.findings[0]).toMatchObject({ level: 'info', code: 'builtin-not-published' });
  }, 60_000);
});
