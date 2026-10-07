/**
 * Replaceable `pm.*` domain inputs (ADR §5.4, D12–D14).
 *
 * Each input has a typed props/emits contract and a core default in
 * `app/components/pm/`. Core code renders them only through `Replaceable` /
 * `useReplaceable`, so an extension that declares `replaces: 'pm.<name>'`
 * changes the input everywhere (properties sidebar, live widgets, params).
 *
 * Emits are declared in Vue's named-tuple form and can be passed directly to
 * `defineEmits<FaderEmits>()`.
 */
import type { Component } from 'vue';
import type { RgbColor, Vec2 } from './model';
import type { CurvePoint } from './params';

/** Visual size of an input. */
export type InputSize = 'sm' | 'md' | 'lg';

/** Props every `pm.*` contract shares. */
export interface CommonInputProps<T> {
  /** Current value. Normalized where applicable (documented per input). */
  modelValue: T;
  /** Disable interaction. */
  disabled?: boolean;
  /** Optional label rendered by the input. */
  label?: string;
  /** Visual size. Default `'md'`. */
  size?: InputSize;
}

/**
 * Emits every `pm.*` contract shares. `scrubStart`/`scrubEnd` bracket a
 * continuous interaction (drag) so the caller can coalesce history entries
 * into one undo step.
 */
export interface CommonInputEmits<T> {
  'update:modelValue': [value: T];
  scrubStart: [];
  scrubEnd: [];
}

// ── pm.fader ────────────────────────────────────

/** Props of `pm.fader`: a linear slider. */
export interface FaderProps extends CommonInputProps<number> {
  /** Lower bound. Default 0. */
  min?: number;
  /** Upper bound. Default 1. */
  max?: number;
  /** Step size. Default continuous. */
  step?: number;
  /** Track tint (CSS color), e.g. the channel's color. */
  color?: string;
  /** Layout. Default `'horizontal'`. */
  orientation?: 'horizontal' | 'vertical';
  /** Show the numeric value. Default true. */
  showValue?: boolean;
  /** Display unit appended to the value. */
  unit?: string;
}
/** Emits of `pm.fader`. */
export type FaderEmits = CommonInputEmits<number>;

// ── pm.numberInput ──────────────────────────────

/** Props of `pm.numberInput`: a draggable numeric field. */
export interface NumberInputProps extends CommonInputProps<number> {
  min?: number;
  max?: number;
  step?: number;
  /** Decimal places shown. */
  precision?: number;
  unit?: string;
}
/** Emits of `pm.numberInput`. */
export type NumberInputEmits = CommonInputEmits<number>;

// ── pm.colorInput ───────────────────────────────

/** Props of `pm.colorInput`: linear RGB color, components 0–1. */
export interface ColorInputProps extends CommonInputProps<RgbColor> {
  /** Optional preset swatches. */
  swatches?: RgbColor[];
}
/** Emits of `pm.colorInput`. */
export type ColorInputEmits = CommonInputEmits<RgbColor>;

// ── pm.xyInput ──────────────────────────────────

/** Props of `pm.xyInput`: normalized 2D point (0–1 per axis). */
export interface XyInputProps extends CommonInputProps<Vec2> {
  /** Axis labels, e.g. `['Pan', 'Tilt']`. */
  axisLabels?: [string, string];
  /** Optional allowed sub-rectangle (normalized), drawn as a hint. */
  bounds?: { min: Vec2; max: Vec2 };
}
/** Emits of `pm.xyInput`. */
export type XyInputEmits = CommonInputEmits<Vec2>;

// ── pm.select ───────────────────────────────────

/** One option of `pm.select`. */
export interface SelectOption {
  value: string;
  label: string;
  /** Lucide icon name (kebab-case). */
  icon?: string;
}
/** Props of `pm.select`: enum choice. */
export interface SelectProps extends CommonInputProps<string> {
  options: SelectOption[];
  /** Presentation. Default `'auto'` (segmented for ≤ 4 options). */
  variant?: 'auto' | 'segmented' | 'dropdown';
}
/** Emits of `pm.select`. */
export type SelectEmits = CommonInputEmits<string>;

// ── pm.toggle ───────────────────────────────────

/** Props of `pm.toggle`: boolean switch. */
export type ToggleProps = CommonInputProps<boolean>;
/** Emits of `pm.toggle`. */
export type ToggleEmits = CommonInputEmits<boolean>;

// ── pm.curve ────────────────────────────────────

/** Props of `pm.curve`: editable curve of control points (normalized). */
export interface CurveProps extends CommonInputProps<CurvePoint[]> {
  /** Display scale of the y axis (value 1 is shown as `yMax`). Default 1. */
  yMax?: number;
}
/** Emits of `pm.curve`. */
export type CurveEmits = CommonInputEmits<CurvePoint[]>;

// ── pm.angle ────────────────────────────────────

/** Props of `pm.angle`: angle in radians. */
export type AngleProps = CommonInputProps<number>;
/** Emits of `pm.angle`. */
export type AngleEmits = CommonInputEmits<number>;

// ── pm.tapTempo ─────────────────────────────────

/** Props of `pm.tapTempo`: tempo in BPM with tap input. */
export interface TapTempoProps extends CommonInputProps<number> {
  /** Current beat phase 0–1 for the visual pulse (optional). */
  phase?: number;
}
/** Emits of `pm.tapTempo`. */
export interface TapTempoEmits extends CommonInputEmits<number> {
  /** Emitted on every tap. */
  tap: [];
}

// ── pm.button ───────────────────────────────────

/** Props of `pm.button`: a live/trigger button (not the shadcn button). */
export interface TriggerButtonProps extends CommonInputProps<boolean> {
  /** `'momentary'` = active while pressed; `'toggle'` = flips on press. Default `'momentary'`. */
  mode?: 'momentary' | 'toggle';
  /** Accent color (CSS color). */
  color?: string;
}
/** Emits of `pm.button`. */
export interface TriggerButtonEmits extends CommonInputEmits<boolean> {
  press: [];
  release: [];
}

// ── Contract map ────────────────────────────────

/** All replaceable inputs and their contracts. */
export interface PmInputContracts {
  'pm.fader': { props: FaderProps; emits: FaderEmits };
  'pm.numberInput': { props: NumberInputProps; emits: NumberInputEmits };
  'pm.colorInput': { props: ColorInputProps; emits: ColorInputEmits };
  'pm.xyInput': { props: XyInputProps; emits: XyInputEmits };
  'pm.select': { props: SelectProps; emits: SelectEmits };
  'pm.toggle': { props: ToggleProps; emits: ToggleEmits };
  'pm.curve': { props: CurveProps; emits: CurveEmits };
  'pm.angle': { props: AngleProps; emits: AngleEmits };
  'pm.tapTempo': { props: TapTempoProps; emits: TapTempoEmits };
  'pm.button': { props: TriggerButtonProps; emits: TriggerButtonEmits };
}

/** Name of a replaceable input. */
export type PmInputName = keyof PmInputContracts;

/** All replaceable input names. */
export const PM_INPUT_NAMES: readonly PmInputName[] = [
  'pm.fader',
  'pm.numberInput',
  'pm.colorInput',
  'pm.xyInput',
  'pm.select',
  'pm.toggle',
  'pm.curve',
  'pm.angle',
  'pm.tapTempo',
  'pm.button',
];

/**
 * Declares that an extension replaces a `pm.*` input. The component must
 * accept `PmInputContracts[N]['props']` and emit `PmInputContracts[N]['emits']`.
 */
export interface ReplacementContribution<N extends PmInputName = PmInputName> {
  replaces: N;
  component: Component;
}
