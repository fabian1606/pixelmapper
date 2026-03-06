import type { ChannelType, SpeedConfig, EffectDirection } from './types';

/**
 * High-level category grouping for a preset entry.
 * Used to determine the label and icon in the sidebar.
 */
export type PresetCategoryType = 'color' | 'movement' | 'beam' | 'dimmer' | 'other';

/**
 * A snapshot of a single channel's programmed state at the time the preset was saved.
 */
export interface PresetChannelSnapshot {
  /** Index of this channel within fixture.channels (stable, from OFL mode order). */
  channelIndex: number;
  channelType: ChannelType;
  stepValues: number[];
  chaserConfig?: import('./types').ChannelChaserConfig;
}

/**
 * A serialized snapshot of one Effect (modifier) as it was at save time.
 * Enough data to recreate it via SineEffect or any future effect class.
 */
export interface PresetModifierSnapshot {
  /** Effect class name, e.g. "SineEffect" – used to reconstruct the correct subclass */
  effectType: string;
  targetChannels: ChannelType[];
  /** Fixture IDs this modifier was scoped to */
  targetFixtureIds: (string | number)[];
  strength: number;
  fanning: number;
  speed: SpeedConfig;
  direction?: EffectDirection;
  reverse?: boolean;
  originX?: number;
  originY?: number;
  angle?: number;
}

/**
 * A group of fixtures (by ID and name) that share the same effect/category within a preset.
 * E.g., all fixtures that have RED/GREEN/BLUE channels programmed are grouped as "color".
 */
export interface PresetCategory {
  /** Discriminates the category icon and label in the sidebar */
  type: PresetCategoryType;
  /** Human-readable label, e.g. "MH-X25", "sls-7 led #1" */
  label: string;
  /** The ID(s) of the fixture(s) this category entry captures */
  fixtureIds: (string | number)[];
  /** The channel snapshots for all affected channels of these fixtures */
  channels: PresetChannelSnapshot[];
  /** Effect/modifier snapshots that apply to these fixtures (may be empty) */
  modifiers: PresetModifierSnapshot[];
  /** True if this category entry represents a modifier change rather than a channel value change */
  isModifier?: boolean;
}

/**
 * A named preset containing grouped channel state information,
 * ready to be applied back to matching fixtures.
 */
export interface Preset {
  id: string;
  name: string;
  /** ISO timestamp when this preset was saved */
  createdAt: string;
  /** The grouped category entries */
  categories: PresetCategory[];
}
