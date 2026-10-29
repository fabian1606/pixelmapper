/**
 * Content plugin operations: `plugins.list`, `plugins.get` (queries),
 * `plugins.build`, `plugins.publish` (actions) — ADR 0002 §4.2, B12.
 *
 * Builds and publishes are side effects outside the project history: a
 * package is content-addressed (`sha256:` over manifest ‖ wasm ‖ ui), so
 * repeating them is idempotent. Build problems are returned as diagnostics
 * and findings (not exceptions) so an AI can fix its code and retry.
 */
import { z } from 'zod';
import type { Finding } from '@pixelmapper/agent-kit';
import type { ContentPluginManifest } from '@pixelmapper/plugin-toolchain/types';
import { useEngineStore } from '~/stores/engine-store';
import { buildFromCode } from '~/utils/plugins/create-plugin';
import { getPackage, isBuiltin, listAvailable, publish } from '~/utils/plugins/plugin-store';
import { defineCoreOperation } from '../define';
import type { CoreOperation } from '../registry';
import { ParamSummarySchema, paramSummaries, PluginRefSchema, pluginNotFound, pluginOrigin, resolvePlugin } from './plugin-ref';

// ── Helpers ─────────────────────────────────────

/** Current project id (project visibility / project listings), if a project is open. */
function currentProjectId(): string | null {
  try {
    return useEngineStore().currentProjectId ?? null;
  }
  catch {
    return null;
  }
}

/**
 * Sources of a plugin: the package's for local/remote plugins; built-ins
 * load their package metadata (`/plugins/<hex>.json`, incl. source).
 */
async function pluginSource(hash: string): Promise<Record<string, string> | null> {
  const pkg = getPackage(hash);
  if (pkg) return { ...pkg.source };
  if (!isBuiltin(hash)) return null;
  try {
    const res = await fetch(`/plugins/${hash.replace(/^sha256:/, '')}.json`);
    if (!res.ok) return null;
    const meta = await res.json() as { source?: Record<string, string> };
    return meta.source ?? null;
  }
  catch (err) {
    console.warn('[operations] built-in source unavailable:', err);
    return null;
  }
}

/** Listing entry of a plugin. */
const PluginSummarySchema = z.object({
  hash: z.string(),
  alias: z.string(),
  name: z.string(),
  version: z.string(),
  origin: z.string().describe('builtin, mine, project, public or local (built or cached on this device).'),
  purpose: z.string().optional(),
  description: z.string(),
  signatures: z.array(z.string()),
  output: z.string().describe('bipolar (modulation −1..1), absolute (target value 0–1), scale (fraction 0–1 of the programmed value).'),
  speedUnit: z.string().optional(),
  params: z.array(ParamSummarySchema),
  recipes: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().optional() })),
});

/** Summary of a manifest. */
function summarize(hash: string, manifest: ContentPluginManifest, origin: string): z.infer<typeof PluginSummarySchema> {
  return {
    hash,
    alias: manifest.alias,
    name: manifest.name,
    version: manifest.version,
    origin,
    ...(manifest.purpose ? { purpose: manifest.purpose } : {}),
    description: manifest.description,
    signatures: [...manifest.signatures],
    output: manifest.output,
    ...(manifest.speedUnit ? { speedUnit: manifest.speedUnit } : {}),
    params: paramSummaries(manifest),
    recipes: (manifest.presets ?? []).map(p => ({ id: p.id, label: p.label, ...(p.description ? { description: p.description } : {}) })),
  };
}

// ── Queries ─────────────────────────────────────

/** `plugins.list`. */
export const pluginsList = defineCoreOperation({
  id: 'plugins.list',
  kind: 'query',
  description: [
    'List the content plugins (modifier types) that can be added with modifiers.add: built-ins, your own, the project\'s, locally built ones and optionally public ones.',
    'Each entry: hash, alias, name, version, origin, purpose/description, signatures (rgb / panTilt / scalar), output mode, params (key, type, label, range, enum options) and recipes (id, label). Use plugins.get for the full manifest and source code.',
  ].join('\n'),
  input: z.object({
    search: z.string().optional().describe('Case-insensitive substring of alias, name or description.'),
    includePublic: z.boolean().optional().describe('Also list public plugins of other users (needs a session).'),
  }),
  output: z.object({ plugins: z.array(PluginSummarySchema) }),
  examples: [{ input: {} }, { input: { search: 'color' } }],
  async run(_ctx, input) {
    const available = await listAvailable({ projectId: currentProjectId() ?? undefined, includePublic: input.includePublic });
    const needle = input.search?.toLowerCase();
    const plugins = available
      .filter(p => p.manifest.kind === 'modifier')
      .filter(p => !needle || [p.manifest.alias, p.manifest.name, p.manifest.description].some(s => s.toLowerCase().includes(needle)))
      .map(p => summarize(p.hash, p.manifest, p.origin));
    return { kind: 'query', value: { plugins } };
  },
});

