/**
 * E1.20 slot types (Table C-1) and slot label ids (Table C-2), and the Open
 * Fixture Library capability a generated fixture definition uses for each
 * (plan M6.2, decision D10 step 2).
 *
 * What a capability turns into is decided by the core (`capability-map.ts`),
 * so only shapes that need no device knowledge we lack are emitted:
 * - No DMX ranges are known: every capability spans the whole slot.
 * - Pan/Tilt carry no angles: the 3D view reads `angleStart`/`angleEnd` as
 *   degrees and would take a made-up range for the real travel.
 * - Strobe becomes `StrobeSpeed`, not `ShutterStrobe`: a single ShutterStrobe
 *   capability makes the preview strobe (or stay dark) at every value and
 *   replaces the device's default value with the middle of the range.
 * - Wheels (colour, gobo, effects, scroller, semaphore) become `Generic`:
 *   `WheelSlot` needs a `wheels` section we cannot know, and `ColorPreset`
 *   without colours also replaces the device's default value.
 * - Everything without an obvious OFL counterpart is `Generic`.
 */
import type { Json } from '@pixelmapper/extension-api';

/** A JSON object (OFL capability, channel, …). */
export type JsonObject = { [key: string]: Json };

// ── Slot types (E1.20 Table C-1) ───────────────

/** Slot types of SLOT_INFO. For every `SEC_*` type `labelId` is the offset of the primary slot. */
export const SLOT_TYPE = {
  PRIMARY: 0x00,
  SEC_FINE: 0x01,
  SEC_TIMING: 0x02,
  SEC_SPEED: 0x03,
  SEC_CONTROL: 0x04,
  SEC_INDEX: 0x05,
  SEC_ROTATION: 0x06,
  SEC_INDEX_ROTATE: 0x07,
  SEC_UNDEFINED: 0xff,
} as const;

/** Channel name suffix per secondary slot type ("Pan fine", "Gobo Speed"). */
const SECONDARY_SUFFIX: Readonly<Record<number, string>> = {
  [SLOT_TYPE.SEC_FINE]: 'fine',
  [SLOT_TYPE.SEC_TIMING]: 'Timing',
  [SLOT_TYPE.SEC_SPEED]: 'Speed',
  [SLOT_TYPE.SEC_CONTROL]: 'Control',
  [SLOT_TYPE.SEC_INDEX]: 'Index',
  [SLOT_TYPE.SEC_ROTATION]: 'Rotation',
  [SLOT_TYPE.SEC_INDEX_ROTATE]: 'Index/Rotation',
};

// ── Slot labels (E1.20 Table C-2, E1.37-1) ─────

/** Slot label ids of primary slots. */
export const SLOT_LABEL = {
  INTENSITY: 0x0001,
  INTENSITY_MASTER: 0x0002,
  PAN: 0x0101,
  TILT: 0x0102,
  COLOR_WHEEL: 0x0201,
  COLOR_SUB_CYAN: 0x0202,
  COLOR_SUB_YELLOW: 0x0203,
  COLOR_SUB_MAGENTA: 0x0204,
  COLOR_ADD_RED: 0x0205,
  COLOR_ADD_GREEN: 0x0206,
  COLOR_ADD_BLUE: 0x0207,
  COLOR_CORRECTION: 0x0208,
  COLOR_SCROLL: 0x0209,
  COLOR_SEMAPHORE: 0x0210,
  COLOR_ADD_AMBER: 0x0211,
  COLOR_ADD_WHITE: 0x0212,
  COLOR_ADD_WARM_WHITE: 0x0213,
  COLOR_ADD_COOL_WHITE: 0x0214,
  COLOR_SUB_UV: 0x0215,
  COLOR_HUE: 0x0216,
  COLOR_SATURATION: 0x0217,
  STATIC_GOBO_WHEEL: 0x0301,
  ROTO_GOBO_WHEEL: 0x0302,
  PRISM_WHEEL: 0x0303,
  EFFECTS_WHEEL: 0x0304,
  BEAM_SIZE_IRIS: 0x0401,
  EDGE: 0x0402,
  FROST: 0x0403,
  STROBE: 0x0404,
  ZOOM: 0x0405,
  FRAMING_SHUTTER: 0x0406,
  SHUTTER_ROTATE: 0x0407,
  DOUSER: 0x0408,
  BARN_DOOR: 0x0409,
  LAMP_CONTROL: 0x0501,
  FIXTURE_CONTROL: 0x0502,
  FIXTURE_SPEED: 0x0503,
  MACRO: 0x0504,
  POWER_CONTROL: 0x0505,
  FAN_CONTROL: 0x0506,
  HEATER_CONTROL: 0x0507,
  FOUNTAIN_CONTROL: 0x0508,
  UNDEFINED: 0xffff,
} as const;

/** Builds a `ColorIntensity` capability. */
const color = (c: string): JsonObject => ({ type: 'ColorIntensity', color: c });
/** Builds a capability without further properties. */
const plain = (type: string): JsonObject => ({ type });

