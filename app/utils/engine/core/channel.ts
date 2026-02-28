import type { ChannelType } from '../types';
import type { OflCapability, OflWheel } from '~/utils/ofl/types';

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
  /**
   * The programmed step values for this channel.
   * If there is only 1 step, this array has length 1.
   * Chaser engines interpolate across these steps.
   */
  stepValues: number[];
  /**
   * The dynamic base value for this frame (interpolated between steps).
   * Effects are applied additively on top of this.
   */
  currentBaseValue: number;
  /** How this channel contributes to the fixture's visual color computation. */
  role: ChannelRole;
  /**
   * The peak hue of this channel as a hex color string.
   * Only meaningful when role === 'COLOR' or role === 'DIMMER'.
   * Examples: '#FF0000' (red), '#FFFFFF' (white/dimmer).
   */
  colorValue: string;
  /** Human-readable channel name from the OFL definition (e.g. 'Shutter', 'Dimmer'). */
  oflChannelName?: string;
  /** All OFL capabilities for this channel (used to build the capability dropdown). */
  oflCapabilities?: OflCapability[];
  /**
   * All wheel definitions from the fixture this channel belongs to.
   * Needed to resolve slot names and slot colors for WheelSlot-type capabilities.
   */
  oflWheels?: Record<string, OflWheel>;
  /**
   * State and configuration for building sequences natively on this channel.
   * If undefined, the channel defaults to rendering stepValues[0].
   */
  chaserConfig?: import('../types').ChannelChaserConfig;
}
