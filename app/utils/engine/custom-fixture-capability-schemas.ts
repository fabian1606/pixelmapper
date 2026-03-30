/**
 * OFL-aligned capability range schemas for the custom fixture editor.
 *
 * Each of the 45 ChannelType variants gets its own exported Zod schema
 * so that an LLM can be prompted with a specific schema to extract structured
 * capability data from a fixture manual.
 *
 * All type-specific fields are `.optional()` for backward compatibility;
 * existing data that only carries {rangeId, dmxMin, dmxMax, type, label}
 * will parse without errors.
 */

import { z } from 'zod';
import type { ChannelType } from '~/utils/engine/types';

// ─── Shared field-group objects (spread into per-type schemas) ────────────────

const RangeBase = {
  rangeId: z.string().describe('Internal UUID for this range entry'),
  dmxMin:  z.number().int().min(0).max(255).describe('Inclusive start of this DMX range (0–255)'),
  dmxMax:  z.number().int().min(0).max(255).describe('Inclusive end of this DMX range (0–255)'),
  label:   z.string().default('').describe('Optional human-readable description (e.g. "Reset", "Color Macro 1")'),
};

const BrightnessFields = {
  brightness:      z.number().optional().describe('Fixed brightness level'),
  brightnessStart: z.number().optional().describe('Start brightness for a graduated range'),
  brightnessEnd:   z.number().optional().describe('End brightness for a graduated range'),
  brightnessUnit:  z.enum(['percent', 'lm']).optional().default('percent').describe('Unit for brightness values'),
};

const AngleFields = {
  angle:      z.number().optional().describe('Fixed beam / rotation angle'),
  angleStart: z.number().optional().describe('Start of an angle range'),
  angleEnd:   z.number().optional().describe('End of an angle range'),
  angleUnit:  z.enum(['deg', 'percent']).optional().default('deg').describe('Unit for angle values'),
};

const SpeedFields = {
  speed:      z.number().optional().describe('Fixed speed'),
  speedStart: z.number().optional().describe('Start speed for a graduated range'),
  speedEnd:   z.number().optional().describe('End speed for a graduated range'),
  speedUnit:  z.enum(['Hz', 'rpm', 'percent']).optional().default('Hz').describe('Unit for speed values'),
};

const DurationFields = {
  duration:      z.number().optional().describe('Fixed duration'),
  durationStart: z.number().optional().describe('Start duration for a graduated range'),
  durationEnd:   z.number().optional().describe('End duration for a graduated range'),
  durationUnit:  z.enum(['s', 'ms']).optional().default('s').describe('Unit for duration values'),
};

const ColorTempFields = {
  colorTemperature:      z.number().optional().describe('Colour temperature'),
  colorTemperatureStart: z.number().optional().describe('Start colour temperature for a graduated range'),
  colorTemperatureEnd:   z.number().optional().describe('End colour temperature for a graduated range'),
  colorTemperatureUnit:  z.literal('K').optional().default('K').describe('Unit for color temperature'),
};

const OpenPercentFields = {
  openPercent:      z.number().optional().describe('Opening percentage (iris, frost…)'),
  openPercentStart: z.number().optional().describe('Start opening percentage'),
  openPercentEnd:   z.number().optional().describe('End opening percentage'),
  openPercentUnit:  z.literal('%').optional().default('%').describe('Unit for open percentage'),
};

const ShutterEffectFields = {
  shutterEffect: z.enum(['Open','Closed','Strobe','Pulse','RampUp','RampDown','RampUpDown','Lightning','Spikes'])
                   .optional().describe('OFL shutter effect type'),
};

const WheelSlotRefFields = {
  wheelSlotId: z.string().optional().describe('References WheelSlotDraft.slotId — the wheel slot active in this range'),
};

