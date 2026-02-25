import type { ChannelType } from '../types';
import { type Channel, RedChannel, GreenChannel, BlueChannel, DimmerChannel } from './channel';
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
  channels: Channel[];

  /**
   * The world-space position of this fixture (normalized 0-1 by default, editable in the Fixture Editor).
   */
  fixturePosition: FixturePosition;

  /**
   * The world-space size of this fixture (normalized 0-1 by default, editable in the Fixture Editor).
   */
  fixtureSize: FixtureSize;

  /**
   * The beams of this fixture. Each beam has a local offset relative to `fixturePosition`.
   * For simple single-LED fixtures, this is always one Beam at 0|0.
   * Complex fixtures (e.g., multi-pixel LED bars) may have many beams.
   */
  beams: Beam[];

  constructor(id: string | number, channels: Channel[] = []) {
    this.id = id;
    this.channels = channels;
    this.fixturePosition = { x: 0, y: 0 };
    this.fixtureSize = { x: 1, y: 1 };
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

    // Determine dimmer multiplier (0.0 – 1.0). If no dimmer, assume full brightness.
    const dimmerMultiplier = dimmerChannels.length > 0
      ? dimmerChannels.reduce((sum, d) => sum + d.value, 0) / (dimmerChannels.length * 255)
      : 1.0;

    // Additively mix all color channels, scaled by their current value / 255.
    let r = 0, g = 0, b = 0;
    for (const ch of colorChannels) {
      const factor = ch.value / 255;
      // Parse the hex colorValue to extract RGB components
      const hex = ch.colorValue.replace('#', '');
      r += parseInt(hex.substring(0, 2), 16) * factor;
      g += parseInt(hex.substring(2, 4), 16) * factor;
      b += parseInt(hex.substring(4, 6), 16) * factor;
    }

    // Apply dimmer and clamp to 0-255
    const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v * dimmerMultiplier)));
    return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
  }

  /**
   * Factory method: Creates a generic RGB fixture with a Dimmer.
   */
  static createRGBFixture(id: number | string): Fixture {
    return new Fixture(id, [
      new RedChannel(),
      new GreenChannel(),
      new BlueChannel(),
      new DimmerChannel(),
    ]);
  }
}
