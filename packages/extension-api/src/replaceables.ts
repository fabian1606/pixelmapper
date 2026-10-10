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
import type { CurveAxis, CurveDomain, CurveRange, CurveValue } from './curves';
import type { GradientValue, StepsValue } from './params';

/** Visual size of an input. */
export type InputSize = 'sm' | 'md' | 'lg';

/** Props every `pm.*` contract shares (besides `modelValue`). */
export interface BaseInputProps {
  /** Disable interaction. */
  disabled?: boolean;
  /** Optional label rendered by the input. */
  label?: string;
  /** Visual size. Default `'md'`. */
  size?: InputSize;
}

/**
 * Shared props including the value. Each contract below declares its
 * `modelValue` concretely (normalized where applicable) instead of extending
 * this generic, because Vue's SFC compiler cannot reliably resolve generic
 * type arguments when deriving runtime prop types.
 */
export type CommonInputProps<T> = BaseInputProps & { modelValue: T };

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
export interface FaderProps extends BaseInputProps {
  /** Current value. */
  modelValue: number;
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
  /** Display unit appended to the value; `'%'` shows the normalized value as percent. */
  unit?: string;
  /**
   * Presentation hint. `'track'` (default): a linear fill slider.
   * `'box'`: a compact square swatch dragged horizontally (property sidebar).
   * Replacements MAY ignore presentation hints.
   */
  variant?: 'track' | 'box';
  /** Presentation hint: icon component shown inside the fader (box variant). */
  icon?: Component;
  /** Presentation hint: static CSS background (e.g. a color-wheel slot color or gradient). */
  fill?: string;
  /** Presentation hint: CSS color of the inner ring (box variant). */
  ringColor?: string;
}
/** Emits of `pm.fader`. */
export type FaderEmits = CommonInputEmits<number>;

// ── pm.numberInput ──────────────────────────────

/** Props of `pm.numberInput`: a draggable numeric field. */
export interface NumberInputProps extends BaseInputProps {
  /** Current value. */
  modelValue: number;
  min?: number;
  max?: number;
  step?: number;
  /** Decimal places shown. */
  precision?: number;
  unit?: string;
}
/** Emits of `pm.numberInput`. */
export interface NumberInputEmits extends CommonInputEmits<number> {
  /** Emitted once an edit is committed (drag end, Enter, blur) with the final value. */
  commit: [value: number];
}

// ── pm.colorInput ───────────────────────────────

/** A preset color offered by `pm.colorInput` (e.g. a color-wheel slot). */
export interface ColorSwatch {
  color: RgbColor;
  /** Name shown as tooltip, e.g. `'Deep Red'`. */
  label?: string;
}

/** Props of `pm.colorInput`: linear RGB color, components 0–1. */
export interface ColorInputProps extends BaseInputProps {
  /** Current value. */
  modelValue: RgbColor;
  /** Optional preset swatches; picking one emits its color as one edit. */
  swatches?: ColorSwatch[];
  /**
   * The target cannot mix colors (e.g. only color wheels): offer just the
   * swatches, no free color selection.
   */
  swatchesOnly?: boolean;
}
/** Emits of `pm.colorInput`. */
export type ColorInputEmits = CommonInputEmits<RgbColor>;

// ── pm.xyInput ──────────────────────────────────