const WheelShakeFields = {
  isShaking:      z.enum(['slot', 'wheel']).optional().describe('Whether the slot or the whole wheel shakes'),
  shakeSpeed:     z.number().optional().describe('Shake oscillation speed'),
  shakeSpeedUnit: z.enum(['Hz', 'rpm', 'percent']).optional().default('Hz').describe('Unit for shake speed'),
  shakeAngle:     z.number().optional().describe('Max shake deflection angle'),
  shakeAngleUnit: z.enum(['deg', 'percent']).optional().default('deg').describe('Unit for shake angle'),
};

const ParameterFields = {
  parameter:      z.number().optional().describe('Generic parameter value'),
  parameterStart: z.number().optional().describe('Start value for a graduated range'),
  parameterEnd:   z.number().optional().describe('End value for a graduated range'),
  parameterUnit:  z.literal('%').optional().default('%').describe('Unit for parameter values'),
};

const SoundFields = {
  soundSensitivity:      z.number().optional().describe('Sound sensitivity level'),
  soundSensitivityStart: z.number().optional(),
  soundSensitivityEnd:   z.number().optional(),
  soundSensitivityUnit:  z.literal('%').optional().default('%').describe('Unit for sound sensitivity'),
};

const FogOutputFields = {
  fogOutput:      z.number().optional().describe('Fog output'),
  fogOutputStart: z.number().optional(),
  fogOutputEnd:   z.number().optional(),
  fogOutputUnit:  z.enum(['m³/min', 'percent']).optional().default('m³/min').describe('Unit for fog output'),
};

const HVAngleFields = {
  horizontalAngle:      z.number().optional().describe('Horizontal pan angle'),
  horizontalAngleStart: z.number().optional(),
  horizontalAngleEnd:   z.number().optional(),
  horizontalAngleUnit:  z.enum(['deg', 'percent']).optional().default('deg').describe('Unit for horizontal angle'),
  verticalAngle:        z.number().optional().describe('Vertical tilt angle'),
  verticalAngleStart:   z.number().optional(),
  verticalAngleEnd:     z.number().optional(),
  verticalAngleUnit:    z.enum(['deg', 'percent']).optional().default('deg').describe('Unit for vertical angle'),
};

const BladeFields = {
  blade:          z.enum(['Top','Right','Bottom','Left','Thrust','Swivel']).optional().describe('Which blade is controlled'),
  insertionStart: z.number().optional().describe('Blade insertion at start of range'),
  insertionEnd:   z.number().optional().describe('Blade insertion at end of range'),
  insertionUnit:  z.literal('%').optional().default('%').describe('Unit for blade insertion'),
};

// ─── Per-type capability schemas (exported individually for LLM use) ──────────

// Intensity
export const DimmerCapabilitySchema             = z.object({ ...RangeBase, type: z.literal('DIMMER'),             ...BrightnessFields });

// Color
export const RedCapabilitySchema                = z.object({ ...RangeBase, type: z.literal('RED'),               ...BrightnessFields });
export const GreenCapabilitySchema              = z.object({ ...RangeBase, type: z.literal('GREEN'),             ...BrightnessFields });
export const BlueCapabilitySchema               = z.object({ ...RangeBase, type: z.literal('BLUE'),              ...BrightnessFields });
export const WhiteCapabilitySchema              = z.object({ ...RangeBase, type: z.literal('WHITE'),             ...BrightnessFields });
export const WarmWhiteCapabilitySchema          = z.object({ ...RangeBase, type: z.literal('WARM_WHITE'),        ...BrightnessFields });
export const CoolWhiteCapabilitySchema          = z.object({ ...RangeBase, type: z.literal('COOL_WHITE'),        ...BrightnessFields });
export const AmberCapabilitySchema              = z.object({ ...RangeBase, type: z.literal('AMBER'),             ...BrightnessFields });
export const UvCapabilitySchema                 = z.object({ ...RangeBase, type: z.literal('UV'),                ...BrightnessFields });
export const CyanCapabilitySchema               = z.object({ ...RangeBase, type: z.literal('CYAN'),              ...BrightnessFields });
export const MagentaCapabilitySchema            = z.object({ ...RangeBase, type: z.literal('MAGENTA'),           ...BrightnessFields });
export const YellowCapabilitySchema             = z.object({ ...RangeBase, type: z.literal('YELLOW'),            ...BrightnessFields });
export const LimeCapabilitySchema               = z.object({ ...RangeBase, type: z.literal('LIME'),              ...BrightnessFields });
export const IndigoCapabilitySchema             = z.object({ ...RangeBase, type: z.literal('INDIGO'),            ...BrightnessFields });

