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
  /** 0-based index offset from the fixture's startAddress */
  addressOffset: number;

  /**
   * Current DMX output value (0–255), written each frame by the EffectEngine.
   * This is a runtime scratch field — do not persist or clone it.
   */
  value: number;
  /**
   * The computed base value for this frame (interpolated between chaser steps).
   * This is a runtime scratch field — do not persist or clone it.
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
  /** Default DMX value (0-255) from OFL, used for resetting channels when 'Stop All' is pressed. */
  defaultValue: number;
  /** Matches the beam.id this channel controls in a multi-head/matrix fixture. */
  beamId?: string;
  /** All OFL capabilities for this channel (used to build the capability dropdown). */
  oflCapabilities?: OflCapability[];
  /**
   * All wheel definitions from the fixture this channel belongs to.
   * Needed to resolve slot names and slot colors for WheelSlot-type capabilities.
   */
  oflWheels?: Record<string, OflWheel>;
  /**
   * Chaser configuration and programmed step values for this channel.
   * Always present — even a static channel has a chaserConfig with a single stepValue.
   */
  chaserConfig: import('../types').ChannelChaserConfig;
}