/** Channel name and OFL capability per slot label (see the file comment for the choices). */
const LABELS: Readonly<Record<number, readonly [name: string, capability: JsonObject]>> = {
  [SLOT_LABEL.INTENSITY]: ['Dimmer', plain('Intensity')],
  [SLOT_LABEL.INTENSITY_MASTER]: ['Master Dimmer', plain('Intensity')],
  [SLOT_LABEL.PAN]: ['Pan', plain('Pan')],
  [SLOT_LABEL.TILT]: ['Tilt', plain('Tilt')],
  [SLOT_LABEL.COLOR_WHEEL]: ['Color Wheel', plain('Generic')],
  [SLOT_LABEL.COLOR_SUB_CYAN]: ['Cyan', color('Cyan')],
  [SLOT_LABEL.COLOR_SUB_YELLOW]: ['Yellow', color('Yellow')],
  [SLOT_LABEL.COLOR_SUB_MAGENTA]: ['Magenta', color('Magenta')],
  [SLOT_LABEL.COLOR_ADD_RED]: ['Red', color('Red')],
  [SLOT_LABEL.COLOR_ADD_GREEN]: ['Green', color('Green')],
  [SLOT_LABEL.COLOR_ADD_BLUE]: ['Blue', color('Blue')],
  [SLOT_LABEL.COLOR_CORRECTION]: ['Color Correction', plain('ColorTemperature')],
  [SLOT_LABEL.COLOR_SCROLL]: ['Color Scroll', plain('Generic')],
  [SLOT_LABEL.COLOR_SEMAPHORE]: ['Color Semaphore', plain('Generic')],
  [SLOT_LABEL.COLOR_ADD_AMBER]: ['Amber', color('Amber')],
  [SLOT_LABEL.COLOR_ADD_WHITE]: ['White', color('White')],
  [SLOT_LABEL.COLOR_ADD_WARM_WHITE]: ['Warm White', color('Warm White')],
  [SLOT_LABEL.COLOR_ADD_COOL_WHITE]: ['Cool White', color('Cold White')],
  [SLOT_LABEL.COLOR_SUB_UV]: ['UV', color('UV')],
  [SLOT_LABEL.COLOR_HUE]: ['Hue', plain('Generic')],
  [SLOT_LABEL.COLOR_SATURATION]: ['Saturation', plain('Generic')],
  [SLOT_LABEL.STATIC_GOBO_WHEEL]: ['Gobo Wheel', plain('Generic')],
  [SLOT_LABEL.ROTO_GOBO_WHEEL]: ['Rotating Gobo Wheel', plain('Generic')],
  [SLOT_LABEL.PRISM_WHEEL]: ['Prism', plain('Prism')],
  [SLOT_LABEL.EFFECTS_WHEEL]: ['Effects Wheel', plain('Generic')],
  [SLOT_LABEL.BEAM_SIZE_IRIS]: ['Iris', plain('Iris')],
  [SLOT_LABEL.EDGE]: ['Focus', plain('Focus')],
  [SLOT_LABEL.FROST]: ['Frost', plain('Frost')],
  [SLOT_LABEL.STROBE]: ['Strobe', plain('StrobeSpeed')],
  [SLOT_LABEL.ZOOM]: ['Zoom', plain('Zoom')],
  [SLOT_LABEL.FRAMING_SHUTTER]: ['Framing Shutter', plain('Generic')],
  [SLOT_LABEL.SHUTTER_ROTATE]: ['Shutter Rotation', plain('Generic')],
  [SLOT_LABEL.DOUSER]: ['Douser', plain('Generic')],
  [SLOT_LABEL.BARN_DOOR]: ['Barn Door', plain('Generic')],
  [SLOT_LABEL.LAMP_CONTROL]: ['Lamp Control', plain('Maintenance')],
  [SLOT_LABEL.FIXTURE_CONTROL]: ['Fixture Control', plain('Maintenance')],
  [SLOT_LABEL.FIXTURE_SPEED]: ['Fixture Speed', plain('Speed')],
  [SLOT_LABEL.MACRO]: ['Macro', plain('Generic')],
  [SLOT_LABEL.POWER_CONTROL]: ['Power Control', plain('Maintenance')],
  [SLOT_LABEL.FAN_CONTROL]: ['Fan Control', plain('Maintenance')],
  [SLOT_LABEL.HEATER_CONTROL]: ['Heater Control', plain('Maintenance')],
  [SLOT_LABEL.FOUNTAIN_CONTROL]: ['Fountain Control', plain('Maintenance')],
};

// ── Lookups ────────────────────────────────────

/** Channel name of a primary slot label ("Red"); `null` for undefined or manufacturer labels. */
export function slotLabelName(labelId: number): string | null {
  return LABELS[labelId]?.[0] ?? null;
}

/** OFL capability of a primary slot label (a fresh object); `Generic` when unknown. */
export function slotLabelCapability(labelId: number): JsonObject {
  return { ...(LABELS[labelId]?.[1] ?? plain('Generic')) };
}

/** Channel name of a secondary slot from its primary's name ("Pan" → "Pan Speed"). */
export function secondarySlotName(type: number, primaryName: string): string {
  return `${primaryName} ${SECONDARY_SUFFIX[type] ?? 'Secondary'}`;
}

/**
 * OFL capability of a secondary slot that is not used as a fine channel:
 * speed slots become `PanTiltSpeed` (of Pan/Tilt) or `Speed`, rotation slots
 * `Rotation`, timing slots `Time`, everything else `Generic`.
 */
export function secondarySlotCapability(type: number, primaryLabelId: number | null): JsonObject {
  if (type === SLOT_TYPE.SEC_SPEED) {
    const panTilt = primaryLabelId === SLOT_LABEL.PAN || primaryLabelId === SLOT_LABEL.TILT;
    return plain(panTilt ? 'PanTiltSpeed' : 'Speed');
  }
  if (type === SLOT_TYPE.SEC_ROTATION) return plain('Rotation');
  if (type === SLOT_TYPE.SEC_TIMING) return plain('Time');
  return plain('Generic');
}
