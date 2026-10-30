/**
 * Text ↔ number helpers for the RDM ID fields of the custom fixture editor
 * (plan M4.7). RDM manufacturer and model IDs are 16-bit values that are
 * usually written in hex (`0x7FF0`), so the inputs accept decimal or hex and
 * always display hex.
 */

/** Largest valid RDM manufacturer / model ID. */
export const RDM_ID_MAX = 0xffff;

/**
 * Parses user input into an RDM ID.
 *
 * @returns the ID for valid input (`'32752'`, `'0x7FF0'`, `'0x7ff0'`),
 *          `null` for empty input (= field cleared),
 *          `undefined` for anything invalid (non-numeric, > 0xFFFF).
 */
export function parseRdmId(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  let value: number;
  if (/^0x[0-9a-f]{1,4}$/i.test(trimmed)) value = Number.parseInt(trimmed.slice(2), 16);
  else if (/^\d{1,5}$/.test(trimmed)) value = Number.parseInt(trimmed, 10);
  else return undefined;
  return value <= RDM_ID_MAX ? value : undefined;
}

/** Formats an RDM ID as 4-digit uppercase hex (`0x7FF0`); `''` when unset. */
export function formatRdmId(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Parses an RDM personality index (1-based positive integer).
 *
 * @returns the index, `null` for empty input, `undefined` when invalid.
 */
export function parseRdmPersonalityIndex(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^\d{1,3}$/.test(trimmed)) return undefined;
  const value = Number.parseInt(trimmed, 10);
  return value >= 1 ? value : undefined;
}