/** Props of `pm.xyInput`: normalized 2D point (0–1 per axis). */
export interface XyInputProps extends BaseInputProps {
  /** Current value. */
  modelValue: Vec2;
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
export interface SelectProps extends BaseInputProps {
  /** Current value. */
  modelValue: string;
  options: SelectOption[];
  /** Presentation. Default `'auto'` (segmented for ≤ 4 options). */
  variant?: 'auto' | 'segmented' | 'dropdown';
}
/** Emits of `pm.select`. */
export type SelectEmits = CommonInputEmits<string>;

// ── pm.toggle ───────────────────────────────────

/** Props of `pm.toggle`: boolean switch. */
export interface ToggleProps extends BaseInputProps {
  /** Current value. */
  modelValue: boolean;
}
/** Emits of `pm.toggle`. */
export type ToggleEmits = CommonInputEmits<boolean>;

// ── pm.curve ────────────────────────────────────

/** Props of `pm.curve`: editable curve of control points (normalized). */
export interface CurveProps extends BaseInputProps {
  /** Current value: programmatic `{ shape, args }`, free `{ points }` or legacy points. */
  modelValue: CurveValue;
  /** Offered shapes (registry ids) in UI order; omitted = free editing only. */
  shapes?: string[];
  /** Allow converting to free points. Default true. */
  allowFree?: boolean;
  /** x-range: `cycle` = [0, 1] (default), `signed` = [−1, 1]. */
  domain?: CurveDomain;
  /** Tick/snap context. Default `none`. */
  axis?: CurveAxis;
  /** Fixtures (axis `fixtures`) or beats per cycle (axis `beats`). */
  ticks?: number;
  /** y display; the value stays 0–1. Default `unipolar`. */
  range?: CurveRange;
  /** Playhead position in domain units, or null. */
  playhead?: number | null;
  /** Show the endless-strip slot (`#strip`) under the editor. */
  strip?: boolean;
  /** Display scale of the y axis (value 1 is shown as `yMax`). Default 1. */
  yMax?: number;
}
/** Emits of `pm.curve`. */
export type CurveEmits = CommonInputEmits<CurveValue>;

// ── pm.angle ────────────────────────────────────

/** Props of `pm.angle`: angle in radians. */
export interface AngleProps extends BaseInputProps {
  /** Current angle in radians. */
  modelValue: number;
}
/** Emits of `pm.angle`. */
export type AngleEmits = CommonInputEmits<number>;

// ── pm.tapTempo ─────────────────────────────────

/** Props of `pm.tapTempo`: tempo in BPM with tap input. */
export interface TapTempoProps extends BaseInputProps {
  /** Current value. */
  modelValue: number;
  /** Current beat phase 0–1 for the visual pulse (optional). */
  phase?: number;
  /** Accent/background color (CSS color). */
  color?: string;
}
/** Emits of `pm.tapTempo`. */
export interface TapTempoEmits extends CommonInputEmits<number> {
  /** Emitted on every tap. */
  tap: [];
}

// ── pm.button ───────────────────────────────────

/** Props of `pm.button`: a live/trigger button (not the shadcn button). */
export interface TriggerButtonProps extends BaseInputProps {
  /** Current value. */
  modelValue: boolean;
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

// ── pm.gradient ─────────────────────────────────

/** Props of `pm.gradient`: color stops on a bar (1–8 stops). */
export interface GradientProps extends BaseInputProps {
  modelValue: GradientValue;
}
/** Emits of `pm.gradient`. */
export type GradientEmits = CommonInputEmits<GradientValue>;

// ── pm.hueRange ─────────────────────────────────

/**
 * Props of `pm.hueRange` (composite editor): a 360° hue strip centered on the
 * fixtures' hue; `shift` (degrees, −180…180) moves the center, `range`
 * (degrees, 0…180) the swing on both sides.
 */
export interface HueRangeProps extends BaseInputProps {
  modelValue: { shift: number; range: number };
  /** Current hue of the fixtures (degrees) the strip is centered on. Default 0. */
  baseHue?: number;
}
/** Emits of `pm.hueRange`. */
export type HueRangeEmits = CommonInputEmits<{ shift: number; range: number }>;

// ── pm.steps ────────────────────────────────────

/**
 * Props of `pm.steps`: a grid of groups (rows) × steps (columns). Rows use
 * the shared group colors; rows at or beyond `activeGroups` are shown
 * disabled (the rig has fewer groups).
 */
export interface StepsProps extends BaseInputProps {
  modelValue: StepsValue;
  /** Groups the rig actually has (0 = unknown, all rows active). */
  activeGroups?: number;
  /** Live position in steps (e.g. 2.4 = step 2), or null. */
  playhead?: number | null;
}
/** Emits of `pm.steps`. */
export type StepsEmits = CommonInputEmits<StepsValue>;

// ── pm.noiseHistory ─────────────────────────────

/** Value of `pm.noiseHistory`: level range and occasional events. */
export interface NoiseHistoryValue {
  /** Lowest and highest level (0–1). */
  min: number;
  max: number;
  /** Events per step (0 = none) and their length in steps. */
  rate: number;
  length: number;
  dir: 'up' | 'down';
}

/**
 * Props of `pm.noiseHistory` (composite editor): sample traces over a few
 * steps with draggable range lines and event markers.
 */
export interface NoiseHistoryProps extends BaseInputProps {
  modelValue: NoiseHistoryValue;
  /** Renders `cycles` steps of `count` virtual fixtures (levels 0–1, per fixture). */
  traces?: (count: number, points: number, cycles: number) => Float32Array[] | null;
}
/** Emits of `pm.noiseHistory`. */
export type NoiseHistoryEmits = CommonInputEmits<NoiseHistoryValue>;

// ── pm.pickCount ────────────────────────────────

/** Props of `pm.pickCount` (composite editor): "N of M on" (`count` 0 = a third). */
export interface PickCountProps extends BaseInputProps {
  modelValue: { count: number };
  /** M: the numbered fixtures. */
  rankCount?: number;
}
/** Emits of `pm.pickCount`. */
export type PickCountEmits = CommonInputEmits<{ count: number }>;

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
  'pm.gradient': { props: GradientProps; emits: GradientEmits };
  'pm.hueRange': { props: HueRangeProps; emits: HueRangeEmits };
  'pm.steps': { props: StepsProps; emits: StepsEmits };
  'pm.noiseHistory': { props: NoiseHistoryProps; emits: NoiseHistoryEmits };
  'pm.pickCount': { props: PickCountProps; emits: PickCountEmits };
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
  'pm.gradient',
  'pm.hueRange',
  'pm.steps',
  'pm.noiseHistory',
  'pm.pickCount',
];

/**
 * Declares that an extension replaces a `pm.*` input. The component must
 * accept `PmInputContracts[N]['props']` and emit `PmInputContracts[N]['emits']`.
 */
export interface ReplacementContribution<N extends PmInputName = PmInputName> {
  replaces: N;
  component: Component;
}
