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

/**
 * Identifies a NeoPixel-style addressable LED strip chip.
 * Determines DMX channels per LED (RGB = 3, RGBW = 4) and is also surfaced as metadata.
 */
export type NeoPixelChipType =
  | 'WS2812B'
  | 'WS2811'
  | 'APA102'
  | 'SK6812-RGB'
  | 'SK6812-RGBW';

/**
 * A vertex along the polyline of a NeoPixel strip, in WORLD-PIXEL coordinates
 * (matching `fixturePosition.x * WORLD_WIDTH` etc., NOT normalized 0-1).
 */
export interface StripPoint {
  x: number;
  y: number;
}

/**
 * Parametric definition of a NeoPixel LED strip fixture.
 * Stored on Fixture.stripConfig when the fixture is a programmatically generated strip.
 *
 * The strip's physical shape is a polyline of `points` (≥ 2 vertices) in
 * world-pixel coordinates. LEDs are distributed evenly along the polyline's
 * total arc length.
 *
 * Beams = logical pixels (groups of `groupSize` physical LEDs sharing a color).
 *   logicalPixelCount = ceil(ledCount / groupSize)
 * DMX channels = logicalPixelCount * channelsPerPixel(chipType)
 *
 * `lengthMeters` is the LOGICAL length implied by `ledCount / ledsPerMeter`.
 * The polyline's geometric length is independent — the user may shape it freely.
 */
export interface StripConfig {
  chipType: NeoPixelChipType;
  /** Number of physical LEDs on the strip. */
  ledCount: number;
  /** Physical LED density used to derive `lengthMeters`. */
  ledsPerMeter: number;
  /** N physical LEDs share one logical pixel (1 = every LED individually addressable). */
  groupSize: number;
  /** Logical strip length = ledCount / ledsPerMeter. */
  lengthMeters: number;
  /** Polyline vertices in world-pixel coordinates. Must contain ≥ 2 points. */
  points: StripPoint[];
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

  /**
   * Set when this fixture is a parametrically generated NeoPixel LED strip
   * (created by `createNeoPixelStripFixture`). Drives the strip render mode
   * and Figma-style fixed-length endpoint interaction.
   */
  stripConfig?: StripConfig;

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
