/**
 * RDM units and unit prefixes of PARAMETER_DESCRIPTION (ANSI E1.20
 * Table A-13 / A-14, newer codes after OLA `RDMEnums.h`) and how a raw
 * parameter value is shown in the UI.
 *
 * A raw value `r` with prefix exponent `e` means `r × 10^e` base units.
 * The UI shows it as the device means it: SI prefixes people read every day
 * stay as a symbol (raw 176 + MICRO + SECOND → “176 µs”), the rare ones are
 * folded into the number (raw 235 + DECI + VOLTS_DC → “23.5 V DC”).
 */

// ── Units ──────────────────────────────────────

/** One E1.20 unit: spec name and display symbol. */
export interface RdmUnitInfo {
  /** Spec name without the `UNITS_` prefix, e.g. `SECOND`. */
  name: string;
  /** Display symbol, `''` for UNITS_NONE. */
  symbol: string;
}

/** E1.20 Table A-13 (0x00–0x1C) plus the later codes 0x1D–0x24. */
export const RDM_UNITS: Readonly<Record<number, RdmUnitInfo>> = {
  0x00: { name: 'NONE', symbol: '' },
  0x01: { name: 'CENTIGRADE', symbol: '°C' },
  0x02: { name: 'VOLTS_DC', symbol: 'V DC' },
  0x03: { name: 'VOLTS_AC_PEAK', symbol: 'V AC peak' },
  0x04: { name: 'VOLTS_AC_RMS', symbol: 'V AC' },
  0x05: { name: 'AMPERE_DC', symbol: 'A DC' },
  0x06: { name: 'AMPERE_AC_PEAK', symbol: 'A AC peak' },
  0x07: { name: 'AMPERE_AC_RMS', symbol: 'A AC' },
  0x08: { name: 'HERTZ', symbol: 'Hz' },
  0x09: { name: 'OHM', symbol: 'Ω' },
  0x0a: { name: 'WATT', symbol: 'W' },
  0x0b: { name: 'KILOGRAM', symbol: 'kg' },
  0x0c: { name: 'METERS', symbol: 'm' },
  0x0d: { name: 'METERS_SQUARED', symbol: 'm²' },
  0x0e: { name: 'METERS_CUBED', symbol: 'm³' },
  0x0f: { name: 'KILOGRAMMES_PER_METER_CUBED', symbol: 'kg/m³' },
  0x10: { name: 'METERS_PER_SECOND', symbol: 'm/s' },
  0x11: { name: 'METERS_PER_SECOND_SQUARED', symbol: 'm/s²' },
  0x12: { name: 'NEWTON', symbol: 'N' },
  0x13: { name: 'JOULE', symbol: 'J' },
  0x14: { name: 'PASCAL', symbol: 'Pa' },
  0x15: { name: 'SECOND', symbol: 's' },
  0x16: { name: 'DEGREE', symbol: '°' },
  0x17: { name: 'STERADIAN', symbol: 'sr' },
  0x18: { name: 'CANDELA', symbol: 'cd' },
  0x19: { name: 'LUMEN', symbol: 'lm' },
  0x1a: { name: 'LUX', symbol: 'lx' },
  0x1b: { name: 'IRE', symbol: 'IRE' },
  0x1c: { name: 'BYTE', symbol: 'B' },
  0x1d: { name: 'DECIBEL', symbol: 'dB' },
  0x1e: { name: 'DECIBEL_VOLT', symbol: 'dBV' },
  0x1f: { name: 'DECIBEL_WATT', symbol: 'dBW' },
  0x20: { name: 'DECIBEL_METER', symbol: 'dBm' },
  0x21: { name: 'PERCENT', symbol: '%' },
  0x22: { name: 'MOLES_PER_METER_CUBED', symbol: 'mol/m³' },
  0x23: { name: 'RPM', symbol: 'rpm' },
  0x24: { name: 'BYTE_PER_SECOND', symbol: 'B/s' },
};

/** Unit info of a raw code; unknown and manufacturer codes (0x80–0xFF) have no symbol. */
export function rdmUnit(code: number): RdmUnitInfo {
  return RDM_UNITS[code] ?? { name: `0x${code.toString(16).padStart(2, '0').toUpperCase()}`, symbol: '' };
}

// ── Prefixes ───────────────────────────────────

/** One E1.20 unit prefix. */
export interface RdmPrefixInfo {
  /** Spec name without the `PREFIX_` prefix, e.g. `MICRO`. */
  name: string;
  /** SI symbol, `''` for PREFIX_NONE. */
  symbol: string;
  /** Power of ten the raw value is multiplied with. */
  exponent: number;
}

