import type { LiveMapping } from '~/utils/live/types';
import type { BaseControllerDriver } from './base-controller-driver';

export type ControllerControlType = 'button' | 'slider' | 'encoder' | 'xy-pad';

export interface ControllerControl {
  /** Stable id matching emitted ControlInputEvent.controlId. */
  id: string;
  type: ControllerControlType;
  label?: string;
  /** Hit-area rect in SVG viewBox coordinates (used for sidebar selection bbox, fallback hit-test). */
  rect: { x: number; y: number; w: number; h: number };
  /**
   * ID of the SVG element that visually represents this control. The widget
   * binds pointer events to this element and toggles its fill on press.
   * For sliders the element is a <g> containing a child <rect id^="range">
   * (the travel track) and a child <g id^="knob"> (the part that moves).
   */
  svgId?: string;
  /** Optional default mapping suggestion when a twin is freshly added. */
  defaultMapping?: Partial<LiveMapping>;
}

export interface ControllerDefinition {
  /** Unique stable key, matches the folder name. */
  key: string;
  label: string;
  vendor: string;
  model: string;
  /** Raw SVG markup (patched in by the catalog from layout.svg). */
  svg: string;
  viewBox: { w: number; h: number };
  /** Default footprint of the twin on the live-mode grid. */
  defaultGridSize: { w: number; h: number };
  controls: ControllerControl[];
  driverFactory: (id: string) => BaseControllerDriver;
}

export type ControllerStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ControlInputEvent {
  controlId: string;
  type: 'press' | 'release' | 'value';
  /** 0..1 for sliders/encoders/velocity. */
  value?: number;
}

export type ControlFeedbackState =
  | 'on'
  | 'off'
  | { type: 'rgb'; r: number; g: number; b: number };

export interface ControlFeedback {
  controlId: string;
  state: ControlFeedbackState;
}

/** Per-control mapping override stored inside a controller-twin widget. */
export interface ControllerChildBinding {
  controlId: string;
  label?: string;
  color?: string;
  mapping: LiveMapping;
}
