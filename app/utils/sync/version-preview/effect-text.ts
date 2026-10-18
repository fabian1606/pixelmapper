import type { ContentPluginManifest } from '@pixelmapper/plugin-toolchain/types';
import type { ParamDef } from '@pixelmapper/extension-api';
import type { ModifierInstance, SpeedConfig } from '~/utils/engine/types';
import { humanize } from '~/utils/sync/version-diff/compare';
import type { EffectHighlight } from './highlight-types';

/**
 * Wording of the effect hover preview: the effect's display name (manifest
 * name plus the first enum param's label, like `modifierName`) and the
 * changed settings in words ("Speed 2 s → 1 s, Color, Strength 50 % → 80 %").
 * Pure: the manifest is passed in (undefined when the plugin is unknown).
 */

/** Changes listed before "+N more". */
const MAX_CHANGES = 4;

/** Labels of top-level modifier keys. */
const KEY_LABELS: Record<string, string> = {
  strength: 'Strength',
  speed: 'Speed',
  distribution: 'Spread',
  targetFixtureIds: 'Fixtures',
  targetChannels: 'Channels',
  blendMode: 'Blend mode',
  signature: 'Output',
  plugin: 'Plugin',
};

/** Capitalizes the first letter. */
const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Rounds to at most `digits` decimals without trailing zeros. */
function num(v: number, digits = 2): string {
  return String(Math.round(v * 10 ** digits) / 10 ** digits);
}

// ── Name ─────────────────────────────────────────────────────────────────────

/** Display name of an effect; "Unknown effect" without a manifest. */
export function effectName(m: Pick<ModifierInstance, 'params'>, manifest: ContentPluginManifest | undefined): string {
  if (!manifest) return 'Unknown effect';
  const firstEnum = manifest.params.find(p => p.type === 'enum');
  if (firstEnum && firstEnum.type === 'enum') {
    const value = String(m.params?.[firstEnum.key] ?? firstEnum.default);
    const i = firstEnum.options.indexOf(value);
    return `${manifest.name} · ${firstEnum.optionLabels?.[i] ?? value}`;
  }
  return manifest.name;
}

/** Title line: "Rainbow — added" / "Rainbow — changed". */
export function effectTitle(highlight: EffectHighlight, manifest: ContentPluginManifest | undefined): string {
  return `${effectName(highlight.modifier, manifest)} — ${highlight.status}`;
}

// ── Values ───────────────────────────────────────────────────────────────────

/** Speed in words: "500 ms", "2 s", "1/4 beat", "2 beats", "∞". */
export function formatSpeed(speed: Partial<SpeedConfig> | undefined): string | null {
  if (!speed || typeof speed !== 'object') return null;
  if (speed.mode === 'infinite') return '∞';
  if (speed.mode === 'time' && typeof speed.timeMs === 'number') {
    return speed.timeMs < 1000 ? `${num(speed.timeMs, 0)} ms` : `${num(speed.timeMs / 1000)} s`;
  }
  if (speed.mode === 'beat' && typeof speed.beatValue === 'number' && speed.beatValue > 0) {
    const v = speed.beatValue;
    const inv = 1 / v;
    if (v < 1 && Math.abs(inv - Math.round(inv)) < 1e-3) return `1/${Math.round(inv)} beat`;
    return `${num(v)} ${v === 1 ? 'beat' : 'beats'}`;
  }
  return null;
}

/** Param value in words (numbers with unit, enum labels, On/Off); null for composite values. */
function formatParam(def: ParamDef | undefined, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (def?.type === 'enum') {
    const i = def.options.indexOf(String(value));
    return def.optionLabels?.[i] ?? String(value);
  }
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (def?.type === 'angle') return `${num(value, 0)}°`;
    const unit = def?.type === 'number' && def.unit ? ` ${def.unit}` : '';
    return `${num(value)}${unit}`;
  }
  if (typeof value === 'string' && value.length <= 24) return value;
  return null;
}

/** "Label a → b", or just "Label" when a value is not displayable. */
function transition(label: string, before: string | null, after: string | null): string {
  if (before !== null && after !== null && before !== after) return `${label} ${before} → ${after}`;
  return label;
}

/** Strength in percent. */
const percent = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 100)} %` : null);

/** One changed key in words. */
function describeKey(key: string, h: EffectHighlight, manifest: ContentPluginManifest | undefined): string {
  const m = h.modifier;
  const before = h.before?.[key];
  if (key.startsWith('params.')) {
    const pk = key.slice('params.'.length);
    const def = manifest?.params.find(p => p.key === pk);
    const label = def?.label ?? capitalize(humanize(pk));
    return transition(label, formatParam(def, before), formatParam(def, m.params?.[pk]));
  }
  if (key === 'strength') return transition('Strength', percent(before), percent(m.strength));
  if (key === 'speed') return transition('Speed', formatSpeed(before as SpeedConfig | undefined), formatSpeed(m.speed));
  if (key === 'blendMode') return transition('Blend mode', typeof before === 'string' ? humanize(before) : null, humanize(String(m.blendMode)));
  return KEY_LABELS[key] ?? capitalize(humanize(key));
}

// ── Description ──────────────────────────────────────────────────────────────

/**
 * The change in words: "Rainbow — added" for new effects, else the changed
 * settings ("Speed 2 s → 1 s, Color, Strength 50 % → 80 %", at most four plus
 * "+N more"); "Settings changed" when no key is known.
 */
export function describeEffectChange(highlight: EffectHighlight, manifest: ContentPluginManifest | undefined): string {
  if (highlight.status === 'added') return effectTitle(highlight, manifest);
  const keys = [...new Set(highlight.changedKeys ?? [])];
  if (keys.length === 0) return 'Settings changed';
  const parts = keys.slice(0, MAX_CHANGES).map(k => describeKey(k, highlight, manifest));
  if (keys.length > MAX_CHANGES) parts.push(`+${keys.length - MAX_CHANGES} more`);
  return parts.join(', ');
}
