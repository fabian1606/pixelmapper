import type { NoiseType, NoiseParams } from "../types";

// ─── Perlin noise ────────────────────────────────────────────────────────────

const PERM = new Uint8Array(512);
const GRAD_X = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0, 1, 0, -1, 0];
const GRAD_Y = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 0, 1, 0, -1];

;(function initPerm() {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = p[i]!; p[i] = p[j]!; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]!;
})();

function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a: number, b: number, t: number) { return a + t * (b - a); }
function grad(hash: number, x: number, y: number) {
  const h = hash & 15;
  return GRAD_X[h]! * x + GRAD_Y[h]! * y;
}

/** Classic 2D Perlin noise. Returns value in [-1, 1]. */
export function perlin2D(x: number, y: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);

  const aa = PERM[(PERM[X]!     + Y) & 511]!;
  const ab = PERM[(PERM[X]!     + Y + 1) & 511]!;
  const ba = PERM[(PERM[X + 1]! + Y) & 511]!;
  const bb = PERM[(PERM[X + 1]! + Y + 1) & 511]!;

  return lerp(
    lerp(grad(aa, xf,     yf    ), grad(ba, xf - 1, yf    ), u),
    lerp(grad(ab, xf,     yf - 1), grad(bb, xf - 1, yf - 1), u),
    v
  );
}

// ─── Seeded random (hash-based, stateless) ───────────────────────────────────

/** Returns a deterministic pseudo-random number in [0, 1] for any integer seed. */
export function seededRandom(seed: number): number {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
  s = (s ^ (s >>> 16)) >>> 0;
  return s / 0x100000000;
}

// ─── Preview grid sampling ───────────────────────────────────────────────────

export interface NoiseGridCell {
  col: number;
  row: number;
  /** Brightness 0–1 */
  value: number;
  /** RGB tint when channelMode='independent', otherwise undefined */
  rgb?: [number, number, number];
}

/** Smoothly blends `prev` → `curr` over the first `fade*dur` of the step. */
function crossfade(prev: number, curr: number, elapsed: number, dur: number, fade: number): number {
  const f = Math.max(0, Math.min(1, fade));
  if (f <= 0) return curr;
  const fadeWin = dur * f;
  if (elapsed >= fadeWin) return curr;
  const t = Math.max(0, Math.min(1, elapsed / fadeWin));
  const s = t * t * (3 - 2 * t);
  return prev + (curr - prev) * s;
}

/** Sample one noise channel (R/G/B or brightness). */
function sampleOne(
  noiseType: NoiseType,
  nx: number,
  ny: number,
  time: number,
  period: number,
  scale: number,
  cellSeed: number,
  channelSeed: number,
  fade: number
): number {
  if (noiseType === 'perlin') {
    const timeSec = time / 1000;
    const ox = channelSeed * 0.0137;
    const oy = channelSeed * 0.0219;
    const raw = perlin2D(nx * scale * 4 + timeSec * 0.3 + ox, ny * scale * 4 + oy);
    return raw * 0.5 + 0.5;
  }

  // White: per-pixel rate jitter + phase offset for TV-static feel
  if (noiseType === 'white') {
    const seed = cellSeed ^ channelSeed;
    const rateJitter = 0.6 + seededRandom(seed + 0xA1) * 0.8;
    const phaseOff = seededRandom(seed + 0xB2) * period;
    const dur = Math.max(1, period * rateJitter);
    const localT = time + phaseOff;
    const tick = Math.floor(localT / dur);
    const elapsed = localT - tick * dur;
    const curr = seededRandom(seed + tick * 997);
    const prev = seededRandom(seed + (tick - 1) * 997);
    return crossfade(prev, curr, elapsed, dur, fade);
  }

  // Step: whole grid jumps together, with optional fade
  const seed = cellSeed ^ channelSeed;
  const dur = Math.max(1, period);
  const tick = Math.floor(time / dur);
  const elapsed = time - tick * dur;
  const curr = seededRandom(seed + tick * 1013);
  const prev = seededRandom(seed + (tick - 1) * 1013);
  return crossfade(prev, curr, elapsed, dur, fade);
}

function applyThreshold(raw: number, threshold: number): number {
  if (threshold <= 0) return raw;
  const norm = (raw + 1) * 0.5;
  if (norm < threshold) return 0; // maps to -1 in engine, i.e. dark
  if (threshold >= 1) return 1;
  return (norm - threshold) / (1 - threshold);
}

/** Sample a noise field for the preview grid. cols × rows cells. */
export function sampleNoiseGrid(
  type: NoiseType,
  params: NoiseParams,
  time: number,
  cols: number,
  rows: number
): NoiseGridCell[] {
  const cells: NoiseGridCell[] = [];
  const { noiseType, scale, channelMode, colorVariation, fade } = params;
  const fadeAmt = fade ?? 0;
  const threshold = params.threshold ?? 0;
  const period = 2000; // ms — base rate for white/step cycles in preview

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const nx = col / cols;
      const ny = row / rows;
      const cellSeed = row * cols + col;

      const value = applyThreshold(sampleOne(noiseType, nx, ny, time, period, scale, cellSeed, 0, fadeAmt), threshold);

      if (colorVariation > 0) {
        const rBase = value;
        const rCh   = applyThreshold(sampleOne(noiseType, nx, ny, time, period, scale, cellSeed, 0x3D1, fadeAmt), threshold);
        const gCh   = applyThreshold(sampleOne(noiseType, nx, ny, time, period, scale, cellSeed, 0x80F, fadeAmt), threshold);
        const bCh   = applyThreshold(sampleOne(noiseType, nx, ny, time, period, scale, cellSeed, 0xC8B, fadeAmt), threshold);
        const r = rBase + (rCh - rBase) * colorVariation;
        const g = rBase + (gCh - rBase) * colorVariation;
        const b = rBase + (bCh - rBase) * colorVariation;
        cells.push({ col, row, value, rgb: [r, g, b] });
      } else {
        cells.push({ col, row, value });
      }
    }
  }
  return cells;
}
