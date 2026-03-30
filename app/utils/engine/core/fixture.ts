import type { ChannelType, SpatialVector } from '../types';
import type { Channel } from './channel';
import { Beam } from './beam';
import { reactive } from 'vue';
import type { OflFixture } from '~/utils/ofl/types';

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
  startAddress: number; // 1-based DMX start address

  fixturePosition: FixturePosition;
  fixtureSize: FixtureSize;
  rotation: number = 0; // Degrees (0-360)

  manufacturer: string = '';
  fixtureType: string = '';

  get universe(): number {
    return Math.floor((this.startAddress - 1) / 512) + 1;
  }

  get localAddress(): number {
    return ((this.startAddress - 1) % 512) + 1;
  }

  beams: Beam[];

  /**
   * Optional reference to the OFL fixture key this fixture was created from.
   * Format: "manufacturer-key/fixture-key" (e.g. "generic/rgb-fader").
   */
  oflKey?: string;

  /**
   * Original OFL fixture definition, stored for editing a fixture type.
   */
  definition?: OflFixture;

  constructor(id: string | number, channels: Channel[] = [], startAddress: number = 1) {
    this.id = id;
    this.name = `Fixture ${id}`;
    this.channels = channels;
    this.startAddress = startAddress;
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
   * Computes the final visual RGBA color of this fixture (or a specific beam).
   * Mixes its COLOR channels and applies any DIMMER channels as a global intensity multiplier.
   * Channels without a beamId apply to all beams (e.g., Master Dimmer).
   */
  resolveColor(dmxBuffer: Uint8Array, beamId?: string): string {
    const applies = (c: Channel) => !beamId || !c.beamId || c.beamId === beamId;

    const colorChannels = this.channels.filter(c => c.role === 'COLOR' && applies(c));
    const dimmerChannels = this.channels.filter(c => c.role === 'DIMMER' && applies(c));

    const dimmerMultiplier = dimmerChannels.length > 0
      ? dimmerChannels.reduce((sum, d) => sum + (dmxBuffer[this.startAddress - 1 + d.addressOffset] ?? 0), 0) / (dimmerChannels.length * 255)
      : 1.0;


    let r = 0, g = 0, b = 0;
    for (const ch of colorChannels) {
      if (!ch.colorValue) continue;
      const val = dmxBuffer[this.startAddress - 1 + ch.addressOffset] ?? 0;
      const factor = val / 255;
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
    const makeChaser = (defaultVal: number): import('./channel').Channel['chaserConfig'] => reactive({
      stepValues: [defaultVal],
      stepsCount: 1,
      activeEditStep: 0,
      isPlaying: false,
      stepDuration: { mode: 'time', timeMs: 1000, beatValue: 1, beatOffset: 0 },
      fadeDuration: { mode: 'time', timeMs: 0, beatValue: 0, beatOffset: 0 },
    });

    const fixture = new Fixture(id, [
      { type: 'RED', addressOffset: 0, role: 'COLOR', colorValue: '#FF0000', defaultValue: 0, chaserConfig: makeChaser(255) },
      { type: 'GREEN', addressOffset: 1, role: 'COLOR', colorValue: '#00FF00', defaultValue: 0, chaserConfig: makeChaser(255) },
      { type: 'BLUE', addressOffset: 2, role: 'COLOR', colorValue: '#0000FF', defaultValue: 0, chaserConfig: makeChaser(255) },
      { type: 'DIMMER', addressOffset: 3, role: 'DIMMER', colorValue: '#FFFFFF', defaultValue: 0, chaserConfig: makeChaser(255) },
    ]);

    fixture.oflKey = 'generic/drgb-fader';
    return fixture;
  }
}
