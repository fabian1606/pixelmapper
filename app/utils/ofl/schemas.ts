/**
 * Zod schemas for the Open Fixture Library (OFL) JSON fixture format.
 * These are the single source of truth — TypeScript types are derived via z.infer<>.
 *
 * Reference: https://github.com/OpenLightingProject/open-fixture-library/blob/master/docs/fixture-format.md
 * JSON schemas: ofl-data/schemas/
 */
import { z } from 'zod';

// ─── Capability base (shared by every capability type) ────────────────────────

const CapabilityBase = {
  dmxRange: z.tuple([z.number().int(), z.number().int()]).optional(),
  comment: z.string().optional(),
  helpWanted: z.string().optional(),
  menuClick: z.enum(['start', 'center', 'end', 'hidden']).optional(),
  switchChannels: z.record(z.string(), z.string()).optional(),
};

// ─── Capability discriminated union ──────────────────────────────────────────

export const OflCapabilitySchema = z.discriminatedUnion('type', [
  // NoFunction
  z.object({ type: z.literal('NoFunction'), ...CapabilityBase }).describe('Used for DMX ranges with no effect, blackout, or unused slots.'),

  // ShutterStrobe
  z.object({
    type: z.literal('ShutterStrobe'),
    shutterEffect: z.enum(['Open', 'Closed', 'Strobe', 'Pulse', 'RampUp', 'RampDown', 'RampUpDown', 'Lightning', 'Spikes', 'Burst']),
    soundControlled: z.boolean().optional(),
    randomTiming: z.boolean().optional(),
    speed: z.string().optional(),
    speedStart: z.string().optional(),
    speedEnd: z.string().optional(),
    duration: z.string().optional(),
    durationStart: z.string().optional(),
    durationEnd: z.string().optional(),
    ...CapabilityBase,
  }).describe('For master shutter or strobe channels. Use "Strobe" for standard blinking effects.'),

  // StrobeSpeed
  z.object({
    type: z.literal('StrobeSpeed'),
    speed: z.string().optional(),
    speedStart: z.string().optional(),
    speedEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // StrobeDuration
  z.object({
    type: z.literal('StrobeDuration'),
    duration: z.string().optional(),
    durationStart: z.string().optional(),
    durationEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // Intensity
  z.object({
    type: z.literal('Intensity'),
    brightness: z.string().optional(),
    brightnessStart: z.string().optional(),
    brightnessEnd: z.string().optional(),
    ...CapabilityBase,
  }).describe('For master dimmer or brightness channels (white/white-only fixtures).'),

  // ColorIntensity
  z.object({
    type: z.literal('ColorIntensity'),
    color: z.enum(['Red', 'Green', 'Blue', 'Cyan', 'Magenta', 'Yellow', 'Amber', 'White', 'Warm White', 'Cold White', 'UV', 'Lime', 'Indigo']),
    brightness: z.string().optional(),
    brightnessStart: z.string().optional(),
    brightnessEnd: z.string().optional(),
    ...CapabilityBase,
  }).describe('CRITICAL: Use this for individual Red, Green, Blue, Amber, White, etc., DMX channels in an RGB/RGBW fixture.'),

  // ColorPreset
  z.object({
    type: z.literal('ColorPreset'),
    colors: z.array(z.string()).optional(),
    colorsStart: z.array(z.string()).optional(),
    colorsEnd: z.array(z.string()).optional(),
    colorTemperature: z.string().optional(),
    colorTemperatureStart: z.string().optional(),
    colorTemperatureEnd: z.string().optional(),
    ...CapabilityBase,
  }).describe('CRITICAL: Use this for "Color Macro", "Static Color", or "Color Wheel" channels that pick fixed color presets. Provide HEX values in the colors array.'),

  // ColorTemperature
  z.object({
    type: z.literal('ColorTemperature'),
    colorTemperature: z.string().optional(),
    colorTemperatureStart: z.string().optional(),
    colorTemperatureEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // Pan
  z.object({
    type: z.literal('Pan'),
    angle: z.string().optional(),
    angleStart: z.string().optional(),
    angleEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // PanContinuous
  z.object({
    type: z.literal('PanContinuous'),
    speed: z.string().optional(),
    speedStart: z.string().optional(),
    speedEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // Tilt
  z.object({
    type: z.literal('Tilt'),
    angle: z.string().optional(),
    angleStart: z.string().optional(),
    angleEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // TiltContinuous
  z.object({
    type: z.literal('TiltContinuous'),
    speed: z.string().optional(),
    speedStart: z.string().optional(),
    speedEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // PanTiltSpeed
  z.object({
    type: z.literal('PanTiltSpeed'),
    speed: z.string().optional(),
    speedStart: z.string().optional(),
    speedEnd: z.string().optional(),
    duration: z.string().optional(),
    durationStart: z.string().optional(),
    durationEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // WheelSlot
  z.object({
    type: z.literal('WheelSlot'),
    wheel: z.string().optional(),
    slotNumber: z.number().optional(),
    slotNumberStart: z.number().optional(),
    slotNumberEnd: z.number().optional(),
    ...CapabilityBase,
  }),

  // WheelShake
  z.object({
    type: z.literal('WheelShake'),
    wheel: z.union([z.string(), z.array(z.string())]).optional(),
    isShaking: z.enum(['wheel', 'slot']).optional(),
    slotNumber: z.number().optional(),
    slotNumberStart: z.number().optional(),
    slotNumberEnd: z.number().optional(),
    shakeSpeed: z.string().optional(),
    shakeSpeedStart: z.string().optional(),
    shakeSpeedEnd: z.string().optional(),
    shakeAngle: z.string().optional(),
    shakeAngleStart: z.string().optional(),
    shakeAngleEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // WheelSlotRotation
  z.object({
    type: z.literal('WheelSlotRotation'),
    wheel: z.union([z.string(), z.array(z.string())]).optional(),
    slotNumber: z.number().optional(),
    slotNumberStart: z.number().optional(),
    slotNumberEnd: z.number().optional(),
    speed: z.string().optional(),
    speedStart: z.string().optional(),
    speedEnd: z.string().optional(),
    angle: z.string().optional(),
    angleStart: z.string().optional(),
    angleEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // WheelRotation
  z.object({
    type: z.literal('WheelRotation'),
    wheel: z.union([z.string(), z.array(z.string())]).optional(),
    speed: z.string().optional(),
    speedStart: z.string().optional(),
    speedEnd: z.string().optional(),
    angle: z.string().optional(),
    angleStart: z.string().optional(),
    angleEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // Effect
  z.object({
    type: z.literal('Effect'),
    effectName: z.string().optional(),
    effectPreset: z.enum(['ColorJump', 'ColorFade']).optional(),
    speed: z.string().optional(),
    speedStart: z.string().optional(),
    speedEnd: z.string().optional(),
    duration: z.string().optional(),
    durationStart: z.string().optional(),
    durationEnd: z.string().optional(),
    parameter: z.string().optional(),
    parameterStart: z.string().optional(),
    parameterEnd: z.string().optional(),
    soundControlled: z.boolean().optional(),
    soundSensitivity: z.string().optional(),
    soundSensitivityStart: z.string().optional(),
    soundSensitivityEnd: z.string().optional(),
    ...CapabilityBase,
  }).describe('CRITICAL: Use this for "Internal Programs", "Built-in Effects", "Macros", or "Auto Modes" channels. Provide a descriptive label in effectName.'),

  // EffectSpeed
  z.object({
    type: z.literal('EffectSpeed'),
    speed: z.string().optional(),
    speedStart: z.string().optional(),
    speedEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // EffectDuration
  z.object({
    type: z.literal('EffectDuration'),
    duration: z.string().optional(),
    durationStart: z.string().optional(),
    durationEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // EffectParameter
  z.object({
    type: z.literal('EffectParameter'),
    parameter: z.string().optional(),
    parameterStart: z.string().optional(),
    parameterEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // SoundSensitivity
  z.object({
    type: z.literal('SoundSensitivity'),
    soundSensitivity: z.string().optional(),
    soundSensitivityStart: z.string().optional(),
    soundSensitivityEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // BeamAngle
  z.object({
    type: z.literal('BeamAngle'),
    angle: z.string().optional(),
    angleStart: z.string().optional(),
    angleEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // BeamPosition
  z.object({
    type: z.literal('BeamPosition'),
    horizontalAngle: z.string().optional(),
    horizontalAngleStart: z.string().optional(),
    horizontalAngleEnd: z.string().optional(),
    verticalAngle: z.string().optional(),
    verticalAngleStart: z.string().optional(),
    verticalAngleEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // Focus
  z.object({
    type: z.literal('Focus'),
    distance: z.string().optional(),
    distanceStart: z.string().optional(),
    distanceEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // Zoom
  z.object({
    type: z.literal('Zoom'),
    angle: z.string().optional(),
    angleStart: z.string().optional(),
    angleEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // Iris
  z.object({
    type: z.literal('Iris'),
    openPercent: z.string().optional(),
    openPercentStart: z.string().optional(),
    openPercentEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // IrisEffect
  z.object({
    type: z.literal('IrisEffect'),
    effectName: z.string(),
    speed: z.string().optional(),
    speedStart: z.string().optional(),
    speedEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // Frost
  z.object({
    type: z.literal('Frost'),
    frostIntensity: z.string().optional(),
    frostIntensityStart: z.string().optional(),
    frostIntensityEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // FrostEffect
  z.object({
    type: z.literal('FrostEffect'),
    effectName: z.string(),
    speed: z.string().optional(),
    speedStart: z.string().optional(),
    speedEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // Prism
  z.object({
    type: z.literal('Prism'),
    speed: z.string().optional(),
    speedStart: z.string().optional(),
    speedEnd: z.string().optional(),
    angle: z.string().optional(),
    angleStart: z.string().optional(),
    angleEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // PrismRotation
  z.object({
    type: z.literal('PrismRotation'),
    speed: z.string().optional(),
    speedStart: z.string().optional(),
    speedEnd: z.string().optional(),
    angle: z.string().optional(),
    angleStart: z.string().optional(),
    angleEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // BladeInsertion
  z.object({
    type: z.literal('BladeInsertion'),
    blade: z.union([z.enum(['Top', 'Right', 'Bottom', 'Left']), z.number().int()]),
    insertion: z.string().optional(),
    insertionStart: z.string().optional(),
    insertionEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // BladeRotation
  z.object({
    type: z.literal('BladeRotation'),
    blade: z.union([z.enum(['Top', 'Right', 'Bottom', 'Left']), z.number().int()]),
    angle: z.string().optional(),
    angleStart: z.string().optional(),
    angleEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // BladeSystemRotation
  z.object({
    type: z.literal('BladeSystemRotation'),
    angle: z.string().optional(),
    angleStart: z.string().optional(),
    angleEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // Fog
  z.object({
    type: z.literal('Fog'),
    fogType: z.enum(['Fog', 'Haze']).optional(),
    fogOutput: z.string().optional(),
    fogOutputStart: z.string().optional(),
    fogOutputEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // FogOutput
  z.object({
    type: z.literal('FogOutput'),
    fogOutput: z.string().optional(),
    fogOutputStart: z.string().optional(),
    fogOutputEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // FogType
  z.object({
    type: z.literal('FogType'),
    fogType: z.enum(['Fog', 'Haze']),
    ...CapabilityBase,
  }),

  // Rotation
  z.object({
    type: z.literal('Rotation'),
    speed: z.string().optional(),
    speedStart: z.string().optional(),
    speedEnd: z.string().optional(),
    angle: z.string().optional(),
    angleStart: z.string().optional(),
    angleEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // Speed
  z.object({
    type: z.literal('Speed'),
    speed: z.string().optional(),
    speedStart: z.string().optional(),
    speedEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // Time
  z.object({
    type: z.literal('Time'),
    time: z.string().optional(),
    timeStart: z.string().optional(),
    timeEnd: z.string().optional(),
    ...CapabilityBase,
  }),

  // Maintenance
  z.object({
    type: z.literal('Maintenance'),
    parameter: z.string().optional(),
    parameterStart: z.string().optional(),
    parameterEnd: z.string().optional(),
    hold: z.string().optional(),
    ...CapabilityBase,
  }),

  // Generic
  z.object({
    type: z.literal('Generic'),
    ...CapabilityBase,
  }),
]);

export type OflCapability = z.infer<typeof OflCapabilitySchema>;
export type OflCapabilityType = OflCapability['type'];
export type OflColor = Extract<OflCapability, { type: 'ColorIntensity' }>['color'];

// ─── Channel ──────────────────────────────────────────────────────────────────

export const OflChannelSchema = z.object({
  name: z.string().optional(),
  fineChannelAliases: z.array(z.string()).optional(),
  dmxValueResolution: z.enum(['8bit', '16bit', '24bit']).optional(),
  defaultValue: z.union([z.number().int(), z.string()]).optional(),
  highlightValue: z.union([z.number().int(), z.string()]).optional(),
  constant: z.boolean().optional(),
  precedence: z.enum(['HTP', 'LTP']).optional(),
  capability: OflCapabilitySchema.optional(),
  capabilities: z.array(OflCapabilitySchema).optional(),
});

export type OflChannel = z.infer<typeof OflChannelSchema>;

// ─── Physical ─────────────────────────────────────────────────────────────────

export const OflPhysicalSchema = z.object({
  dimensions: z.tuple([z.number(), z.number(), z.number()]).describe('Physical Dimensions').optional(),
  weight: z.number().describe('Weight').optional(),
  power: z.number().describe('Power Consumption').optional(),
  DMXconnector: z.enum([
    '3-pin', '3-pin (swapped +/-)', '3-pin XLR IP65',
    '5-pin', '5-pin XLR IP65', '3-pin and 5-pin',
    '3.5mm stereo jack', 'RJ45',
  ]).describe('DMX Connector').optional(),
  bulb: z.object({
    type: z.string().describe('Light Source Type').optional(),
    colorTemperature: z.number().describe('Color Temperature').optional(),
    lumens: z.number().optional(),
  }).optional(),
  lens: z.object({
    name: z.string().optional(),
    degreesMinMax: z.tuple([z.number(), z.number()]).describe('Beam Angle').optional(),
  }).optional(),
  matrixPixels: z.object({
    dimensions: z.tuple([z.number(), z.number(), z.number()]).optional(),
    spacing: z.tuple([z.number(), z.number(), z.number()]).optional(),
  }).optional(),
});

export type OflPhysical = z.infer<typeof OflPhysicalSchema>;

// ─── Matrix channel insert ────────────────────────────────────────────────────

export const OflMatrixChannelInsertSchema = z.object({
  insert: z.literal('matrixChannels'),
  repeatFor: z.union([
    z.enum([
      'eachPixelABC',
      'eachPixelXYZ', 'eachPixelXZY',
      'eachPixelYXZ', 'eachPixelYZX',
      'eachPixelZXY', 'eachPixelZYX',
      'eachPixelGroup',
    ]),
    z.array(z.string()),
  ]),
  channelOrder: z.enum(['perPixel', 'perChannel']),
  templateChannels: z.array(z.union([z.string(), z.null()])),
});

export type OflMatrixChannelInsert = z.infer<typeof OflMatrixChannelInsertSchema>;

// ─── Mode ─────────────────────────────────────────────────────────────────────

export const OflModeSchema = z.object({
  name: z.string(),
  shortName: z.string().optional(),
  rdmPersonalityIndex: z.number().int().optional(),
  physical: OflPhysicalSchema.optional(),
  channels: z.array(z.union([z.string(), z.null(), OflMatrixChannelInsertSchema])),
});

export type OflMode = z.infer<typeof OflModeSchema>;

// ─── Wheels ───────────────────────────────────────────────────────────────────

export const OflWheelSlotSchema = z.object({
  type: z.enum(['Open', 'Closed', 'Color', 'Gobo', 'Prism', 'Iris', 'Frost', 'AnimationGoboStart', 'AnimationGoboEnd']),
  name: z.string().optional(),
  colors: z.array(z.string()).optional(),
  colorTemperature: z.string().optional(),
  resource: z.string().optional(),
  facets: z.number().int().optional(),
  openPercent: z.string().optional(),
  frostIntensity: z.string().optional(),
});

export type OflWheelSlot = z.infer<typeof OflWheelSlotSchema>;

export const OflWheelSchema = z.object({
  direction: z.enum(['CW', 'CCW']).optional(),
  slots: z.array(OflWheelSlotSchema),
});

export type OflWheel = z.infer<typeof OflWheelSchema>;

// ─── Matrix ───────────────────────────────────────────────────────────────────

export const OflMatrixSchema = z.object({
  pixelCount: z.tuple([z.number().int(), z.number().int(), z.number().int()]).optional(),
  pixelKeys: z.array(z.array(z.array(z.union([z.string(), z.null()])))).optional(),
  pixelGroups: z.record(
    z.string(),
    z.union([z.literal('all'), z.array(z.string()), z.record(z.string(), z.unknown())])
  ).optional(),
});

export type OflMatrix = z.infer<typeof OflMatrixSchema>;

// ─── Fixture meta ─────────────────────────────────────────────────────────────

export const OflFixtureMetaSchema = z.object({
  authors: z.array(z.string()),
  createDate: z.string(),
  lastModifyDate: z.string(),
  importPlugin: z.object({
    plugin: z.string(),
    date: z.string(),
    comment: z.string().optional(),
  }).optional(),
});

export type OflFixtureMeta = z.infer<typeof OflFixtureMetaSchema>;

// ─── Fixture ──────────────────────────────────────────────────────────────────

export const OflFixtureSchema = z.object({
  $schema: z.string(),
  name: z.string().describe('Fixture Name'),
  shortName: z.string().describe('Short Name').optional(),
  categories: z.array(z.string()),
  meta: OflFixtureMetaSchema,
  comment: z.string().describe('Description').optional(),
  helpWanted: z.string().optional(),
  links: z.record(z.string(), z.array(z.string())).optional(),
  rdm: z.object({
    modelId: z.number().int(),
    softwareVersion: z.string().optional(),
  }).optional(),
  physical: OflPhysicalSchema.optional(),
  wheels: z.record(z.string(), OflWheelSchema).optional(),
  availableChannels: z.record(z.string(), OflChannelSchema).optional(),
  templateChannels: z.record(z.string(), OflChannelSchema).optional(),
  modes: z.array(OflModeSchema),
  matrix: OflMatrixSchema.optional(),
});

export type OflFixture = z.infer<typeof OflFixtureSchema>;

// ─── Manufacturers ────────────────────────────────────────────────────────────

export const OflManufacturerSchema = z.object({
  name: z.string(),
  website: z.string().optional(),
  rdmId: z.number().int().optional(),
});

export type OflManufacturer = z.infer<typeof OflManufacturerSchema>;

export const OflManufacturersSchema = z.record(z.string(), OflManufacturerSchema);
export type OflManufacturers = z.infer<typeof OflManufacturersSchema>;

// ─── API types (returned by Nuxt server routes) ───────────────────────────────

export const ManufacturerSummarySchema = z.object({
  key: z.string(),
  name: z.string(),
  fixtureCount: z.number().int(),
});

export type ManufacturerSummary = z.infer<typeof ManufacturerSummarySchema>;

export const FixtureSummarySchema = z.object({
  key: z.string(),
  manufacturer: z.string(),
  manufacturerKey: z.string(),
  name: z.string(),
  shortName: z.string(),
  categories: z.array(z.string()),
  modes: z.array(z.object({
    name: z.string(),
    shortName: z.string(),
    channelCount: z.number().int(),
  })),
});

export type FixtureSummary = z.infer<typeof FixtureSummarySchema>;
