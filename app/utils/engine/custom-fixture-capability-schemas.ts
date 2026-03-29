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
  brightness:      z.number().min(0).max(1).optional().describe('Fixed brightness level — normalised 0–1 (0 = off, 1 = full). Leave empty if the brightness varies across this range.'),
  brightnessStart: z.number().min(0).max(1).default(0).optional().describe('Start brightness for a graduated range (0 = off, 1 = full). Use together with Brightness End.'),
  brightnessEnd:   z.number().min(0).max(1).default(1).optional().describe('End brightness for a graduated range (0 = off, 1 = full). Use together with Brightness Start.'),
};

const AngleFields = {
  angle:      z.number().optional().describe('Fixed beam / rotation angle in degrees'),
  angleStart: z.number().optional().describe('Start of an angle range in degrees'),
  angleEnd:   z.number().optional().describe('End of an angle range in degrees'),
};

const SpeedFields = {
  speed:      z.string().optional().describe('Fixed speed, e.g. "fast", "1Hz", "slow to fast"'),
  speedStart: z.string().optional().describe('Start speed for a graduated range'),
  speedEnd:   z.string().optional().describe('End speed for a graduated range'),
};

const DurationFields = {
  duration:      z.string().optional().describe('Fixed duration, e.g. "0.5s", "2s"'),
  durationStart: z.string().optional().describe('Start duration for a graduated range'),
  durationEnd:   z.string().optional().describe('End duration for a graduated range'),
};

const ColorTempFields = {
  colorTemperature:      z.number().optional().describe('Colour temperature in Kelvin'),
  colorTemperatureStart: z.number().optional().describe('Start colour temperature for a graduated range'),
  colorTemperatureEnd:   z.number().optional().describe('End colour temperature for a graduated range'),
};

const OpenPercentFields = {
  openPercent:      z.number().min(0).max(100).optional().describe('Opening percentage (iris, frost…) 0–100'),
  openPercentStart: z.number().min(0).max(100).optional().describe('Start opening percentage'),
  openPercentEnd:   z.number().min(0).max(100).optional().describe('End opening percentage'),
};

const ShutterEffectFields = {
  shutterEffect: z.enum(['Open','Closed','Strobe','Pulse','RampUp','RampDown','RampUpDown','Lightning','Spikes'])
                   .optional().describe('OFL shutter effect type'),
};

const WheelSlotRefFields = {
  wheelSlotId: z.string().optional().describe('References WheelSlotDraft.slotId — the wheel slot active in this range'),
};

const WheelShakeFields = {
  isShaking:  z.enum(['slot', 'wheel']).optional().describe('Whether the slot or the whole wheel shakes'),
  shakeSpeed: z.string().optional().describe('Shake oscillation speed, e.g. "1Hz"'),
  shakeAngle: z.number().optional().describe('Max shake deflection angle in degrees'),
};

const ParameterFields = {
  parameter:      z.number().min(0).max(1).optional().describe('Generic 0–1 parameter'),
  parameterStart: z.number().min(0).max(1).optional(),
  parameterEnd:   z.number().min(0).max(1).optional(),
};

const SoundFields = {
  soundSensitivity:      z.number().min(0).max(1).optional().describe('Sound sensitivity level 0–1'),
  soundSensitivityStart: z.number().min(0).max(1).optional(),
  soundSensitivityEnd:   z.number().min(0).max(1).optional(),
};

const FogOutputFields = {
  fogOutput:      z.number().min(0).optional().describe('Fog output in m³/min'),
  fogOutputStart: z.number().min(0).optional(),
  fogOutputEnd:   z.number().min(0).optional(),
};

const HVAngleFields = {
  horizontalAngle: z.number().optional().describe('Horizontal pan angle in degrees'),
  verticalAngle:   z.number().optional().describe('Vertical tilt angle in degrees'),
};