/** `plugins.get`. */
export const pluginsGet = defineCoreOperation({
  id: 'plugins.get',
  kind: 'query',
  description: [
    'Full manifest (params with defaults and ranges, recipes with their params/speed/spread, distribution options) and source code of a plugin.',
    'The built-ins (waveform, noise, sequencer, colorAdjust) are good examples for writing a new plugin with plugins.build. source maps file names (modifier.ts, optional ui panel) to AssemblyScript / TypeScript text; null when not available offline.',
  ].join('\n'),
  input: z.object({ plugin: PluginRefSchema }),
  output: z.object({
    hash: z.string(),
    origin: z.enum(['builtin', 'local']),
    manifest: z.unknown(),
    source: z.record(z.string(), z.string()).nullable(),
  }),
  examples: [{ input: { plugin: 'waveform' } }, { input: { plugin: '@pixelmapper/color-adjust' } }],
  async run(_ctx, input) {
    const found = await resolvePlugin(input.plugin);
    if (!found) throw new Error(pluginNotFound(input.plugin));
    const manifest = JSON.parse(JSON.stringify(found.manifest)) as ContentPluginManifest;
    return { kind: 'query', value: { hash: found.hash, origin: pluginOrigin(found.hash), manifest, source: await pluginSource(found.hash) } };
  },
});

// ── Actions ─────────────────────────────────────

/** A build diagnostic. */
const DiagnosticSchema = z.object({
  stage: z.enum(['manifest', 'compile', 'validate']),
  severity: z.enum(['error', 'warning', 'info']),
  message: z.string(),
});

/** `plugins.build`. */
export const pluginsBuild = defineCoreOperation({
  id: 'plugins.build',
  kind: 'action',
  description: [
    'Compile, validate and register a content plugin (modifier) from a manifest and AssemblyScript source, then use it with modifiers.add { plugin: hash or alias }.',
    'Side effect outside the undo history (skipped in dry runs); idempotent — the same manifest + source always yields the same sha256 hash. The plugin is only registered on this device; plugins.publish shares it.',
    'Problems never throw: ok=false with diagnostics (stage manifest | compile | validate, with messages) and matching error findings; fix the code and call again. validation.metrics reports the median frame time (ms) and the observed output range.',
    'Start from plugins.get of a built-in for a working manifest + modifier.ts. ui: optional source of the custom panel file named by manifest.ui.panel.',
  ].join('\n'),
  input: z.object({
    manifest: z.union([z.record(z.string(), z.unknown()), z.string()]).describe('manifest.json as object or JSON text (schema 1, kind "modifier", alias, name, version, apiVersion, description, signatures, output, params, presets…).'),
    source: z.string().min(1).describe('modifier.ts (AssemblyScript using @pixelmapper/plugin-sdk).'),
    ui: z.string().optional().describe('Source of the custom panel file named by manifest.ui.panel.'),
  }),
  output: z.object({
    ok: z.boolean(),
    hash: z.string().nullable().describe('Content hash (sha256:…) of the registered package; null on errors.'),
    alias: z.string().nullable(),
    diagnostics: z.array(DiagnosticSchema),
    validation: z.object({
      ok: z.boolean(),
      metrics: z.object({ medianFrameMs: z.number(), samples: z.number(), outputMin: z.number(), outputMax: z.number() }).optional(),
    }),
  }),
  examples: [{ input: { manifest: { schema: 1, kind: 'modifier', alias: '@me/pulse', name: 'Pulse', version: '1.0.0', apiVersion: '^1.1.0', description: '…', signatures: ['scalar'], output: 'scale', params: [] }, source: '…modifier.ts…' } }],
  async run(_ctx, input) {
    const manifest = input.manifest as ContentPluginManifest | string;
    const source: Record<string, string> = { 'modifier.ts': input.source };
    const findings: Finding[] = [];
    if (input.ui !== undefined) {
      const panel = typeof manifest === 'string' ? safePanel(manifest) : manifest.ui?.panel;
      if (panel) source[panel] = input.ui;
      else findings.push({ level: 'warning', code: 'ui-ignored', message: 'ui source given but manifest.ui.panel names no panel file; it was ignored' });
    }
    let result: Awaited<ReturnType<typeof buildFromCode>>;
    try {
      result = await buildFromCode({ manifest, source });
    }
    catch (err) {
      result = { pkg: null, diagnostics: [{ stage: 'compile', severity: 'error', message: err instanceof Error ? err.message : String(err) }] };
    }
    for (const d of result.diagnostics) {
      if (d.severity === 'info') continue;
      findings.push({ level: d.severity, code: `plugin-${d.stage}-${d.severity}`, message: `${d.stage}: ${d.message}` });
    }
    const ok = !!result.pkg;
    const validated = result.metrics !== undefined;
    return {
      kind: 'action',
      value: {
        ok,
        hash: result.pkg?.hash ?? null,
        alias: result.pkg?.manifest.alias ?? null,
        diagnostics: result.diagnostics,
        validation: { ok: ok && validated, ...(result.metrics ? { metrics: result.metrics } : {}) },
      },
      findings,
    };
  },
});

