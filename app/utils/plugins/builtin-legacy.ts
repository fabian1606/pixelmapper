/**
 * Former built-in plugins (plan M6.5). `builtin-legacy.json` (maintained by
 * `scripts/build-plugins.ts`) lists every previous built-in hash with its
 * alias, version and param schema. Instances that reference one are
 * redirected to the current built-in of the same alias; a param migration
 * runs when the major version changed. Applied wherever v2/v3 instances are
 * loaded (snapshots, presets, change-log payloads, live sync).
 */
import type { ParamSchema, ParamValue } from '@pixelmapper/extension-api';
import legacy from './builtin-legacy.json';
import { BUILTIN_BY_ALIAS } from './builtin-index';
import { migrateWaveformV1, type WaveformV1Params } from './legacy/waveform-v1';
import { migrateColorAdjustV1, type ColorAdjustV1Params } from './legacy/color-adjust-v1';

/** A former built-in. */
export interface LegacyBuiltin {
  hash: string;
  alias: string;
  version: string;
  params: ParamSchema;
}

const LEGACY = new Map((legacy as LegacyBuiltin[]).map(e => [e.hash, e]));

/** Instance fields a migration may rewrite. */
interface MigratableInstance {
  plugin: string;
  params: Record<string, ParamValue>;
  strength?: number;
}

/** Param migrations by `alias@major` of the old version. */
const MIGRATIONS: Record<string, (params: Record<string, ParamValue>, m: MigratableInstance) => Record<string, ParamValue>> = {
  '@pixelmapper/waveform@1': (p, m) => migrateWaveformV1(p as WaveformV1Params, m.strength ?? 1),
  '@pixelmapper/color-adjust@1': p => migrateColorAdjustV1(p as ColorAdjustV1Params),
};

/** The former built-in a hash belongs to, if any. */
export function legacyBuiltin(hash: string): LegacyBuiltin | undefined {
  return LEGACY.get(hash);
}

/**
 * Redirects an instance of a former built-in to the current one (params
 * migrated when the major version changed). Other instances are returned
 * unchanged.
 */
export function migrateLegacyPlugin<T extends MigratableInstance>(m: T): T {
  const old = LEGACY.get(m.plugin);
  const current = old ? BUILTIN_BY_ALIAS[old.alias] : undefined;
  if (!old || !current) return m;
  const migrate = MIGRATIONS[`${old.alias}@${old.version.split('.')[0]}`];
  return { ...m, plugin: current, params: migrate ? migrate(m.params ?? {}, m) : m.params };
}
