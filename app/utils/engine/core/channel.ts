import type { ChannelType } from '../types';

export interface Channel {
  type: ChannelType;
  value: number;
  baseValue: number;
}

export class RedChannel implements Channel {
  type: ChannelType = 'RED';
  value: number = 0;
  baseValue: number = 0;
}

export class GreenChannel implements Channel {
  type: ChannelType = 'GREEN';
  value: number = 0;
  baseValue: number = 0;
}

export class BlueChannel implements Channel {
  type: ChannelType = 'BLUE';
  value: number = 0;
  baseValue: number = 0;
}

export class DimmerChannel implements Channel {
  type: ChannelType = 'DIMMER';
  value: number = 0;
  baseValue: number = 0;
}