const BladeFields = {
  blade:          z.enum(['Top','Right','Bottom','Left','Thrust','Swivel']).optional().describe('Which blade is controlled'),
  insertionStart: z.number().min(0).max(100).optional().describe('Blade insertion at start of range (%)'),
  insertionEnd:   z.number().min(0).max(100).optional().describe('Blade insertion at end of range (%)'),
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
export const FrostCapabilitySchema              = z.object({ ...RangeBase, type: z.literal('FROST'),              ...OpenPercentFields });
export const BeamAngleCapabilitySchema          = z.object({ ...RangeBase, type: z.literal('BEAM_ANGLE'),         ...AngleFields });
export const BeamPositionCapabilitySchema       = z.object({ ...RangeBase, type: z.literal('BEAM_POSITION'),      ...HVAngleFields });

// Position
export const PanCapabilitySchema                = z.object({ ...RangeBase, type: z.literal('PAN'),                ...AngleFields });
export const TiltCapabilitySchema               = z.object({ ...RangeBase, type: z.literal('TILT'),               ...AngleFields });
export const PanTiltSpeedCapabilitySchema       = z.object({ ...RangeBase, type: z.literal('PANTILT_SPEED'),      ...SpeedFields });

// Gobo / wheel
export const GoboWheelCapabilitySchema          = z.object({ ...RangeBase, type: z.literal('GOBO_WHEEL'),         ...WheelSlotRefFields, ...SpeedFields, ...WheelShakeFields });
export const GoboSpinCapabilitySchema           = z.object({ ...RangeBase, type: z.literal('GOBO_SPIN'),          ...SpeedFields });
export const PrismCapabilitySchema              = z.object({ ...RangeBase, type: z.literal('PRISM'),              ...WheelSlotRefFields, ...SpeedFields, ...WheelShakeFields });
export const PrismRotationCapabilitySchema      = z.object({ ...RangeBase, type: z.literal('PRISM_ROTATION'),     ...SpeedFields });
export const BladeCapabilitySchema              = z.object({ ...RangeBase, type: z.literal('BLADE'),              ...BladeFields });

// Effects
export const EffectCapabilitySchema             = z.object({ ...RangeBase, type: z.literal('EFFECT'),             ...ParameterFields, ...SpeedFields });
export const EffectSpeedCapabilitySchema        = z.object({ ...RangeBase, type: z.literal('EFFECT_SPEED'),       ...SpeedFields });
export const EffectDurationCapabilitySchema     = z.object({ ...RangeBase, type: z.literal('EFFECT_DURATION'),    ...DurationFields });
export const SoundSensitivityCapabilitySchema   = z.object({ ...RangeBase, type: z.literal('SOUND_SENSITIVITY'),  ...SoundFields });
export const RotationCapabilitySchema           = z.object({ ...RangeBase, type: z.literal('ROTATION'),           ...SpeedFields });
export const SpeedCapabilitySchema              = z.object({ ...RangeBase, type: z.literal('SPEED'),              ...SpeedFields });
export const TimeCapabilitySchema               = z.object({ ...RangeBase, type: z.literal('TIME'),               ...DurationFields });

// Other
export const FogCapabilitySchema                = z.object({ ...RangeBase, type: z.literal('FOG'),                ...FogOutputFields });
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
  FrostCapabilitySchema,
  BeamAngleCapabilitySchema,
  BeamPositionCapabilitySchema,
  PanCapabilitySchema,
  TiltCapabilitySchema,
  PanTiltSpeedCapabilitySchema,
  GoboWheelCapabilitySchema,
  GoboSpinCapabilitySchema,
  PrismCapabilitySchema,
  PrismRotationCapabilitySchema,
  BladeCapabilitySchema,
  EffectCapabilitySchema,
  EffectSpeedCapabilitySchema,
  EffectDurationCapabilitySchema,
  SoundSensitivityCapabilitySchema,
  RotationCapabilitySchema,
  SpeedCapabilitySchema,
  TimeCapabilitySchema,
  FogCapabilitySchema,
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
  FROST:             FrostCapabilitySchema,
  BEAM_ANGLE:        BeamAngleCapabilitySchema,
  BEAM_POSITION:     BeamPositionCapabilitySchema,
  PAN:               PanCapabilitySchema,
  TILT:              TiltCapabilitySchema,
  PANTILT_SPEED:     PanTiltSpeedCapabilitySchema,
  GOBO_WHEEL:        GoboWheelCapabilitySchema,
  GOBO_SPIN:         GoboSpinCapabilitySchema,
  PRISM:             PrismCapabilitySchema,
  PRISM_ROTATION:    PrismRotationCapabilitySchema,
  BLADE:             BladeCapabilitySchema,
  EFFECT:            EffectCapabilitySchema,
  EFFECT_SPEED:      EffectSpeedCapabilitySchema,
  EFFECT_DURATION:   EffectDurationCapabilitySchema,
  SOUND_SENSITIVITY: SoundSensitivityCapabilitySchema,
  ROTATION:          RotationCapabilitySchema,
  SPEED:             SpeedCapabilitySchema,
  TIME:              TimeCapabilitySchema,
  FOG:               FogCapabilitySchema,
  MAINTENANCE:       MaintenanceCapabilitySchema,
  NO_FUNCTION:       NoFunctionCapabilitySchema,
  GENERIC:           GenericCapabilitySchema,
  CUSTOM:            CustomCapabilitySchema,
};

// ─── Schema-driven field spec derivation ─────────────────────────────────────

export type CapabilityFieldSpec = {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'select';
  options?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  description?: string;
  /** Default value extracted from Zod .default() — used as placeholder hint in UI. */
  defaultValue?: number | string;
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
 * Skips base fields; maps string→text, number→number, enum→select.
 */
export function schemaToFieldSpecs(schema: z.ZodObject<any>): CapabilityFieldSpec[] {
  const specs: CapabilityFieldSpec[] = [];
  for (const [key, raw] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
    if (BASE_KEYS.has(key)) continue;
    const inner = unwrapDef(raw as z.ZodTypeAny);
    const innerDef = (inner as any).def ?? {};
    const description: string | undefined = (raw as any).def?.description ?? innerDef.description;

    if (innerDef.type === 'string') {
      specs.push({ key, label: keyToLabel(key), kind: 'text', description });
    } else if (innerDef.type === 'number') {
      let min: number | undefined, max: number | undefined;
      for (const check of innerDef.checks ?? []) {
        const cd = check._zod?.def;
        if (!cd) continue;
        if (cd.check === 'greater_than' || cd.check === 'greater_than_or_equal') min = cd.value;
        if (cd.check === 'less_than'    || cd.check === 'less_than_or_equal')    max = cd.value;
      }
      const step = (min !== undefined && max !== undefined && max <= 1) ? 0.01 : 1;
      const defaultValue = extractDefault(raw as z.ZodTypeAny);
      specs.push({ key, label: keyToLabel(key), kind: 'number', min, max, step, description, defaultValue });
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
