import type { ChannelType, ModifierInstance } from '~/utils/engine/types';
import type {
  PresetCategoryType,
  PresetChannelSnapshot,
} from '~/utils/engine/preset-types';
import { cloneModifier } from '~/utils/engine/modifiers';
import type { Channel } from '~/utils/engine/core/channel';

// ─── Channel category sets ────────────────────────────────────────────────────

export const COLOR_CHANNEL_TYPES = new Set<ChannelType>([
  'RED', 'GREEN', 'BLUE', 'WHITE', 'WARM_WHITE', 'COOL_WHITE',
  'AMBER', 'UV', 'CYAN', 'MAGENTA', 'YELLOW', 'LIME', 'INDIGO',
  'COLOR_WHEEL', 'COLOR_PRESET', 'COLOR_TEMPERATURE',
]);

export const MOVEMENT_CHANNEL_TYPES = new Set<ChannelType>([
  'PAN', 'TILT', 'PANTILT_SPEED',
]);

export const DIMMER_CHANNEL_TYPES = new Set<ChannelType>([
  'DIMMER',
]);

export const BEAM_CHANNEL_TYPES = new Set<ChannelType>([
  'STROBE', 'STROBE_SPEED', 'STROBE_DURATION',
  'ZOOM', 'FOCUS', 'IRIS', 'FROST', 'BEAM_ANGLE', 'BEAM_POSITION',
  'GOBO_WHEEL', 'GOBO_SPIN', 'PRISM', 'PRISM_ROTATION', 'BLADE',
]);

// ─── Category type helpers ────────────────────────────────────────────────────

export function getCategoryType(channelType: ChannelType): PresetCategoryType {
  if (COLOR_CHANNEL_TYPES.has(channelType)) return 'color';
  if (MOVEMENT_CHANNEL_TYPES.has(channelType)) return 'movement';
  if (DIMMER_CHANNEL_TYPES.has(channelType)) return 'dimmer';
  if (BEAM_CHANNEL_TYPES.has(channelType)) return 'beam';
  return 'other';
}

/** Returns the channel-type category for an effect based on its targetChannels. */
export function getEffectCategoryType(effect: ModifierInstance): PresetCategoryType {
  if (!effect.targetChannels || effect.targetChannels.length === 0) return 'other';
  const firstChannel = effect.targetChannels[0];
  return firstChannel !== undefined ? getCategoryType(firstChannel) : 'other';
}

/** Returns true if a channel has been actively programmed from its default. */
export function isChannelProgrammed(ch: Channel): boolean {
  if (ch.chaserConfig.isPlaying || ch.chaserConfig.stepsCount > 1) return true;
  return ch.chaserConfig.stepValues.some((v) => v !== ch.defaultValue);
}

// ─── Fingerprinting ───────────────────────────────────────────────────────────

/**
 * Builds a stable key for grouping channel snapshots.
 * Fixtures with identical category values share one row.
 */
export function getChannelFingerprint(snapshots: PresetChannelSnapshot[]): string {
  return snapshots
    .map((s) => `${s.channelIndex}:${s.channelType}:${s.stepValues.join(',')}`)
    .sort()
    .join('|');
}

/**
 * Stable identity key of a modifier: its instance id (falls back to the
 * plugin hash). Used to match a live modifier to its saved counterpart so any
 * parameter change collapses to one change row.
 */
export function getModifierIdentity(m: ModifierInstance): string {
  return m.id || m.plugin;
}

/**
 * Deterministic fingerprint of a modifier including all values (plugin,
 * targets, generic fields, params). Detects parameter changes.
 */
export function getModifierFingerprint(m: ModifierInstance): string {
  const channels = [...(m.targetChannels ?? [])].sort().join(',');
  const params = JSON.stringify(Object.keys(m.params ?? {}).sort().map(k => [k, m.params[k]]));
  return `${m.plugin}|${m.signature}|${channels}|${m.strength}|${m.blendMode}|${JSON.stringify(m.speed)}|${JSON.stringify(m.distribution)}|${params}`;
}

// ─── Modifier serialisation ───────────────────────────────────────────────────

/** Snapshots a live modifier (deep copy) for presets and pinned modifiers. */
export function snapshotEffect(m: ModifierInstance): ModifierInstance {
  const snap = cloneModifier(m);
  snap.targetFixtureIds = [...(m.targetFixtureIds ?? [])];
  return snap;
}
