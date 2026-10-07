import type { ChannelType } from '../engine/types';
import type { ChannelRole, RenderRange } from '../engine/core/channel';
import type { OflCapability, OflColor, OflWheel, OflWheelSlot } from './types';

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
      // Dimmers always start fully off so cleared fixtures stay dark; the operator
      // raises intensity manually. Ignore the OFL default (often 100%).
      return { type: 'DIMMER', role: 'DIMMER', colorValue: '#FFFFFF', defaultValue: 0 };

    case 'ColorIntensity': {
      const color = capability.color;
      if (color && color in OFL_COLOR_MAP) {
        const { channelType, colorValue } = OFL_COLOR_MAP[color as OflColor];
        return { type: channelType, role: 'COLOR', colorValue, defaultValue };
      }
      return { type: 'CUSTOM', role: 'COLOR', colorValue: '#FFFFFF', defaultValue };
    }

    case 'ColorPreset':
      return { type: 'COLOR_PRESET', role: 'COLOR_WHEEL', colorValue: '#FFFFFF', defaultValue };
    case 'ColorTemperature':
      return { type: 'COLOR_TEMPERATURE', role: 'COLOR_WHEEL', colorValue: '#FFFFFF', defaultValue };

    case 'Pan':
    case 'PanContinuous':
      return { type: 'PAN', role: 'NONE', colorValue: '#888888', defaultValue };

    case 'Tilt':
    case 'TiltContinuous':
      return { type: 'TILT', role: 'NONE', colorValue: '#888888', defaultValue };

    case 'PanTiltSpeed':
      return { type: 'PANTILT_SPEED', role: 'NONE', colorValue: '#888888', defaultValue };

    case 'ShutterStrobe':
      return { type: 'STROBE', role: 'SHUTTER', colorValue: '#888888', defaultValue };
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
      const rawWheel = capability.wheel ?? channelName;
      const wheelName = (Array.isArray(rawWheel) ? rawWheel[0] : rawWheel)?.toLowerCase() ?? '';
      if (wheelName.includes('color')) {
        return { type: 'COLOR_WHEEL', role: 'COLOR_WHEEL', colorValue: '#FFFFFF', defaultValue };
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

  if (name.includes('shutter') || name.includes('strobe')) return { type: 'STROBE', role: 'SHUTTER', colorValue: '#888888', defaultValue };
  if (name.includes('dimmer') || name.includes('intensity')) return { type: 'DIMMER', role: 'DIMMER', colorValue: '#FFFFFF', defaultValue: 0 };
  if (name.includes('pan')) return { type: 'PAN', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('tilt')) return { type: 'TILT', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('zoom')) return { type: 'ZOOM', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('focus')) return { type: 'FOCUS', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('iris')) return { type: 'IRIS', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('frost')) return { type: 'FROST', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('prism')) return { type: 'PRISM', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('gobo')) return { type: 'GOBO_WHEEL', role: 'NONE', colorValue: '#888888', defaultValue };
  if (name.includes('color') && (name.includes('preset') || name.includes('macro'))) return { type: 'COLOR_PRESET', role: 'COLOR_WHEEL', colorValue: '#FFFFFF', defaultValue };
  if (name.includes('color')) return { type: 'COLOR_WHEEL', role: 'COLOR_WHEEL', colorValue: '#FFFFFF', defaultValue };
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

// ─── Render-Range Derivation (SHUTTER / COLOR_WHEEL semantics) ────────────────

const WHITE: [number, number, number] = [255, 255, 255];
const MAX_STROBE_HZ = 25; // avoid aliasing against the ~60fps preview

function parseHexColor(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** Average of multiple hex colors (multi-color slots like split gels). */
function averageColors(colors?: string[]): [number, number, number] | null {
  if (!colors || colors.length === 0) return null;
  let r = 0, g = 0, b = 0, n = 0;
  for (const c of colors) {
    const rgb = parseHexColor(c);
    if (!rgb) continue;
    r += rgb[0]; g += rgb[1]; b += rgb[2]; n++;
  }
  if (n === 0) return null;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/**
 * Parses an OFL speed string into a strobe frequency in Hz.
 * Accepts "3Hz", "50%", "slow", "fast". Returns undefined when unparseable.
 */
function parseStrobeHz(s?: string): number | undefined {
  if (!s) return undefined;
  const hz = /(-?[\d.]+)\s*Hz/i.exec(s);
  if (hz && hz[1]) return Math.min(MAX_STROBE_HZ, Math.abs(parseFloat(hz[1])));
  const pct = /([\d.]+)\s*%/.exec(s);
  if (pct && pct[1]) return Math.min(MAX_STROBE_HZ, 1 + (parseFloat(pct[1]) / 100) * 9);
  const t = s.trim().toLowerCase();
  if (t.includes('slow')) return 1;
  if (t.includes('fast')) return 10;
  return undefined;
}

/** DMX bounds of a capability; a single capability without dmxRange spans the full channel. */
function capRange(cap: OflCapability, isOnly: boolean): [number, number] | null {
  if (cap.dmxRange) return [cap.dmxRange[0], cap.dmxRange[1]];
  return isOnly ? [0, 255] : null;
}

/** Resolves the wheel a capability refers to (explicit wheel name, else channel name). */
function wheelFor(
  cap: { wheel?: string | string[] },
  channelName: string,
  wheels: Record<string, OflWheel>,
): OflWheel | undefined {
  const raw = cap.wheel ?? channelName;
  const name = Array.isArray(raw) ? raw[0] : raw;
  if (!name) return undefined;
  if (wheels[name]) return wheels[name];
  // Fall back to case-insensitive match (channel names don't always match wheel keys exactly)
  const lower = name.toLowerCase();
  const key = Object.keys(wheels).find(k => k.toLowerCase() === lower || lower.includes(k.toLowerCase()));
  return key ? wheels[key] : undefined;
}

/** Color of a (possibly fractional) 1-based slot number. Slots without colors render white, never black. */
function slotColor(wheel: OflWheel | undefined, slotNumber: number): [number, number, number] {
  if (!wheel || wheel.slots.length === 0) return WHITE;
  const colorOf = (slot: OflWheelSlot | undefined): [number, number, number] =>
    averageColors(slot?.colors) ?? WHITE;
  const base = Math.floor(slotNumber);
  const frac = slotNumber - base;
  const idx = ((base - 1) % wheel.slots.length + wheel.slots.length) % wheel.slots.length;
  const c0 = colorOf(wheel.slots[idx]);
  if (frac < 0.01) return c0;
  const c1 = colorOf(wheel.slots[(idx + 1) % wheel.slots.length]);
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * frac),
    Math.round(c0[1] + (c1[1] - c0[1]) * frac),
    Math.round(c0[2] + (c1[2] - c0[2]) * frac),
  ];
}

/** Average color over all colored slots — used for whole-wheel rotation ranges. */
function wheelAverageColor(wheel: OflWheel | undefined): [number, number, number] {
  if (!wheel) return WHITE;
  const all = wheel.slots.flatMap(s => s.colors ?? []);
  return averageColors(all) ?? WHITE;
}

/**
 * Derives the serializable render semantics of a SHUTTER or COLOR_WHEEL channel
 * from its OFL capabilities (+ the fixture's wheel definitions).
 * Returns an empty array when nothing render-relevant was found — the LUT
 * builder then falls back to always-open / white.
 */
export function buildRenderRanges(
  capabilities: OflCapability[],
  wheels: Record<string, OflWheel> = {},
  channelName: string = '',
): RenderRange[] {
  const ranges: RenderRange[] = [];
  const isOnly = capabilities.length === 1;

  for (const cap of capabilities) {
    const dmx = capRange(cap, isOnly);
    if (!dmx) continue;
    const [min, max] = dmx;

    switch (cap.type) {
      case 'ShutterStrobe': {
        if (cap.shutterEffect === 'Open') {
          ranges.push({ kind: 'shutter', min, max, freqStart: 0, freqEnd: 0 });
        } else if (cap.shutterEffect === 'Closed') {
          ranges.push({ kind: 'shutter', min, max, freqStart: -1, freqEnd: -1 });
        } else {
          const start = parseStrobeHz(cap.speedStart) ?? parseStrobeHz(cap.speed) ?? 1;
          const end = parseStrobeHz(cap.speedEnd) ?? parseStrobeHz(cap.speed) ?? 10;
          ranges.push({ kind: 'shutter', min, max, freqStart: start, freqEnd: end });
        }
        break;
      }

      case 'NoFunction':
        // On a shutter channel NoFunction usually means blackout; only treat it
        // that way when the channel actually has shutter semantics elsewhere.
        if (capabilities.some(c => c.type === 'ShutterStrobe')) {
          ranges.push({ kind: 'shutter', min, max, freqStart: -1, freqEnd: -1 });
        }
        break;

      case 'WheelSlot':
      case 'WheelShake':
      case 'WheelSlotRotation': {
        const wheel = wheelFor(cap, channelName, wheels);
        const start = cap.slotNumberStart ?? cap.slotNumber;
        const end = cap.slotNumberEnd ?? cap.slotNumber;
        if (start === undefined) {
          ranges.push({ kind: 'color', min, max, rgb: wheelAverageColor(wheel) });
        } else {
          const rgb = slotColor(wheel, start);
          const rgbEnd = end !== undefined && end !== start ? slotColor(wheel, end) : undefined;
          ranges.push({ kind: 'color', min, max, rgb, rgbEnd });
        }
        break;
      }

      case 'WheelRotation': {
        const wheel = wheelFor(cap, channelName, wheels);
        ranges.push({ kind: 'color', min, max, rgb: wheelAverageColor(wheel) });
        break;
      }

      case 'ColorPreset': {
        const rgb = averageColors(cap.colors ?? cap.colorsStart) ?? WHITE;
        const endColors = averageColors(cap.colorsEnd);
        ranges.push({ kind: 'color', min, max, rgb, rgbEnd: endColors ?? undefined });
        break;
      }

      default:
        break;
    }
  }

  return ranges;
}

/**
 * Computes the DMX value that puts a SHUTTER channel to "open" or a COLOR_WHEEL
 * channel to its open/white slot. Used for auto-defaults and the highlight action.
 */
export function computeOpenDefault(role: ChannelRole, ranges: RenderRange[]): number | undefined {
  const mid = (r: { min: number; max: number }) => Math.round((r.min + r.max) / 2);

  if (role === 'SHUTTER') {
    const open = ranges.find(r => r.kind === 'shutter' && r.freqStart === 0 && r.freqEnd === 0);
    if (open) return mid(open);
    const notClosed = ranges.find(r => r.kind === 'shutter' && r.freqStart >= 0);
    return notClosed ? mid(notClosed) : undefined;
  }

  if (role === 'COLOR_WHEEL') {
    const isWhite = (rgb: [number, number, number]) => rgb[0] >= 250 && rgb[1] >= 250 && rgb[2] >= 250;
    const white = ranges.find(r => r.kind === 'color' && isWhite(r.rgb) && !r.rgbEnd);
    if (white) return mid(white);
    const first = ranges.find(r => r.kind === 'color');
    return first ? mid(first) : undefined;
  }

  return undefined;
}