// Color control
export const ColorWheelCapabilitySchema         = z.object({ ...RangeBase, type: z.literal('COLOR_WHEEL'),         ...WheelSlotRefFields, ...SpeedFields, ...WheelShakeFields });
export const ColorPresetCapabilitySchema        = z.object({ ...RangeBase, type: z.literal('COLOR_PRESET'),        ...ParameterFields });
export const ColorTemperatureCapabilitySchema   = z.object({ ...RangeBase, type: z.literal('COLOR_TEMPERATURE'),   ...ColorTempFields });

// Beam / intensity
export const StrobeCapabilitySchema             = z.object({ ...RangeBase, type: z.literal('STROBE'),             ...ShutterEffectFields, ...SpeedFields, ...DurationFields, ...BrightnessFields });
export const StrobeSpeedCapabilitySchema        = z.object({ ...RangeBase, type: z.literal('STROBE_SPEED'),       ...SpeedFields });
export const StrobeDurationCapabilitySchema     = z.object({ ...RangeBase, type: z.literal('STROBE_DURATION'),    ...DurationFields });
export const ZoomCapabilitySchema               = z.object({ ...RangeBase, type: z.literal('ZOOM'),               ...AngleFields });
export const FocusCapabilitySchema              = z.object({ ...RangeBase, type: z.literal('FOCUS'),              ...AngleFields });
export const IrisCapabilitySchema               = z.object({ ...RangeBase, type: z.literal('IRIS'),               ...OpenPercentFields });
export const IrisEffectCapabilitySchema         = z.object({ ...RangeBase, type: z.literal('IRIS_EFFECT'),        ...SpeedFields });
export const FrostCapabilitySchema              = z.object({ ...RangeBase, type: z.literal('FROST'),              ...OpenPercentFields });
export const FrostEffectCapabilitySchema        = z.object({ ...RangeBase, type: z.literal('FROST_EFFECT'),       ...SpeedFields });
export const BeamAngleCapabilitySchema          = z.object({ ...RangeBase, type: z.literal('BEAM_ANGLE'),         ...AngleFields });
export const BeamPositionCapabilitySchema       = z.object({ ...RangeBase, type: z.literal('BEAM_POSITION'),      ...HVAngleFields });

// Position
export const PanCapabilitySchema                = z.object({ ...RangeBase, type: z.literal('PAN'),                ...AngleFields });
export const TiltCapabilitySchema               = z.object({ ...RangeBase, type: z.literal('TILT'),               ...AngleFields });
export const PanContinuousCapabilitySchema      = z.object({ ...RangeBase, type: z.literal('PAN_CONTINUOUS'),     ...SpeedFields });
export const TiltContinuousCapabilitySchema     = z.object({ ...RangeBase, type: z.literal('TILT_CONTINUOUS'),    ...SpeedFields });
export const PanTiltSpeedCapabilitySchema       = z.object({ ...RangeBase, type: z.literal('PANTILT_SPEED'),      ...SpeedFields });

