/**
 * Plugin references for the `modifiers.*` and `plugins.*` operations.
 *
 * Agents name a content plugin by alias (`@pixelmapper/waveform`), by the
 * short built-in key (`waveform`, `colorAdjust`), by its display name
 * (`Color Shift`, when unique) or by content hash (`sha256:…`). This module
 * resolves such references against the plugin store and summarizes
 * manifests for AI readers.
 */
import { z } from 'zod';
import type { ContentPluginManifest } from '@pixelmapper/plugin-toolchain/types';
import { BUILTIN_ALIASES } from '~/utils/engine/modifiers';
import { BUILTIN_BY_ALIAS } from '~/utils/plugins/builtin-index';
import { getManifest, isBuiltin, listPlugins, resolve } from '~/utils/plugins/plugin-store';

// ── Schema ──────────────────────────────────────

/** A plugin reference (alias, short built-in key, name or `sha256:` hash). */
export const PluginRefSchema = z.string().min(1).describe(
  'Content plugin: alias ("@pixelmapper/waveform"), short built-in key ("waveform", "noise", "sequencer", "colorAdjust"), unique display name ("Color Shift") or content hash ("sha256:…"). See plugins.list.',
);

/** A resolved plugin. */
export interface ResolvedPlugin {
  hash: string;
  manifest: ContentPluginManifest;
}

// ── Resolution ──────────────────────────────────

/** Compares dotted version strings numerically (`1.10.0` > `1.9.0`). */
function compareVersions(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * Resolves a reference among the plugins known in memory (synchronous).
 * Several local versions of one alias: the highest version wins.
 */
export function findPlugin(ref: string): ResolvedPlugin | null {
  const trimmed = ref.trim();
  if (trimmed.startsWith('sha256:')) {
    const manifest = getManifest(trimmed);
    return manifest ? { hash: trimmed, manifest } : null;
  }
  // Short built-in keys (`waveform`) and built-in aliases.
  const short = (BUILTIN_ALIASES as Record<string, string>)[trimmed];
  const builtin = BUILTIN_BY_ALIAS[short ?? trimmed];
  if (builtin) return { hash: builtin, manifest: getManifest(builtin)! };

  const known = listPlugins();
  const byAlias = known.filter(p => p.manifest.alias === trimmed)
    .sort((a, b) => compareVersions(b.manifest.version, a.manifest.version));
  if (byAlias[0]) return { hash: byAlias[0].hash, manifest: byAlias[0].manifest };
  const lower = trimmed.toLowerCase();
  const byName = known.filter(p => p.manifest.name.toLowerCase() === lower);
  if (byName.length === 1) return { hash: byName[0]!.hash, manifest: byName[0]!.manifest };
  return null;
}

/**
 * Resolves a reference; unknown hashes are fetched through the plugin store
 * (cache → remote). Returns null when the plugin is unavailable.
 */
export async function resolvePlugin(ref: string): Promise<ResolvedPlugin | null> {
  const found = findPlugin(ref);
  if (found || !ref.startsWith('sha256:')) return found;
  const known = await resolve(ref.trim());
  return known ? { hash: known.hash, manifest: known.manifest } : null;
}

/** Readable "not found" message with a hint. */
export function pluginNotFound(ref: string): string {
  return `plugin "${ref}" not found (use plugins.list for aliases and hashes; built-ins: ${Object.values(BUILTIN_ALIASES).join(', ')})`;
}

/** Throws a readable error when the reference does not resolve. */
export async function requirePlugin(ref: string): Promise<ResolvedPlugin> {
  const found = await resolvePlugin(ref);
  if (!found) throw new Error(pluginNotFound(ref));
  if (found.manifest.kind !== 'modifier') throw new Error(`plugin "${ref}" is a ${found.manifest.kind}, not a modifier`);
  return found;
}

/** Where a plugin comes from (for listings of single plugins). */
export function pluginOrigin(hash: string): 'builtin' | 'local' {
  return isBuiltin(hash) ? 'builtin' : 'local';
}

// ── Summaries ───────────────────────────────────

/** Compact param description for listings. */
export interface ParamSummary {
  key: string;
  type: string;
  label: string;
  description?: string;
  min?: number;
  max?: number;
  unit?: string;
  options?: string[];
  tier?: string;
}

/** Compact params of a manifest (no defaults of structured types). */
export function paramSummaries(manifest: ContentPluginManifest): ParamSummary[] {
  return manifest.params.map((p) => {
    const out: ParamSummary = { key: p.key, type: p.type, label: p.label };
    if (p.description) out.description = p.description;
    if (p.tier) out.tier = p.tier;
    if (p.type === 'number' || p.type === 'int') {
      out.min = p.min;
      out.max = p.max;
    }
    if (p.type === 'number' && p.unit) out.unit = p.unit;
    if (p.type === 'enum') out.options = [...p.options];
    return out;
  });
}

/** Zod schema of `ParamSummary`. */
export const ParamSummarySchema = z.object({
  key: z.string(),
  type: z.string(),
  label: z.string(),
  description: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  unit: z.string().optional(),
  options: z.array(z.string()).optional(),
  tier: z.string().optional(),
});
