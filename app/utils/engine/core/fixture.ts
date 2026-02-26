import type { ChannelType, SpatialVector } from '../types';
import type { Channel } from './channel';
import { Beam } from './beam';

export interface FixturePosition {
  x: number;
  y: number;
}

export interface FixtureSize {
  x: number;
  y: number;
}

export class Fixture {
  id: string | number;
  name: string;
  channels: Channel[];
  parent: import('./group').FixtureGroup | null = null;

  fixturePosition: FixturePosition;
  fixtureSize: FixtureSize;

  /**
   * Spatial effect configuration for this fixture.
   * Defines the gradient-style vector (origin, direction, magnitude)
   * that controls how the effect propagates across the stage.
   */
  spatialConfig: SpatialVector;

  beams: Beam[];

  /**
   * Optional reference to the OFL fixture key this fixture was created from.
   * Format: "manufacturer-key/fixture-key" (e.g. "generic/rgb-fader").
   */
  oflKey?: string;

  constructor(id: string | number, channels: Channel[] = []) {
    this.id = id;
    this.name = `Fixture ${id}`;
    this.channels = channels;
    this.fixturePosition = { x: 0, y: 0 };
    this.fixtureSize = { x: 1, y: 1 };
    this.spatialConfig = {
      originX: 0.5,
      originY: 0.5,
      angle: 0,
      magnitude: 0.2,
    };
    this.beams = [new Beam('beam-0', 0, 0)];
  }

  /**
   * Retreives all channels of the specified type from this fixture.
   */
  getChannelsByType(type: ChannelType): Channel[] {
    return this.channels.filter(c => c.type === type);
  }

  /**
   * Updates a specific channel type with a new value.
   * If there are multiple channels of the same type, all are updated.
   */
  updateChannelValue(type: ChannelType, value: number) {
    const channels = this.getChannelsByType(type);
    for (const channel of channels) {
      channel.value = value;
    }
  }

  /**
   * Computes the final visual RGBA color of this fixture by mixing its COLOR channels
   * and applying any DIMMER channels as a global intensity multiplier.
   * Returns a CSS-compatible `rgb(r, g, b)` string.
   */
  resolveColor(): string {
    const colorChannels = this.channels.filter(c => c.role === 'COLOR');
    const dimmerChannels = this.channels.filter(c => c.role === 'DIMMER');

    const dimmerMultiplier = dimmerChannels.length > 0
      ? dimmerChannels.reduce((sum, d) => sum + d.value, 0) / (dimmerChannels.length * 255)
      : 1.0;

    let r = 0, g = 0, b = 0;
    for (const ch of colorChannels) {
      const factor = ch.value / 255;
      const hex = ch.colorValue.replace('#', '');
      r += parseInt(hex.substring(0, 2), 16) * factor;
      g += parseInt(hex.substring(2, 4), 16) * factor;
      b += parseInt(hex.substring(4, 6), 16) * factor;
    }

    const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v * dimmerMultiplier)));
    return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
  }

  /**
   * Factory method: Creates a generic DRGB fixture (Dimmer + R + G + B).
   * Uses plain Channel objects aligned with the OFL format.
   * Maps to OFL fixture "generic/drgb-fader".
   */
  static createRGBFixture(id: number | string): Fixture {
    const fixture = new Fixture(id, [
      { type: 'RED', value: 0, baseValue: 0, role: 'COLOR', colorValue: '#FF0000' },
      { type: 'GREEN', value: 0, baseValue: 0, role: 'COLOR', colorValue: '#00FF00' },
      { type: 'BLUE', value: 0, baseValue: 0, role: 'COLOR', colorValue: '#0000FF' },
      { type: 'DIMMER', value: 255, baseValue: 255, role: 'DIMMER', colorValue: '#FFFFFF' },
    ]);
    fixture.oflKey = 'generic/drgb-fader';
    return fixture;
  }
}
