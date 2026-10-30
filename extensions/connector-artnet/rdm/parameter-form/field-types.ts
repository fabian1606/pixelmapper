/**
 * Types of the generic RDM parameter form's field model (plan M7.1): one
 * `RdmParameterField` per parameter, discriminated by `kind`.
 */
import type { RdmParameterDescription } from '../../bridge/protocol-model';
import type { RdmEnumOption } from './known-parameters';
import type { RdmDisplayScale } from './rdm-units';
import type { RdmIntLayout } from './wire-bytes';

// ── Field types ────────────────────────────────

/** How a parameter is edited / shown. */
export type RdmFieldKind = 'number' | 'boolean' | 'enum' | 'string' | 'bitField' | 'raw' | 'action';

/** UI value of a field: number (display units), boolean, enum raw value, string, bit field, hex. */
export type RdmFieldValue = number | boolean | string;

/** Where a field's description came from. */
export type RdmFieldSource = 'device' | 'standard' | 'undescribed';

/** Properties every field has. */
export interface RdmFieldBase {
  pid: number;
  /** Stable key and display form of the PID, e.g. `0x8110`. */
  key: string;
  /** English label (device description, or the standard's name). */
  label: string;
  /** GET allowed: the current value can be read. */
  readable: boolean;
  /** SET allowed. */
  writable: boolean;
  source: RdmFieldSource;
  /** Description the field was built from (synthesized for standard PIDs; null when undescribed). */
  description: RdmParameterDescription | null;
  /** Hint shown with the field (e.g. why the description is missing), or null. */
  note: string | null;
}

/** Integer shown as a number in display units (`display = raw × scale.factor`). */
export interface RdmNumberField extends RdmFieldBase {
  kind: 'number';
  layout: RdmIntLayout;
  scale: RdmDisplayScale;
  /** Valid raw range (PARAMETER_DESCRIPTION min/max, within the data type). */
  rawMin: number;
  rawMax: number;
  /** Range, step and default in display units. */
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

/** Integer 0/1 shown as a switch. */
export interface RdmBooleanField extends RdmFieldBase {
  kind: 'boolean';
  layout: RdmIntLayout;
  defaultValue: boolean;
}

/** Integer with a known value table. */
export interface RdmEnumField extends RdmFieldBase {
  kind: 'enum';
  layout: RdmIntLayout;
  options: readonly RdmEnumOption[];
  defaultValue: number;
}

/** ASCII text. */
export interface RdmStringField extends RdmFieldBase {
  kind: 'string';
  maxLength: number;
  defaultValue: string;
}

/** Bit field of 1, 2 or 4 bytes, edited as a number. */
export interface RdmBitFieldField extends RdmFieldBase {
  kind: 'bitField';
  layout: RdmIntLayout;
  defaultValue: number;
}

/** Structured or unknown data (notDefined, manufacturer types, arrays): hex bytes. */
export interface RdmRawField extends RdmFieldBase {
  kind: 'raw';
  /** Upper bound of the data length, null when unknown. */
  maxBytes: number | null;
  defaultValue: string;
}

/** SET without data (PDL 0): a button. */
export interface RdmActionField extends RdmFieldBase {
  kind: 'action';
}

/** One parameter of the form. */
export type RdmParameterField =
  | RdmNumberField
  | RdmBooleanField
  | RdmEnumField
  | RdmStringField
  | RdmBitFieldField
  | RdmRawField
  | RdmActionField;

/** Options of `buildParameterFields`. */
export interface BuildFieldsOptions {
  /** PIDs to leave out besides the built-in exclusions (e.g. ones the caller renders itself). */
  exclude?: Iterable<number>;
  /** Only these PIDs (the built-in exclusions still apply). */
  only?: Iterable<number>;
}
