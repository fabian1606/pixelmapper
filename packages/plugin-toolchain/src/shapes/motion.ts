/**
 * Built-in motion shapes (plan §3.1): where the profile is during one pass
 * (position 0–1 over the cycle). Domain `cycle`, not periodic. `peak`/`floor`
 * bound the travelled range.
 */
import type { CurvePointV2, ShapeDef } from '@pixelmapper/extension-api';
import { clamp, clamp01, level, levelArgs } from './common';

/** Level-mapped point (normalized space equals the cycle domain). */
const pt = (a: Record<string, number>, x: number, core: number, kind: CurvePointV2['kind'] = 'linear'): CurvePointV2 =>
  ({ x, y: level(a, core), kind });

const run: ShapeDef = {
  id: 'run', label: 'Run', domain: 'cycle', periodic: false,
  args: levelArgs('cycle'),
  evaluate: (x, a) => level(a, x),
  toPoints: a => [pt(a, 0, 0), pt(a, 1, 1)],
};

const pingpong: ShapeDef = {
  id: 'pingpong', label: 'Ping-pong', domain: 'cycle', periodic: false,
  args: levelArgs('cycle'),
  evaluate: (x, a) => level(a, 1 - Math.abs(2 * x - 1)),
  toPoints: a => [pt(a, 0, 0), pt(a, 0.5, 1), pt(a, 1, 0)],
};

/** Steps of the args (`count` 0 = one per fixture). */
const stepCount = (a: Record<string, number>, ticks: number) => Math.max(1, Math.round(a.count ?? 0) || ticks || 1);

const step: ShapeDef = {
  id: 'step', label: 'Step', domain: 'cycle', periodic: false,
  args: [
    {
      key: 'count', label: 'Steps', min: 0, max: 64, default: 0, step: 1,
      handle: { kind: 'none', anchor: () => ({ x: 0, y: 0 }), drag: a => a.count ?? 0 },
    },
    ...levelArgs('cycle'),
  ],
  evaluate: (x, a, ctx) => {
    const n = stepCount(a, ctx.ticks);
    return level(a, Math.min(n - 1, Math.floor(clamp01(x) * n)) / n);
  },
  toPoints: (a, ctx) => {
    const n = stepCount(a, ctx.ticks);
    const pts: CurvePointV2[] = [];
    for (let k = 0; k < n; k++) pts.push(pt(a, k / n, k / n, 'step'));
    pts.push(pt(a, 1, (n - 1) / n, 'step'));
    return pts;
  },
};

const hold: ShapeDef = {
  id: 'hold', label: 'Hold', domain: 'cycle', periodic: false,
  args: [
    {
      key: 'pause', label: 'Pause', min: 0, max: 1, default: 0.25, step: 0.01,
      handle: {
        kind: 'edgeX', snap: 'ticks',
        anchor: a => ({ x: 1 - (a.pause ?? 0.25), y: level(a, 1) }),
        drag: (_, p) => 1 - p.x,
      },
    },
    ...levelArgs('cycle'),
  ],
  evaluate: (x, a) => {
    const active = 1 - (a.pause ?? 0.25);
    return level(a, active <= 1e-6 ? 1 : Math.min(x / active, 1));
  },
  toPoints: (a) => {
    const active = clamp(1 - (a.pause ?? 0.25), 0, 1);
    if (active <= 1e-6) return [pt(a, 0, 1), pt(a, 1, 1)];
    if (active >= 1 - 1e-6) return [pt(a, 0, 0), pt(a, 1, 1)];
    return [pt(a, 0, 0), pt(a, active, 1), pt(a, 1, 1)];
  },
};

/** Cubic Bézier easing (0,0) → (in,0) → (1−out,1) → (1,1), solved for x. */
function ease(x: number, i: number, o: number): number {
  const bez = (p1: number, p2: number, t: number) => 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (bez(i, 1 - o, mid) < x) lo = mid;
    else hi = mid;
  }
  return bez(0, 1, (lo + hi) / 2);
}

const easeShape: ShapeDef = {
  id: 'ease', label: 'Ease', domain: 'cycle', periodic: false,
  args: [
    {
      key: 'in', label: 'Ease in', min: 0, max: 1, default: 0.5, step: 0.01,
      handle: { kind: 'pointOnEdge', anchor: a => ({ x: a.in ?? 0.5, y: level(a, 0) }), drag: (_, p) => p.x },
    },
    {
      key: 'out', label: 'Ease out', min: 0, max: 1, default: 0.5, step: 0.01,
      handle: { kind: 'pointOnEdge', anchor: a => ({ x: 1 - (a.out ?? 0.5), y: level(a, 1) }), drag: (_, p) => 1 - p.x },
    },
    ...levelArgs('cycle'),
  ],
  evaluate: (x, a) => level(a, ease(clamp01(x), a.in ?? 0.5, a.out ?? 0.5)),
  toPoints: (a) => {
    const lo = level(a, 0);
    const hi = level(a, 1);
    return [
      { x: 0, y: lo, kind: 'corner', out: { dx: a.in ?? 0.5, dy: 0 } },
      { x: 1, y: hi, in: { dx: -(a.out ?? 0.5), dy: 0 } },
    ];
  },
};

/** Motion shapes in UI order. */
export const MOTION_SHAPES: readonly ShapeDef[] = [run, pingpong, step, hold, easeShape];
