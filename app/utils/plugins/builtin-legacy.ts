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
import { migrateNoiseV1, type NoiseV1Params } from './legacy/noise-v1';
import { migrateSequencerV1, type SequencerV1Params } from './legacy/sequencer-v1';
import type { Distribution } from '@pixelmapper/extension-api';
import type { SpeedConfig } from '~/utils/engine/types';

/** A former built-in. */
export interface LegacyBuiltin {
  hash: string;
  alias: string;
  version: string;
  params: ParamSchema;
}

const LEGACY = new Map((legacy as LegacyBuiltin[]).map(e => [e.hash, e]));

/** Instance fields a migration may read or rewrite. */
interface MigratableInstance {
  plugin: string;
  params: Record<string, ParamValue>;
  strength?: number;
  speed?: SpeedConfig;
  targetFixtureIds?: unknown[];
  distribution?: Distribution;
}

/** What a migration returns: new params and optionally another built-in, distribution or speed. */
export interface LegacyPatch {
  params: Record<string, ParamValue>;
  /** Alias of the built-in that replaces the instance (default: the same alias). */
  alias?: string;
  distribution?: Distribution;
  speed?: SpeedConfig;
}

/** Migrations by `alias@major` of the old version. */
const MIGRATIONS: Record<string, (params: Record<string, ParamValue>, m: MigratableInstance) => LegacyPatch> = {
  '@pixelmapper/waveform@1': (p, m) => ({ params: migrateWaveformV1(p as WaveformV1Params, m.strength ?? 1) }),
  '@pixelmapper/color-adjust@1': p => ({ params: migrateColorAdjustV1(p as ColorAdjustV1Params) }),
  '@pixelmapper/noise@1': p => ({ params: migrateNoiseV1(p as NoiseV1Params) }),
  '@pixelmapper/sequencer@1': (p, m) => migrateSequencerV1(p as SequencerV1Params, m),
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
  if (!old || !BUILTIN_BY_ALIAS[old.alias]) return m;
  const migrate = MIGRATIONS[`${old.alias}@${old.version.split('.')[0]}`];
  if (!migrate) return { ...m, plugin: BUILTIN_BY_ALIAS[old.alias]! };
  const patch = migrate(m.params ?? {}, m);
  const plugin = BUILTIN_BY_ALIAS[patch.alias ?? old.alias] ?? BUILTIN_BY_ALIAS[old.alias]!;
  return {
    ...m,
    plugin,
    params: patch.params,
    ...(patch.distribution ? { distribution: patch.distribution } : {}),
    ...(patch.speed ? { speed: patch.speed } : {}),
  };
}
