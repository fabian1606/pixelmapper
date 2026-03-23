import type { ChannelType, Effect } from '~/utils/engine/types';
import type {
  PresetCategoryType,
  PresetChannelSnapshot,
  PresetModifierSnapshot,
} from '~/utils/engine/preset-types';
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
export function getEffectCategoryType(effect: Effect): PresetCategoryType {
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
 * Returns a stable identity key for an effect: just its type (no channels).
 * Used to match a live effect to its saved counterpart so that ANY
 * parameter change (including target channels) collapses to one change row
 * instead of showing as a separate "removed" + "added" pair.
 */
export function getModifierIdentity(effect: Effect | PresetModifierSnapshot): string {
  return 'id' in effect && effect.id
    ? effect.id
    : ('effectType' in effect ? (effect as PresetModifierSnapshot).effectType : effect.constructor.name);
}

/**
 * Builds a full deterministic fingerprint for a modifier effect including all values.
 * Used to detect whether a particular effect's *parameters* have changed.
 */
export function getModifierFingerprint(effect: Effect | PresetModifierSnapshot): string {
  const effectType =
    'effectType' in effect
      ? (effect as PresetModifierSnapshot).effectType
      : effect.constructor.name;
  const channels = [...(effect.targetChannels ?? [])].sort().join(',');
  const direction = effect.direction ?? 'LINEAR';
  const reverse = effect.reverse ?? false;
  return `${effectType}|${channels}|${effect.strength}|${effect.fanning}|${direction}|${reverse}`;
}

// ─── Effect serialisation ─────────────────────────────────────────────────────

/** Snapshots a live Effect into a serializable PresetModifierSnapshot. */
export function snapshotEffect(effect: Effect): PresetModifierSnapshot {
  return {
    id: effect.id,
    effectType: effect.constructor.name,
    targetChannels: [...(effect.targetChannels ?? [])],
    targetFixtureIds: [...(effect.targetFixtureIds ?? [])],
    strength: effect.strength,
    fanning: effect.fanning,
    speed: { ...effect.speed },
    direction: effect.direction ?? 'LINEAR',
    reverse: effect.reverse ?? false,
    originX: effect.originX ?? 0.5,
    originY: effect.originY ?? 0.5,
    angle: effect.angle ?? 0,
  };
}