// Gobo / wheel
export const GoboWheelCapabilitySchema          = z.object({ ...RangeBase, type: z.literal('GOBO_WHEEL'),         ...WheelSlotRefFields, ...SpeedFields, ...WheelShakeFields });
export const GoboSpinCapabilitySchema           = z.object({ ...RangeBase, type: z.literal('GOBO_SPIN'),          ...SpeedFields });
export const PrismCapabilitySchema              = z.object({ ...RangeBase, type: z.literal('PRISM'),              ...WheelSlotRefFields, ...SpeedFields, ...WheelShakeFields });
export const PrismRotationCapabilitySchema      = z.object({ ...RangeBase, type: z.literal('PRISM_ROTATION'),     ...SpeedFields });
export const BladeCapabilitySchema              = z.object({ ...RangeBase, type: z.literal('BLADE'),              ...BladeFields });
export const BladeRotationCapabilitySchema      = z.object({ ...RangeBase, type: z.literal('BLADE_ROTATION'),      ...AngleFields, ...SpeedFields });
export const BladeSystemRotationCapabilitySchema = z.object({ ...RangeBase, type: z.literal('BLADE_SYSTEM_ROTATION'), ...AngleFields, ...SpeedFields });

// Effects
export const EffectCapabilitySchema             = z.object({ ...RangeBase, type: z.literal('EFFECT'),             ...ParameterFields, ...SpeedFields });
export const EffectSpeedCapabilitySchema        = z.object({ ...RangeBase, type: z.literal('EFFECT_SPEED'),       ...SpeedFields });
export const EffectDurationCapabilitySchema     = z.object({ ...RangeBase, type: z.literal('EFFECT_DURATION'),    ...DurationFields });
export const EffectParameterCapabilitySchema    = z.object({ ...RangeBase, type: z.literal('EFFECT_PARAMETER'),   ...ParameterFields });
export const SoundSensitivityCapabilitySchema   = z.object({ ...RangeBase, type: z.literal('SOUND_SENSITIVITY'),  ...SoundFields });
export const RotationCapabilitySchema           = z.object({ ...RangeBase, type: z.literal('ROTATION'),           ...SpeedFields });
export const SpeedCapabilitySchema              = z.object({ ...RangeBase, type: z.literal('SPEED'),              ...SpeedFields });
export const TimeCapabilitySchema               = z.object({ ...RangeBase, type: z.literal('TIME'),               ...DurationFields });

// Other
export const FogCapabilitySchema                = z.object({ ...RangeBase, type: z.literal('FOG'),                ...FogOutputFields });
export const FogOutputCapabilitySchema          = z.object({ ...RangeBase, type: z.literal('FOG_OUTPUT'),         ...FogOutputFields });
export const FogTypeCapabilitySchema            = z.object({ ...RangeBase, type: z.literal('FOG_TYPE'),           comment: z.string().optional().describe('Fog type name, e.g. "Haze", "Fog"') });
export const MaintenanceCapabilitySchema        = z.object({ ...RangeBase, type: z.literal('MAINTENANCE'),        parameter: z.number().min(0).max(1).optional() });
export const NoFunctionCapabilitySchema         = z.object({ ...RangeBase, type: z.literal('NO_FUNCTION') });
export const GenericCapabilitySchema            = z.object({ ...RangeBase, type: z.literal('GENERIC'),            ...ParameterFields });
export const CustomCapabilitySchema             = z.object({ ...RangeBase, type: z.literal('CUSTOM'),             ...ParameterFields });

// ─── Discriminated union ──────────────────────────────────────────────────────

/**
 * Discriminated union of all 45 capability-range schemas, keyed on `type`.
 * Use the individual named exports (e.g. `StrobeCapabilitySchema`) when
 * prompting an LLM to extract structured data from a fixture manual.
 */
