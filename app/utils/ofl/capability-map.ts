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
  Cyan: { channelType: 'CUSTOM', colorValue: '#00FFFF' },
  Magenta: { channelType: 'CUSTOM', colorValue: '#FF00FF' },
  Yellow: { channelType: 'CUSTOM', colorValue: '#FFFF00' },
  Lime: { channelType: 'CUSTOM', colorValue: '#BFFF00' },
  Indigo: { channelType: 'CUSTOM', colorValue: '#4B0082' },
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
  defaultValue: number = 0
): MappedChannel {
  if (!capability) {
    return { type: 'CUSTOM', role: 'NONE', colorValue: '#888888', defaultValue };
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

    case 'Pan':
    case 'PanContinuous':
      return { type: 'PAN', role: 'NONE', colorValue: '#888888', defaultValue };

    case 'Tilt':
    case 'TiltContinuous':
      return { type: 'TILT', role: 'NONE', colorValue: '#888888', defaultValue };

    case 'ShutterStrobe':
      return { type: 'STROBE', role: 'NONE', colorValue: '#888888', defaultValue };

    default:
      return { type: 'CUSTOM', role: 'NONE', colorValue: '#888888', defaultValue };
  }
}

/**
 * Resolves a complete OFL channel definition (with either single capability or capability array)
 * into an internal mapped channel descriptor.
 */
export function resolveOflChannel(channelDef: import('./types').OflChannel): MappedChannel {
  const primaryCap = getPrimaryCapability(channelDef.capability, channelDef.capabilities);
  const defaultValue = channelDef.defaultValue ?? 0;
  return mapOflCapabilityToChannel(primaryCap, defaultValue);
}