/** Panel file name of a manifest given as JSON text (undefined when invalid). */
function safePanel(text: string): string | undefined {
  try {
    return (JSON.parse(text) as { ui?: { panel?: string } }).ui?.panel;
  }
  catch {
    return undefined;
  }
}

/** `plugins.publish`. */
export const pluginsPublish = defineCoreOperation({
  id: 'plugins.publish',
  kind: 'action',
  description: [
    'Publish a locally built plugin to the shared registry so collaborators (visibility "project", the open project), only you ("private") or everyone ("public") can resolve its hash.',
    'Side effect outside the undo history (skipped in dry runs); idempotent per hash. Built-ins are never published. Needs a signed-in session; failures come back as an error finding with published=false.',
  ].join('\n'),
  input: z.object({
    hash: PluginRefSchema.describe('Hash (sha256:…) or alias of a plugin built with plugins.build.'),
    visibility: z.enum(['private', 'project', 'public']),
  }),
  output: z.object({ published: z.boolean(), hash: z.string().nullable(), visibility: z.string(), projectId: z.string().nullable() }),
  examples: [{ input: { hash: 'sha256:…', visibility: 'project' } }],
  async run(_ctx, input) {
    const fail = (hash: string | null, code: string, message: string, projectId: string | null = null) => ({
      kind: 'action' as const,
      value: { published: false, hash, visibility: input.visibility, projectId },
      findings: [{ level: 'error' as const, code, message }],
    });
    const found = await resolvePlugin(input.hash);
    if (!found) return fail(null, 'plugin-not-found', pluginNotFound(input.hash));
    if (isBuiltin(found.hash)) {
      return {
        kind: 'action',
        value: { published: false, hash: found.hash, visibility: input.visibility, projectId: null },
        findings: [{ level: 'info', code: 'builtin-not-published', message: 'built-in plugins are available everywhere and are never published' }],
      };
    }
    const pkg = getPackage(found.hash);
    if (!pkg) return fail(found.hash, 'package-unavailable', `the package of ${found.hash} is not on this device; build it with plugins.build first`);
    const projectId = input.visibility === 'project' ? currentProjectId() : null;
    if (input.visibility === 'project' && !projectId) return fail(found.hash, 'no-project', 'visibility "project" needs an open project');
    try {
      await publish(pkg, input.visibility, projectId);
    }
    catch (err) {
      return fail(found.hash, 'publish-failed', `publish failed: ${err instanceof Error ? err.message : String(err)}`, projectId);
    }
    return { kind: 'action', value: { published: true, hash: found.hash, visibility: input.visibility, projectId } };
  },
});

/** All plugin operations. */
export const pluginOperations: CoreOperation[] = [pluginsList, pluginsGet, pluginsBuild, pluginsPublish];
