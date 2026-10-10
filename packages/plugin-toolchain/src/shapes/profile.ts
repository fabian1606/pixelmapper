/**
 * Built-in profile shapes (plan §3.1): what is lit over the distance from the
 * moving position. Domain `signed` (x ∈ [−1, 1], x = spatial − position);
 * periodic shapes repeat with period `1 / repeat`. Comet-like shapes (wedge,
 * flash) put their tail behind the head (x < 0), so it trails the motion.
 */
import type { ShapeArgDef, ShapeDef } from '@pixelmapper/extension-api';
import { behind, centered, clamp, level, levelArgs, repeatArg, smoothstep } from './common';

/** Repeat of the args (≥ 1). */
const rep = (a: Record<string, number>) => Math.max(1, a.repeat ?? 1);

/** Width (edgeX, snaps to fixtures): the dot's full width in periods. */
function widthArg(def: number): ShapeArgDef {
  return {
    key: 'width', label: 'Width', min: 0.01, max: 1, default: def, step: 0.01,
    handle: {
      kind: 'edgeX',
      snap: 'ticks',
      anchor: a => ({ x: (a.width ?? def) / 2 / rep(a), y: level(a, 0.5) }),
      drag: (a, p) => Math.abs(p.x) * 2 * rep(a),
    },
  };
}

/** Softness (point on the flank top): fraction of the half width that fades. */
function softnessArg(def: number): ShapeArgDef {
  return {
    key: 'softness', label: 'Softness', min: 0, max: 1, default: def, step: 0.01,
    handle: {
      kind: 'pointOnEdge',
      anchor: a => ({ x: ((a.width ?? 0.15) / 2) * (1 - (a.softness ?? def)) / rep(a), y: level(a, 1) }),
      drag: (a, p) => 1 - (Math.abs(p.x) * rep(a)) / Math.max(1e-3, (a.width ?? 0.15) / 2),
    },
  };
}

/** Dot core: plateau of `width` with smooth flanks of `softness`. */
function dotCore(x: number, a: Record<string, number>): number {
  const half = (a.width ?? 0.15) / 2;
  const d = Math.abs(centered(x, rep(a)));
  return 1 - smoothstep(half * (1 - (a.softness ?? 0)), half, d);
}

const dot: ShapeDef = {
  id: 'dot', label: 'Dot', domain: 'signed', periodic: true,
  args: [widthArg(0.15), softnessArg(0.5), repeatArg, ...levelArgs('signed')],
  evaluate: (x, a) => level(a, dotCore(x, a)),
};

const bar: ShapeDef = {
  id: 'bar', label: 'Bar', domain: 'signed', periodic: true,
  args: [widthArg(0.5), softnessArg(0), repeatArg, ...levelArgs('signed')],
  evaluate: (x, a) => level(a, dotCore(x, a)),
};

const wave: ShapeDef = {
  id: 'wave', label: 'Wave', domain: 'signed', periodic: true,
  args: [repeatArg, ...levelArgs('signed')],
  evaluate: (x, a) => level(a, 0.5 + 0.5 * Math.cos(2 * Math.PI * centered(x, rep(a)))),
};

const wedge: ShapeDef = {
  id: 'wedge', label: 'Wedge', domain: 'signed', periodic: true,
  args: [
    {
      key: 'length', label: 'Length', min: 0.02, max: 1, default: 0.3, step: 0.01,
      handle: {
        kind: 'edgeX', snap: 'ticks',
        anchor: a => ({ x: -(a.length ?? 0.3) / rep(a), y: level(a, 0) }),
        drag: (a, p) => Math.max(0, -p.x) * rep(a),
      },
    },
    repeatArg,
    ...levelArgs('signed'),
  ],
  evaluate: (x, a) => {
    const u = behind(x, rep(a));
    const len = a.length ?? 0.3;
    return level(a, u < len ? 1 - u / len : 0);
  },
};

const edge: ShapeDef = {
  id: 'edge', label: 'Edge (fill)', domain: 'signed', periodic: false,
  args: [
    {
      key: 'softness', label: 'Softness', min: 0, max: 1, default: 0.05, step: 0.01,
      handle: {
        kind: 'pointOnEdge',
        anchor: a => ({ x: -(a.softness ?? 0.05) / 2, y: level(a, 1) }),
        drag: (_, p) => Math.abs(p.x) * 2,
      },
    },
    ...levelArgs('signed'),
  ],
  evaluate: (x, a) => {
    const s = (a.softness ?? 0.05) / 2;
    return level(a, 1 - smoothstep(-s, s, x));
  },
  toPoints: (a) => {
    const s = clamp((a.softness ?? 0.05) / 2, 0, 1);
    const hi = level(a, 1);
    const lo = level(a, 0);
    if (s < 1e-6) return [{ x: 0, y: hi, kind: 'step' }, { x: 0.5, y: hi, kind: 'step' }, { x: 0.5 + 1e-6, y: lo, kind: 'linear' }, { x: 1, y: lo }];
    const x0 = (1 - s) / 2;
    const x1 = (1 + s) / 2;
    const d = (x1 - x0) / 3;
    return [
      { x: 0, y: hi, kind: 'linear' },
      { x: x0, y: hi, kind: 'corner', out: { dx: d, dy: 0 } },
      { x: x1, y: lo, kind: 'linear', in: { dx: -d, dy: 0 } },
      { x: 1, y: lo },
    ];
  },
};

const flash: ShapeDef = {
  id: 'flash', label: 'Flash', domain: 'signed', periodic: true,
  args: [
    {
      key: 'attack', label: 'Attack', min: 0, max: 0.5, default: 0.05, step: 0.01,
      handle: {
        kind: 'edgeX', snap: 'ticks',
        anchor: a => ({ x: -(a.attack ?? 0.05) / rep(a), y: level(a, 0.5) }),
        drag: (a, p) => Math.max(0, -p.x) * rep(a),
      },
    },
    {
      key: 'decay', label: 'Decay', min: 0.01, max: 1, default: 0.3, step: 0.01,
      handle: {
        kind: 'pointOnEdge',
        anchor: a => ({ x: -((a.attack ?? 0.05) + (a.decay ?? 0.3)) / rep(a), y: level(a, Math.exp(-1)) }),
        drag: (a, p) => Math.max(0, -p.x) * rep(a) - (a.attack ?? 0.05),
      },
    },
    repeatArg,
    ...levelArgs('signed'),
  ],
  evaluate: (x, a) => {
    const u = behind(x, rep(a));
    const at = a.attack ?? 0.05;
    const core = u < at ? u / Math.max(at, 1e-6) : Math.exp(-(u - at) / Math.max(a.decay ?? 0.3, 1e-3));
    return level(a, core);
  },
};

/** Profile shapes in UI order. */
export const PROFILE_SHAPES: readonly ShapeDef[] = [dot, bar, wave, wedge, edge, flash];