export const CapabilityRangeSchema = z.discriminatedUnion('type', [
  DimmerCapabilitySchema,
  RedCapabilitySchema,
  GreenCapabilitySchema,
  BlueCapabilitySchema,
  WhiteCapabilitySchema,
  WarmWhiteCapabilitySchema,
  CoolWhiteCapabilitySchema,
  AmberCapabilitySchema,
  UvCapabilitySchema,
  CyanCapabilitySchema,
  MagentaCapabilitySchema,
  YellowCapabilitySchema,
  LimeCapabilitySchema,
  IndigoCapabilitySchema,
  ColorWheelCapabilitySchema,
  ColorPresetCapabilitySchema,
  ColorTemperatureCapabilitySchema,
  StrobeCapabilitySchema,
  StrobeSpeedCapabilitySchema,
  StrobeDurationCapabilitySchema,
  ZoomCapabilitySchema,
  FocusCapabilitySchema,
  IrisCapabilitySchema,
  IrisEffectCapabilitySchema,
  FrostCapabilitySchema,
  FrostEffectCapabilitySchema,
  BeamAngleCapabilitySchema,
  BeamPositionCapabilitySchema,
  PanCapabilitySchema,
  TiltCapabilitySchema,
  PanContinuousCapabilitySchema,
  TiltContinuousCapabilitySchema,
  PanTiltSpeedCapabilitySchema,
  GoboWheelCapabilitySchema,
  GoboSpinCapabilitySchema,
  PrismCapabilitySchema,
  PrismRotationCapabilitySchema,
  BladeCapabilitySchema,
  BladeRotationCapabilitySchema,
  BladeSystemRotationCapabilitySchema,
  EffectCapabilitySchema,
  EffectSpeedCapabilitySchema,
  EffectDurationCapabilitySchema,
  EffectParameterCapabilitySchema,
  SoundSensitivityCapabilitySchema,
  RotationCapabilitySchema,
  SpeedCapabilitySchema,
  TimeCapabilitySchema,
  FogCapabilitySchema,
  FogOutputCapabilitySchema,
  FogTypeCapabilitySchema,
  MaintenanceCapabilitySchema,
  NoFunctionCapabilitySchema,
  GenericCapabilitySchema,
  CustomCapabilitySchema,
]);
export type CapabilityRange = z.infer<typeof CapabilityRangeSchema>;

// ─── Schema map: ChannelType → its Zod schema ────────────────────────────────

/** Maps each ChannelType to the Zod schema for that capability range. */
export const CAPABILITY_SCHEMA_MAP: Record<ChannelType, z.ZodObject<any>> = {
  DIMMER:            DimmerCapabilitySchema,
  RED:               RedCapabilitySchema,
  GREEN:             GreenCapabilitySchema,
  BLUE:              BlueCapabilitySchema,
  WHITE:             WhiteCapabilitySchema,
  WARM_WHITE:        WarmWhiteCapabilitySchema,
  COOL_WHITE:        CoolWhiteCapabilitySchema,
  AMBER:             AmberCapabilitySchema,
  UV:                UvCapabilitySchema,
  CYAN:              CyanCapabilitySchema,
  MAGENTA:           MagentaCapabilitySchema,
  YELLOW:            YellowCapabilitySchema,
  LIME:              LimeCapabilitySchema,
  INDIGO:            IndigoCapabilitySchema,
  COLOR_WHEEL:       ColorWheelCapabilitySchema,
  COLOR_PRESET:      ColorPresetCapabilitySchema,
  COLOR_TEMPERATURE: ColorTemperatureCapabilitySchema,
  STROBE:            StrobeCapabilitySchema,
  STROBE_SPEED:      StrobeSpeedCapabilitySchema,
  STROBE_DURATION:   StrobeDurationCapabilitySchema,
  ZOOM:              ZoomCapabilitySchema,
  FOCUS:             FocusCapabilitySchema,
  IRIS:              IrisCapabilitySchema,
  IRIS_EFFECT:       IrisEffectCapabilitySchema,
  FROST:             FrostCapabilitySchema,
  FROST_EFFECT:      FrostEffectCapabilitySchema,
  BEAM_ANGLE:        BeamAngleCapabilitySchema,
  BEAM_POSITION:     BeamPositionCapabilitySchema,
  PAN:               PanCapabilitySchema,
  TILT:              TiltCapabilitySchema,
  PAN_CONTINUOUS:    PanContinuousCapabilitySchema,
  TILT_CONTINUOUS:   TiltContinuousCapabilitySchema,
  PANTILT_SPEED:     PanTiltSpeedCapabilitySchema,
  GOBO_WHEEL:        GoboWheelCapabilitySchema,
  GOBO_SPIN:         GoboSpinCapabilitySchema,
  PRISM:             PrismCapabilitySchema,
  PRISM_ROTATION:    PrismRotationCapabilitySchema,
  BLADE:             BladeCapabilitySchema,
  BLADE_ROTATION:         BladeRotationCapabilitySchema,
  BLADE_SYSTEM_ROTATION:  BladeSystemRotationCapabilitySchema,
  EFFECT:            EffectCapabilitySchema,
  EFFECT_SPEED:      EffectSpeedCapabilitySchema,
  EFFECT_DURATION:   EffectDurationCapabilitySchema,
  EFFECT_PARAMETER:  EffectParameterCapabilitySchema,
  SOUND_SENSITIVITY: SoundSensitivityCapabilitySchema,
  ROTATION:          RotationCapabilitySchema,
  SPEED:             SpeedCapabilitySchema,
  TIME:              TimeCapabilitySchema,
  FOG:               FogCapabilitySchema,
  FOG_OUTPUT:        FogOutputCapabilitySchema,
  FOG_TYPE:          FogTypeCapabilitySchema,
  MAINTENANCE:       MaintenanceCapabilitySchema,
  NO_FUNCTION:       NoFunctionCapabilitySchema,
  GENERIC:           GenericCapabilitySchema,
  CUSTOM:            CustomCapabilitySchema,
};

