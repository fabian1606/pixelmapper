import type { ChannelType } from '../engine/types';
import type { ChannelRole } from '../engine/core/channel';
import type { OflCapability, OflColor } from './types';

// ─── Color Mapping ────────────────────────────────────────────────────────────

interface ColorMapping {
  channelType: ChannelType;
  colorValue: string;
}

const OFL_COLOR_MAP: Record<OflColor, ColorMapping> = {
  Red: { channelType: 'RED', colorValue: '#FF0000' },
  Green: { channelType: 'GREEN', colorValue: '#00FF00' },
  Blue: { channelType: 'BLUE', colorValue: '#0000FF' },
  White: { channelType: 'WHITE', colorValue: '#FFFFFF' },
  'Warm White': { channelType: 'WARM_WHITE', colorValue: '#FFD080' },
  'Cold White': { channelType: 'COOL_WHITE', colorValue: '#C0DFFF' },
  Amber: { channelType: 'AMBER', colorValue: '#FFAA00' },
  UV: { channelType: 'UV', colorValue: '#8800FF' },
  Cyan: { channelType: 'CYAN', colorValue: '#00FFFF' },
  Magenta: { channelType: 'MAGENTA', colorValue: '#FF00FF' },
  Yellow: { channelType: 'YELLOW', colorValue: '#FFFF00' },
  Lime: { channelType: 'LIME', colorValue: '#BFFF00' },
  Indigo: { channelType: 'INDIGO', colorValue: '#4B0082' },
};

// ─── Mapped Channel Result ────────────────────────────────────────────────────

export interface MappedChannel {
  type: ChannelType;
  role: ChannelRole;
  colorValue: string;
  defaultValue: number;
}

// ─── Capability → Channel Mapping ─────────────────────────────────────────────

/**
 * Extracts the primary capability from an OFL channel definition.
 * A channel can have either `capability` (single) or `capabilities` (multiple ranges).
 * We use the first capability for type detection.
 */
function getPrimaryCapability(capabilities?: OflCapability, capabilitiesArr?: OflCapability[]): OflCapability | undefined {
  if (capabilities) return capabilities;
  if (capabilitiesArr && capabilitiesArr.length > 0) return capabilitiesArr[0];
  return undefined;
}

/**
 * Maps an OFL channel's capability to the internal channel representation.
 *
 * @param capability - The primary OFL capability of the channel
 * @param defaultValue - The OFL channel's defaultValue (8-bit)
 */
