import type { ChannelType } from '../types';

/**
 * Describes how the channel contributes to the fixture's visual output.
 * - COLOR: The channel represents a specific light color (e.g., red, green, blue, white, amber).
 * - DIMMER: The channel scales all COLOR channels (0 = off, 255 = full).
 * - NONE: The channel has no color contribution (e.g., Pan, Tilt, Strobe).
 */
export type ChannelRole = 'COLOR' | 'DIMMER' | 'NONE';

/**
 * Represents a single DMX channel of a fixture.
 * Channels are created as plain objects (no subclasses) via the OFL fixture factory.
 */
export interface Channel {
  /** The OFL-aligned channel type (e.g. RED, GREEN, DIMMER, PAN). */
  type: ChannelType;
  /** Current DMX output value (0–255), written each frame by the EffectEngine. */
  value: number;
  /** The resting value effects oscillate around. */
  baseValue: number;
  /** How this channel contributes to the fixture's visual color computation. */
  role: ChannelRole;
  /**
   * The peak hue of this channel as a hex color string.
   * Only meaningful when role === 'COLOR' or role === 'DIMMER'.
   * Examples: '#FF0000' (red), '#FFFFFF' (white/dimmer).
   */
  colorValue: string;
}