// ─── Schema-driven field spec derivation ─────────────────────────────────────

export type UnitOption = {
  value: string;
  /** Short display label shown in the pill, e.g. '°', '%', 'lm'. */
  label: string;
  min: number;
  max: number;
  step: number;
  defaultFixed: number;
  defaultStart: number;
  defaultEnd: number;
};

/** Unit options per field root (camelCase key without Start/End suffix). */
export const UNIT_OPTION_MAP: Record<string, UnitOption[]> = {
  brightness: [
    { value: 'percent', label: '%',      min: 0,    max: 100,   step: 1,    defaultFixed: 100,  defaultStart: 0,    defaultEnd: 100  },
    { value: 'lm',      label: 'lm',     min: 0,    max: 50000, step: 100,  defaultFixed: 1000, defaultStart: 0,    defaultEnd: 1000 },
  ],
  angle: [
    { value: 'deg',     label: '°',      min: -360, max: 360,   step: 1,    defaultFixed: 0,    defaultStart: -90,  defaultEnd: 90   },
    { value: 'percent', label: '%',      min: -100, max: 100,   step: 1,    defaultFixed: 0,    defaultStart: -100, defaultEnd: 100  },
  ],
  speed: [
    { value: 'Hz',      label: 'Hz',     min: 0,    max: 100,   step: 0.01, defaultFixed: 1,    defaultStart: 0,    defaultEnd: 10   },
    { value: 'rpm',     label: 'rpm',    min: 0,    max: 9999,  step: 1,    defaultFixed: 60,   defaultStart: 0,    defaultEnd: 60   },
    { value: 'percent', label: '%',      min: -100, max: 100,   step: 1,    defaultFixed: 100,  defaultStart: -100, defaultEnd: 100  },
  ],
  shakeSpeed: [
    { value: 'Hz',      label: 'Hz',     min: 0,    max: 100,   step: 0.01, defaultFixed: 1,    defaultStart: 0,    defaultEnd: 10   },
    { value: 'rpm',     label: 'rpm',    min: 0,    max: 9999,  step: 1,    defaultFixed: 60,   defaultStart: 0,    defaultEnd: 60   },
    { value: 'percent', label: '%',      min: -100, max: 100,   step: 1,    defaultFixed: 100,  defaultStart: -100, defaultEnd: 100  },
  ],
  shakeAngle: [
    { value: 'deg',     label: '°',      min: 0,    max: 360,   step: 1,    defaultFixed: 10,   defaultStart: 0,    defaultEnd: 30   },
    { value: 'percent', label: '%',      min: 0,    max: 100,   step: 1,    defaultFixed: 10,   defaultStart: 0,    defaultEnd: 100  },
  ],
  duration: [
    { value: 's',       label: 's',      min: 0,    max: 60,    step: 0.1,  defaultFixed: 1,    defaultStart: 0,    defaultEnd: 1    },
    { value: 'ms',      label: 'ms',     min: 0,    max: 60000, step: 100,  defaultFixed: 1000, defaultStart: 0,    defaultEnd: 1000 },
  ],
  colorTemperature: [
    { value: 'K',       label: 'K',      min: 1000, max: 20000, step: 100,  defaultFixed: 6500, defaultStart: 2700, defaultEnd: 6500 },
  ],
  openPercent: [
    { value: 'percent', label: '%',      min: 0,    max: 100,   step: 1,    defaultFixed: 100,  defaultStart: 0,    defaultEnd: 100  },
  ],
  horizontalAngle: [
    { value: 'deg',     label: '°',      min: -360, max: 360,   step: 1,    defaultFixed: 0,    defaultStart: -90,  defaultEnd: 90   },
    { value: 'percent', label: '%',      min: -100, max: 100,   step: 1,    defaultFixed: 0,    defaultStart: -100, defaultEnd: 100  },
  ],
  verticalAngle: [
    { value: 'deg',     label: '°',      min: -360, max: 360,   step: 1,    defaultFixed: 0,    defaultStart: -90,  defaultEnd: 90   },
    { value: 'percent', label: '%',      min: -100, max: 100,   step: 1,    defaultFixed: 0,    defaultStart: -100, defaultEnd: 100  },
  ],
  insertion: [
    { value: 'percent', label: '%',      min: 0,    max: 100,   step: 1,    defaultFixed: 50,   defaultStart: 0,    defaultEnd: 100  },
  ],
  fogOutput: [
    { value: 'm³/min',  label: 'm³/min', min: 0,    max: 100,   step: 0.1,  defaultFixed: 1,    defaultStart: 0,    defaultEnd: 10   },
    { value: 'percent', label: '%',      min: 0,    max: 100,   step: 1,    defaultFixed: 100,  defaultStart: 0,    defaultEnd: 100  },
  ],
  parameter: [
    { value: 'percent', label: '%',      min: 0,    max: 100,   step: 1,    defaultFixed: 100,  defaultStart: 0,    defaultEnd: 100  },
  ],
  soundSensitivity: [
    { value: 'percent', label: '%',      min: 0,    max: 100,   step: 1,    defaultFixed: 100,  defaultStart: 0,    defaultEnd: 100  },
  ],
};