export function mapOflCapabilityToChannel(
  capability: OflCapability | undefined,
  defaultValue: number = 0,
  channelName: string = ''
): MappedChannel {
  if (!capability) {
    return heuristicFallbackMap(channelName, defaultValue);
  }

  switch (capability.type) {
    case 'Intensity':
      return { type: 'DIMMER', role: 'DIMMER', colorValue: '#FFFFFF', defaultValue: defaultValue ?? 255 };

    case 'ColorIntensity': {
      const color = capability.color;
      if (color && color in OFL_COLOR_MAP) {
        const { channelType, colorValue } = OFL_COLOR_MAP[color as OflColor];
        return { type: channelType, role: 'COLOR', colorValue, defaultValue };
      }
      return { type: 'CUSTOM', role: 'COLOR', colorValue: '#FFFFFF', defaultValue };
    }

    case 'ColorPreset':
      return { type: 'COLOR_PRESET', role: 'COLOR', colorValue: '#FFFFFF', defaultValue };
    case 'ColorTemperature':
      return { type: 'COLOR_TEMPERATURE', role: 'COLOR', colorValue: '#FFFFFF', defaultValue };

    case 'Pan':
    case 'PanContinuous':
      return { type: 'PAN', role: 'NONE', colorValue: '#888888', defaultValue };

    case 'Tilt':
    case 'TiltContinuous':
      return { type: 'TILT', role: 'NONE', colorValue: '#888888', defaultValue };

    case 'PanTiltSpeed':
      return { type: 'PANTILT_SPEED', role: 'NONE', colorValue: '#888888', defaultValue };

    case 'ShutterStrobe':
      return { type: 'STROBE', role: 'NONE', colorValue: '#888888', defaultValue };
    case 'StrobeSpeed':
      return { type: 'STROBE_SPEED', role: 'NONE', colorValue: '#888888', defaultValue };
    case 'StrobeDuration':
      return { type: 'STROBE_DURATION', role: 'NONE', colorValue: '#888888', defaultValue };

    case 'Zoom':
      return { type: 'ZOOM', role: 'NONE', colorValue: '#888888', defaultValue };
    case 'Focus':
      return { type: 'FOCUS', role: 'NONE', colorValue: '#888888', defaultValue };
    case 'Iris':
    case 'IrisEffect':
      return { type: 'IRIS', role: 'NONE', colorValue: '#888888', defaultValue };
    case 'Frost':
    case 'FrostEffect':
      return { type: 'FROST', role: 'NONE', colorValue: '#888888', defaultValue };
    case 'BeamAngle':
      return { type: 'BEAM_ANGLE', role: 'NONE', colorValue: '#888888', defaultValue };
    case 'BeamPosition':
      return { type: 'BEAM_POSITION', role: 'NONE', colorValue: '#888888', defaultValue };

    case 'Prism':
      return { type: 'PRISM', role: 'NONE', colorValue: '#888888', defaultValue };
    case 'PrismRotation':
      return { type: 'PRISM_ROTATION', role: 'NONE', colorValue: '#888888', defaultValue };
    case 'BladeInsertion':
    case 'BladeRotation':
    case 'BladeSystemRotation':
      return { type: 'BLADE', role: 'NONE', colorValue: '#888888', defaultValue };

    case 'WheelSlot':
    case 'WheelShake':
    case 'WheelRotation':
    case 'WheelSlotRotation': {
      // Prefer the explicit wheel name from the capability, otherwise fall back to channel name
      const wheelName = (capability.wheel ?? channelName).toLowerCase();
      if (wheelName.includes('color')) {
        return { type: 'COLOR_WHEEL', role: 'COLOR', colorValue: '#FFFFFF', defaultValue };
      }
      if (wheelName.includes('gobo') || wheelName.includes('pattern')) {
        if (capability.type === 'WheelRotation' || capability.type === 'WheelSlotRotation') {
          return { type: 'GOBO_SPIN', role: 'NONE', colorValue: '#888888', defaultValue };
        }
        return { type: 'GOBO_WHEEL', role: 'NONE', colorValue: '#888888', defaultValue };
      }
      // Unknown wheel type — use the channel name heuristic
      return heuristicFallbackMap(channelName, defaultValue);
    }

    case 'Effect':
    case 'EffectParameter':
      // Fallback heuristics: If OFL just calls it "Effect" but the channel name gives a better hint
      if (channelName.toLowerCase().includes('macro')) return { type: 'GENERIC', role: 'NONE', colorValue: '#888888', defaultValue };
      if (channelName.toLowerCase().includes('sparkle')) return { type: 'EFFECT', role: 'NONE', colorValue: '#888888', defaultValue };
      return { type: 'EFFECT', role: 'NONE', colorValue: '#888888', defaultValue };
    case 'EffectSpeed':
      return { type: 'EFFECT_SPEED', role: 'NONE', colorValue: '#888888', defaultValue };
    case 'EffectDuration':
      return { type: 'EFFECT_DURATION', role: 'NONE', colorValue: '#888888', defaultValue };
    case 'SoundSensitivity':
      return { type: 'SOUND_SENSITIVITY', role: 'NONE', colorValue: '#888888', defaultValue };

    case 'Rotation':
      return { type: 'ROTATION', role: 'NONE', colorValue: '#888888', defaultValue };
    case 'Speed':
      return { type: 'SPEED', role: 'NONE', colorValue: '#888888', defaultValue };
    case 'Time':
      return { type: 'TIME', role: 'NONE', colorValue: '#888888', defaultValue };

    case 'Fog':
    case 'FogOutput':
    case 'FogType':
      return { type: 'FOG', role: 'NONE', colorValue: '#888888', defaultValue };

    case 'Maintenance':
      return { type: 'MAINTENANCE', role: 'NONE', colorValue: '#888888', defaultValue };

    case 'Generic':
      return { type: 'GENERIC', role: 'NONE', colorValue: '#888888', defaultValue };

    case 'NoFunction':
      return heuristicFallbackMap(channelName, defaultValue);

    default:
      return heuristicFallbackMap(channelName, defaultValue);
  }
}

/**
 * Attempts to guess the channel type based purely on the string name
 * if the capability type is missing or generic (like NoFunction).
 */
function heuristicFallbackMap(channelName: string, defaultValue: number): MappedChannel {
  const name = channelName.toLowerCase();

  if (name.includes('shutter') || name.includes('strobe')) return { type: 'STROBE', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('dimmer') || name.includes('intensity')) return { type: 'DIMMER', role: 'DIMMER', colorValue: '#FFFFFF', defaultValue };
  if (name.includes('pan')) return { type: 'PAN', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('tilt')) return { type: 'TILT', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('zoom')) return { type: 'ZOOM', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('focus')) return { type: 'FOCUS', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('iris')) return { type: 'IRIS', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('frost')) return { type: 'FROST', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('prism')) return { type: 'PRISM', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('gobo')) return { type: 'GOBO_WHEEL', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('color')) return { type: 'COLOR_WHEEL', role: 'COLOR', colorValue: '#FFFFFF', defaultValue };
  if (name.includes('macro')) return { type: 'GENERIC', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('control') || name.includes('reset') || name.includes('blackout on move')) return { type: 'MAINTENANCE', role: 'NONE', colorValue: '#888888', defaultValue };

  return { type: 'CUSTOM', role: 'NONE', colorValue: '#888888', defaultValue };
}

/**
 * Resolves a complete OFL channel definition (with either single capability or capability array)
 * into an internal mapped channel descriptor.
 */
export function resolveOflChannel(channelDef: import('./types').OflChannel, channelName: string = ''): MappedChannel {
  const primaryCap = getPrimaryCapability(channelDef.capability, channelDef.capabilities);
  // OFL allows defaultValue to be a percentage string like '50%' or a plain number
  const rawDefault = channelDef.defaultValue;
  let defaultValue = 0;
  if (typeof rawDefault === 'number') {
    defaultValue = rawDefault;
  } else if (typeof rawDefault === 'string' && rawDefault.endsWith('%')) {
    defaultValue = Math.round((parseFloat(rawDefault) / 100) * 255);
  }
  return mapOflCapabilityToChannel(primaryCap, defaultValue, channelName);
}
