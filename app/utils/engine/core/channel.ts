import type { ChannelType } from '../types';
import type { OflCapability, OflWheel } from '~/utils/ofl/types';

/**
 * Describes how the channel contributes to the fixture's visual output.
 * - COLOR: The channel represents a specific light color (e.g., red, green, blue, white, amber).
 * - DIMMER: The channel scales all COLOR channels (0 = off, 255 = full).
 * - COLOR_WHEEL: The DMX value SELECTS a color (wheel slot / preset) — it does NOT scale brightness.
 * - SHUTTER: The DMX value gates the output (open / closed / strobe) — it does NOT scale brightness.
 * - NONE: The channel has no color contribution (e.g., Pan, Tilt).
 */
export type ChannelRole = 'COLOR' | 'DIMMER' | 'COLOR_WHEEL' | 'SHUTTER' | 'NONE';

/**
 * One DMX range of a COLOR_WHEEL or SHUTTER channel, describing its render effect.
 * Serializable — persisted with the project so render behavior survives reloads
 * (the OFL capabilities themselves are not persisted).
 */
export type RenderRange =
  | {
      kind: 'shutter';
      /** Inclusive 8-bit DMX bounds of this range. */
      min: number;
      max: number;
      /** Strobe frequency at min/max, lerped across the range: -1 = closed, 0 = open, >0 = Hz. */
      freqStart: number;
      freqEnd: number;
    }
  | {
      kind: 'color';
      min: number;
      max: number;
      /** Slot/preset color at the start of the range (0-255 each). */
      rgb: [number, number, number];
      /** Optional color at the end of the range (split-slot crossfade). */
      rgbEnd?: [number, number, number];
    };

export interface ChannelRenderInfo {
  ranges: RenderRange[];
}

/**
 * Represents a single DMX channel of a fixture.
 * Channels are created as plain objects (no subclasses) via the OFL fixture factory.
 */
export interface Channel {
  /** The OFL-aligned channel type (e.g. RED, GREEN, DIMMER, PAN). */
  type: ChannelType;
  /** 0-based index offset from the fixture's startAddress */
  addressOffset: number;
  /** Number of DMX bytes this channel spans (1 = 8-bit, 2 = 16-bit, 3 = 24-bit). Default is 1. */
  resolution?: 1 | 2 | 3;
  /** Offsets for the fine and ultra-fine channels, if resolution > 1. */
  fineAddressOffsets?: number[];
  /** True if this channel represents a lower byte/fine alias of another channel. */
  isFine?: boolean;

  /**
   * Current DMX output value (0–255), written each frame by the EffectEngine.
   */
  // Removed `value` and `currentBaseValue` in favor of Float32Array and Uint8Array in the engine.
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
  /**
   * Lower DMX bound (0-255) for this channel. The rendered value is remapped
   * (not clipped) into [rangeMin, rangeMax]. Defaults to 0 (full range).
   */
  rangeMin?: number;
  /**
   * Upper DMX bound (0-255) for this channel. See rangeMin. Defaults to 255.
   */
  rangeMax?: number;
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
   * Render semantics for COLOR_WHEEL and SHUTTER channels, derived from the OFL
   * capabilities at fixture creation. Persisted (unlike oflCapabilities).
   */
  renderInfo?: ChannelRenderInfo;
  /**
   * Chaser configuration and programmed step values for this channel.
   * Always present — even a static channel has a chaserConfig with a single stepValue.
   */
  chaserConfig: import('../types').ChannelChaserConfig;
}
