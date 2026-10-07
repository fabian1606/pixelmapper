/**
 * Lucide icons extensions can reference by kebab-case name (manifests carry
 * names, not components). Unknown names fall back to a puzzle piece.
 */
import type { Component } from 'vue';
import {
  Cable, Circle, Crosshair, Drum, Gamepad2, Gauge, Lightbulb, Minus, MousePointerClick, Music,
  Palette, Projector, Puzzle, SlidersHorizontal, Sparkles, Spline, Timer, Type, Waypoints,
} from 'lucide-vue-next';

const ICONS: Record<string, Component> = {
  'mouse-pointer-click': MousePointerClick,
  'sliders-horizontal': SlidersHorizontal,
  crosshair: Crosshair,
  type: Type,
  projector: Projector,
  palette: Palette,
  drum: Drum,
  'gamepad-2': Gamepad2,
  lightbulb: Lightbulb,
  gauge: Gauge,
  music: Music,
  sparkles: Sparkles,
  timer: Timer,
  puzzle: Puzzle,
  minus: Minus,
  spline: Spline,
  waypoints: Waypoints,
  circle: Circle,
  cable: Cable,
};

/** Resolves a lucide icon name used by an extension. */
export function iconByName(name: string): Component {
  return ICONS[name] ?? Puzzle;
}