/** E1.20 Table A-14. */
export const RDM_PREFIXES: Readonly<Record<number, RdmPrefixInfo>> = {
  0x00: { name: 'NONE', symbol: '', exponent: 0 },
  0x01: { name: 'DECI', symbol: 'd', exponent: -1 },
  0x02: { name: 'CENTI', symbol: 'c', exponent: -2 },
  0x03: { name: 'MILLI', symbol: 'm', exponent: -3 },
  0x04: { name: 'MICRO', symbol: 'µ', exponent: -6 },
  0x05: { name: 'NANO', symbol: 'n', exponent: -9 },
  0x06: { name: 'PICO', symbol: 'p', exponent: -12 },
  0x07: { name: 'FEMTO', symbol: 'f', exponent: -15 },
  0x08: { name: 'ATTO', symbol: 'a', exponent: -18 },
  0x09: { name: 'ZEPTO', symbol: 'z', exponent: -21 },
  0x0a: { name: 'YOCTO', symbol: 'y', exponent: -24 },
  0x11: { name: 'DECA', symbol: 'da', exponent: 1 },
  0x12: { name: 'HECTO', symbol: 'h', exponent: 2 },
  0x13: { name: 'KILO', symbol: 'k', exponent: 3 },
  0x14: { name: 'MEGA', symbol: 'M', exponent: 6 },
  0x15: { name: 'GIGA', symbol: 'G', exponent: 9 },
  0x16: { name: 'TERA', symbol: 'T', exponent: 12 },
  0x17: { name: 'PETA', symbol: 'P', exponent: 15 },
  0x18: { name: 'EXA', symbol: 'E', exponent: 18 },
  0x19: { name: 'ZETTA', symbol: 'Z', exponent: 21 },
  0x1a: { name: 'YOTTA', symbol: 'Y', exponent: 24 },
};

/** Prefix info of a raw code; unknown codes count as PREFIX_NONE. */
export function rdmPrefix(code: number): RdmPrefixInfo {
  return RDM_PREFIXES[code] ?? { name: 'NONE', symbol: '', exponent: 0 };
}

// ── Display scale ──────────────────────────────

/** How a raw integer is shown: `display = raw × factor`, with `decimals` places and `symbol`. */
export interface RdmDisplayScale {
  /** Unit symbol shown after the value (prefix included when it is kept as a symbol). */
  symbol: string;
  /** Multiplier from the raw value to the displayed number. */
  factor: number;
  /** Decimal places of the displayed number. */
  decimals: number;
  /** Spec names for tooltips, e.g. `MICRO SECOND`. */
  specName: string;
}

/** Prefixes folded into the number instead of being shown as a symbol (deci, centi, deca, hecto). */
const FOLDED_EXPONENTS = new Set([-2, -1, 1, 2]);

/** Display scale of a unit/prefix pair (see file comment). */
export function displayScale(unitCode: number, prefixCode: number): RdmDisplayScale {
  const unit = rdmUnit(unitCode);
  const prefix = rdmPrefix(prefixCode);
  const specName = [prefix.exponent !== 0 ? prefix.name : '', unit.name].filter(Boolean).join(' ');
  if (FOLDED_EXPONENTS.has(prefix.exponent)) {
    return { symbol: unit.symbol, factor: 10 ** prefix.exponent, decimals: Math.max(0, -prefix.exponent), specName };
  }
  return { symbol: `${prefix.symbol}${unit.symbol}`, factor: 1, decimals: 0, specName };
}

/** Raw integer → displayed number (rounded to the scale's decimals, no float noise). */
export function rawToDisplay(raw: number, scale: RdmDisplayScale): number {
  return Number((raw * scale.factor).toFixed(scale.decimals));
}

/** Displayed number → nearest raw integer. */
export function displayToRaw(display: number, scale: RdmDisplayScale): number {
  return Math.round(display / scale.factor);
}

/**
 * Formats a displayed number with its unit, e.g. `176 µs`, `23.5 V DC`,
 * `40 %` (SI spacing; only the plain angle degree `°` attaches directly).
 */
export function formatWithUnit(display: number, scale: RdmDisplayScale): string {
  const text = display.toFixed(scale.decimals);
  if (!scale.symbol) return text;
  return scale.symbol === '°' ? `${text}°` : `${text} ${scale.symbol}`;
}