export type CapabilityFieldSpec = {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'select';
  options?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  description?: string;
  defaultValue?: number | string;
  /** Short label for draggable input handle. */
  dragLabel?: string;
  /** Available units for this numeric field. When present, unit selector is shown in UI. */
  unitOptions?: UnitOption[];
  /** Key in the capability range data that stores the selected unit string. */
  unitKey?: string;
};

/** Base keys present on every capability range — excluded from extra fields. */
const BASE_KEYS = new Set(['rangeId', 'dmxMin', 'dmxMax', 'type', 'label']);

/** Convert camelCase key to a human-readable label, e.g. "brightnessStart" → "Brightness Start". */
function keyToLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

/** Unwrap optional/default wrappers using Zod v4 def.type tags. */
function unwrapDef(s: z.ZodTypeAny): z.ZodTypeAny {
  const type = (s as any).def?.type;
  if (type === 'optional' || type === 'default') return unwrapDef((s as any).def.innerType);
  return s;
}

/** Extract the .default() value from a Zod field if present (walks optional→default). */
function extractDefault(s: z.ZodTypeAny): number | string | undefined {
  const def = (s as any).def;
  if (!def) return undefined;
  if (def.type === 'optional') return extractDefault(def.innerType);
  if (def.type === 'default') return def.defaultValue as number | string | undefined;
  return undefined;
}

