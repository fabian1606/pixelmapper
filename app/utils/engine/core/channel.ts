import type { ChannelType } from '../types';

/**
 * Describes how the channel contributes to the fixture's visual output.
 * - COLOR: The channel represents a specific light color (e.g., red, green, blue).
 * - DIMMER: The channel scales all COLOR channels (0 = off, 255 = full).
 * - NONE: The channel has no color contribution (e.g., Pan, Tilt, Strobe).
 */
export type ChannelRole = 'COLOR' | 'DIMMER' | 'NONE';

export interface Channel {
  type: ChannelType;
  value: number;
  baseValue: number;
  /** The role of this channel in final color computation. */
  role: ChannelRole;
  /** The hex color this channel contributes when at full value (only relevant for role=COLOR). */
  colorValue: string;
}

export class RedChannel implements Channel {
  type: ChannelType = 'RED';
  value: number = 0;
  baseValue: number = 0;
  role: ChannelRole = 'COLOR';
  colorValue: string = '#FF0000';
}

export class GreenChannel implements Channel {
  type: ChannelType = 'GREEN';
  value: number = 0;
  baseValue: number = 0;
  role: ChannelRole = 'COLOR';
  colorValue: string = '#00FF00';
}

export class BlueChannel implements Channel {
  type: ChannelType = 'BLUE';
  value: number = 0;
  baseValue: number = 0;
  role: ChannelRole = 'COLOR';
  colorValue: string = '#0000FF';
}

export class DimmerChannel implements Channel {
  type: ChannelType = 'DIMMER';
  value: number = 255;
  baseValue: number = 255;
  role: ChannelRole = 'DIMMER';
  colorValue: string = '#FFFFFF';
}
