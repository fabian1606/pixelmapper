/**
 * TypeScript interfaces that mirror the Open Fixture Library (OFL) JSON fixture format.
 * Reference: https://github.com/OpenLightingProject/open-fixture-library/blob/master/docs/fixture-format.md
 */

// ─── Capability Types ────────────────────────────────────────────────────────

export type OflCapabilityType =
  | 'Intensity'
  | 'ColorIntensity'
  | 'ColorPreset'
  | 'ColorTemperature'
  | 'Pan'
  | 'PanContinuous'
  | 'Tilt'
  | 'TiltContinuous'
  | 'PanTiltSpeed'
  | 'WheelSlot'
  | 'WheelShake'
  | 'WheelSlotRotation'
  | 'WheelRotation'
  | 'Effect'
  | 'EffectSpeed'
  | 'EffectDuration'
  | 'EffectParameter'
  | 'SoundSensitivity'
  | 'BeamAngle'
  | 'BeamPosition'
  | 'Focus'
  | 'Zoom'
  | 'ShutterStrobe'
  | 'StrobeSpeed'
  | 'StrobeDuration'
  | 'Iris'
  | 'IrisEffect'
  | 'Frost'
  | 'FrostEffect'
  | 'Prism'
  | 'PrismRotation'
  | 'BladeInsertion'
  | 'BladeRotation'
  | 'BladeSystemRotation'
  | 'Fog'
  | 'FogOutput'
  | 'FogType'
  | 'Rotation'
  | 'Speed'
  | 'Time'
  | 'Maintenance'
  | 'Generic'
  | 'NoFunction';

/** Named colors used in ColorIntensity capabilities */
export type OflColor =
  | 'Red'
  | 'Green'
  | 'Blue'
  | 'Cyan'
  | 'Magenta'
  | 'Yellow'
  | 'Amber'
  | 'White'
  | 'Warm White'
  | 'Cold White'
  | 'UV'
  | 'Lime'
  | 'Indigo';

// ─── Capability ───────────────────────────────────────────────────────────────

export interface OflCapability {
  /** Start and end DMX values for this capability range (8-bit: 0–255) */
  dmxRange?: [number, number];
  type: OflCapabilityType;
  /** For ColorIntensity: which color this channel controls */
  color?: OflColor;
  /** Human-readable comment */
  comment?: string;
  /** Shutter effect type for ShutterStrobe capabilities */
  shutterEffect?: string;
  /** Brightness range start (e.g. "0%") */
  brightnessStart?: string;
  /** Brightness range end (e.g. "100%") */
  brightnessEnd?: string;
  /** Angle for position channels */
  angleStart?: string;
  angleEnd?: string;
}

// ─── Channel ──────────────────────────────────────────────────────────────────

export interface OflChannel {
  /**
   * Aliases to the "fine" (higher-resolution) channel keys for this channel.
   * e.g. ["Red fine", "Red fine^2"] for a 24-bit Red channel.
   * We only use the coarse (8-bit) channel in phase 1.
   */
  fineChannelAliases?: string[];
  /** Default DMX value (0-255 for 8-bit, 0-65535 for 16-bit, etc.) */
  defaultValue?: number;
  /** Highlight DMX value */
  highlightValue?: number;
  /** If true, the channel value should not change during operation */
  constant?: boolean;
  /** HTP or LTP precedence */
  precedence?: 'HTP' | 'LTP';
  /** Single capability covering the full 0-255 range */
  capability?: OflCapability;
  /** Multiple capabilities for different DMX value ranges */
  capabilities?: OflCapability[];
}

// ─── Mode ────────────────────────────────────────────────────────────────────

export interface OflMode {
  name: string;
  shortName: string;
  /** Ordered list of channel keys used in this mode */
  channels: (string | null)[];
  /** Physical property overrides specific to this mode */
  physical?: OflPhysical;
}

// ─── Physical ────────────────────────────────────────────────────────────────

export interface OflPhysical {
  dimensions?: [number, number, number]; // [width, height, depth] mm
  weight?: number; // kg
  power?: number; // W
  DMXconnector?: string;
  bulb?: {
    type?: string;
    colorTemperature?: number;
    lumens?: number;
  };
  lens?: {
    name?: string;
    degreesMinMax?: [number, number];
  };
  matrixPixels?: {
    dimensions?: [number, number, number];
    spacing?: [number, number, number];
  };
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

export interface ManufacturerSummary {
  key: string;
  name: string;
  fixtureCount: number;
}

export interface OflFixtureMeta {
  authors: string[];
  createDate: string;
  lastModifyDate: string;
  importPlugin?: string;
  importDate?: string;
  importComment?: string;
}

export interface OflFixture {
  $schema: string;
  name: string;
  shortName: string;
  /** Categories this fixture belongs to */
  categories: string[];
  meta: OflFixtureMeta;
  /** Comment / description for this fixture */
  comment?: string;
  physical?: OflPhysical;
  /** All channels available in any mode */
  availableChannels: Record<string, OflChannel>;
  /** Template channels for matrix fixtures */
  templateChannels?: Record<string, OflChannel>;
  /** Available operation modes */
  modes: OflMode[];
  /** Matrix pixel definition */
  matrix?: OflMatrix;
  /** RDM device identification */
  rdm?: {
    modelId: number;
    softwareVersion?: string;
  };
}

// ─── Matrix ──────────────────────────────────────────────────────────────────

export interface OflMatrix {
  pixelKeys?: (string | null)[][][];
  pixelGroups?: Record<string, (string | null)[][][] | 'all'>;
}

// ─── Manufacturers ───────────────────────────────────────────────────────────

export interface OflManufacturer {
  name: string;
  website?: string;
  rdmId?: number;
}

export type OflManufacturers = Record<string, OflManufacturer>;

// ─── API types (returned by Nuxt server routes) ───────────────────────────────

export interface FixtureSummary {
  /** Unique key in the format "manufacturer-key/fixture-key" */
  key: string;
  manufacturer: string;
  manufacturerKey: string;
  name: string;
  shortName: string;
  categories: string[];
  modes: Array<{
    name: string;
    shortName: string;
    channelCount: number;
  }>;
}