/**
 * Derive UI field specs from a capability Zod schema.
 * - `*Unit` companion fields are skipped and their unit options are attached to numeric fields
 * - Numeric fields with a matching `*Unit` companion get `unitKey` + `unitOptions`
 */
export function schemaToFieldSpecs(schema: z.ZodObject<any>): CapabilityFieldSpec[] {
  const shape = schema.shape as Record<string, z.ZodTypeAny>;

  // First pass: collect unit companion roots ('brightnessUnit' → root 'brightness')
  const unitCompanionRoots = new Set<string>();
  for (const key of Object.keys(shape)) {
    if (!BASE_KEYS.has(key) && key.endsWith('Unit')) {
      unitCompanionRoots.add(key.slice(0, -4));
    }
  }

  const specs: CapabilityFieldSpec[] = [];
  for (const [key, raw] of Object.entries(shape)) {
    if (BASE_KEYS.has(key)) continue;
    // Skip *Unit companions — they are unit metadata, not standalone inputs
    if (key.endsWith('Unit') && unitCompanionRoots.has(key.slice(0, -4))) continue;

    const inner = unwrapDef(raw as z.ZodTypeAny);
    const innerDef = (inner as any).def ?? {};
    const description: string | undefined = (raw as any).def?.description ?? innerDef.description;

    const fieldRoot = key.replace(/Start$|End$/, '');
    const hasUnit = unitCompanionRoots.has(fieldRoot);
    const unitKey = hasUnit ? fieldRoot + 'Unit' : undefined;
    const unitOptions = hasUnit ? UNIT_OPTION_MAP[fieldRoot] : undefined;

    if (innerDef.type === 'string') {
      specs.push({ key, label: keyToLabel(key), kind: 'text', description });
    } else if (innerDef.type === 'number') {
      const dragLabel = keyToLabel(key).toUpperCase();
      if (unitOptions) {
        specs.push({ key, label: keyToLabel(key), kind: 'number', description, dragLabel, unitKey, unitOptions });
      } else {
        let min: number | undefined, max: number | undefined;
        for (const check of innerDef.checks ?? []) {
          const cd = check._zod?.def;
          if (!cd) continue;
          if (cd.check === 'greater_than' || cd.check === 'greater_than_or_equal') min = cd.value;
          if (cd.check === 'less_than'    || cd.check === 'less_than_or_equal')    max = cd.value;
        }
        const step = (min !== undefined && max !== undefined && max <= 1) ? 0.01 : 1;
        const defaultValue = extractDefault(raw as z.ZodTypeAny);
        specs.push({ key, label: keyToLabel(key), kind: 'number', min, max, step, description, dragLabel, defaultValue });
      }
    } else if (innerDef.type === 'enum') {
      const options = Object.values(innerDef.entries ?? {}) as string[];
      specs.push({ key, label: keyToLabel(key), kind: 'select', options, description });
    }
  }
  return specs;
}

/**
 * Schema-derived field specs for each ChannelType.
 * Replaces the hand-crafted CAPABILITY_RANGE_FIELDS — derived fully from the Zod schemas.
 */
export const CAPABILITY_RANGE_FIELDS: Partial<Record<ChannelType, CapabilityFieldSpec[]>> =
  Object.fromEntries(
    (Object.entries(CAPABILITY_SCHEMA_MAP) as [ChannelType, z.ZodObject<any>][])
      .map(([type, schema]) => [type, schemaToFieldSpecs(schema)])
      .filter(([, specs]) => (specs as CapabilityFieldSpec[]).length > 0)
  ) as Partial<Record<ChannelType, CapabilityFieldSpec[]>>;
