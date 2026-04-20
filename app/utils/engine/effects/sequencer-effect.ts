import type { EffectContext, SequencerParams, SpeedConfig } from "../types";
import type { EffectEngine } from "../engine";
import { BaseEffect } from "./base-effect";
import { seededRandom, perlin2D } from "./noise-math";

function fnv1aQuantized(wx: number, wy: number): number {
  // Scale to match Rust fnv1a_pos which rounds after multiplying by 10000
  const ix = Math.round(wx * 10000);
  const iy = Math.round(wy * 10000);
  let h = 2166136261;
  h = Math.imul(h ^ (ix & 0xff), 16777619);
  h = Math.imul(h ^ ((ix >> 8) & 0xff), 16777619);
  h = Math.imul(h ^ (iy & 0xff), 16777619);
  h = Math.imul(h ^ ((iy >> 8) & 0xff), 16777619);
  return h >>> 0;
}

function evalPattern(params: SequencerParams, nx: number, ny: number, halfCycle = 0): boolean {
  const ox = params.originX;
  const oy = params.originY;
  const s = Math.sin(params.angle);
  const c = Math.cos(params.angle);
  const dx = nx - ox;
  const dy = ny - oy;
  const u = dx * c + dy * s;
  const v = -dx * s + dy * c;
  const cell = params.scale;

  let on: boolean;
  switch (params.patternType) {
    case 'split':
      on = v > 0;
      break;
    case 'checkerboard': {
      const gu = Math.floor(u / cell);
      const gv = Math.floor(v / cell);
      // Use positive modulo to handle negative coords correctly
      on = ((gu + gv) % 2 + 2) % 2 === 0;
      break;
    }
    case 'sections':
      on = Math.abs(Math.floor(u / cell)) % 2 === 0;
      break;
    case 'scatter': {
      const base = fnv1aQuantized(nx, ny);
      const seed = (base + Math.imul(halfCycle, 2654435761)) >>> 0;
      on = seededRandom(seed) < params.density;
      break;
    }
  }

  return params.invert ? !on : on;
}

export class SequencerEffect extends BaseEffect {
  public override fanning: number = 0;
  public override speed: SpeedConfig = { mode: 'time', timeMs: 500, beatValue: 1, beatOffset: 0 };

  public sequencerParams: SequencerParams = {
    patternType: 'split',
    originX: 0.5,
    originY: 0.5,
    angle: 0,
    scale: 0.1,
    count: 4,
    density: 0.5,
    densityVariation: 0,
    invert: false,
  };

  private timePhase: number = 0;
  private scatterCycle: number = 0;
  private flowTime: number = 0;

  private resolveSpeedToMs(engine: EffectEngine): number {
    const s = this.speed;
    if (s.mode === 'infinite') return Infinity;
    if (s.mode === 'beat') return (60000 / engine.globalBpm.value) * s.beatValue;
    return s.timeMs;
  }

  override update(deltaTime: number, engine: EffectEngine): void {
    const durationMs = this.resolveSpeedToMs(engine);
    if (durationMs === Infinity || durationMs === 0) return;
    this.timePhase += (deltaTime / durationMs) * Math.PI * 2;
    this.scatterCycle = Math.floor(engine.absTimeMs / durationMs);
    this.flowTime = engine.absTimeMs / 1000;
  }

  override render(context: EffectContext): number {
    const sp = this.sequencerParams;

    if (sp.patternType === 'scatter') {
      const dv = sp.densityVariation ?? 0;
      let density = sp.density;
      if (dv > 0) {
        const varSeed = (Math.imul(this.scatterCycle, 1664525) + 1013904223) >>> 0;
        const vary = seededRandom(varSeed) * 2 - 1;
        density = Math.max(0, Math.min(1, density + vary * dv));
      }
      const base = fnv1aQuantized(context.x, context.y);
      const seed = (base + Math.imul(this.scatterCycle, 2654435761)) >>> 0;
      const on = seededRandom(seed) < density;
      return (sp.invert ? !on : on) ? 0 : -1;
    }

    if (sp.patternType === 'flow') {
      const durationMs = this.resolveSpeedToMs({ mode: this.speed.mode, timeMs: this.speed.timeMs, beatValue: this.speed.beatValue, beatOffset: 0 } as any);
      const speed = durationMs === Infinity ? 0 : 1 / (durationMs / 1000);
      const scale = Math.max(0.01, sp.scale);
      const t = this.flowTime * speed;
      const noise = perlin2D(context.x / scale + t, context.y / scale + t * 0.7);
      const threshold = sp.density * 2 - 1;
      const on = noise > threshold;
      return (sp.invert ? !on : on) ? 0 : -1;
    }

    const on = evalPattern(sp, context.x, context.y);
    const cycleT = ((this.timePhase / (Math.PI * 2)) % 1 + 1) % 1;
    const toggled = cycleT >= 0.5 ? !on : on;
    return (sp.invert ? !toggled : toggled) ? 0 : -1;
  }

  override getPreviewCSS(params: {
    worldWidth: number;
    worldHeight: number;
    camera: { x: number; y: number; scale: number };
    viewportWidth: number;
    viewportHeight: number;
  }): Record<string, string> {
    const sp = this.sequencerParams;
    const { worldWidth, worldHeight } = params;
    const ox = sp.originX * worldWidth;
    const oy = sp.originY * worldHeight;
    const cellPx = sp.scale * worldWidth;
    const rotDeg = sp.angle * 180 / Math.PI;
    const D = Math.max(worldWidth, worldHeight) * 2;

    // v>0 → ON (below axis in rotated space), invert flips ON/OFF
    const onAlpha = 0.18;
    const offAlpha = 0.45;
    const onColor = sp.invert ? `rgba(0,0,0,${offAlpha})` : `rgba(255,255,255,${onAlpha})`;
    const offColor = sp.invert ? `rgba(255,255,255,${onAlpha})` : `rgba(0,0,0,${offAlpha})`;

    switch (sp.patternType) {
      case 'split': {
        // Rotated div centered at origin; top half = v<0 (OFF), bottom half = v>0 (ON)
        return {
          position: 'absolute',
          width: `${D * 2}px`,
          height: `${D * 2}px`,
          left: `${ox - D}px`,
          top: `${oy - D}px`,
          transform: `rotate(${rotDeg}deg)`,
          transformOrigin: `${D}px ${D}px`,
          backgroundImage: `linear-gradient(to bottom, ${offColor} 50%, ${onColor} 50%)`,
        };
      }
      case 'checkerboard': {
        const S = cellPx * 2;
        // Center div at origin for rotation; align cell grid to origin
        return {
          position: 'absolute',
          width: `${D * 2}px`,
          height: `${D * 2}px`,
          left: `${ox - D}px`,
          top: `${oy - D}px`,
          transform: `rotate(${rotDeg}deg)`,
          transformOrigin: `${D}px ${D}px`,
          backgroundImage: `conic-gradient(${onColor} 0deg 90deg, ${offColor} 90deg 180deg, ${onColor} 180deg 270deg, ${offColor} 270deg 360deg)`,
          backgroundSize: `${S}px ${S}px`,
          // Shift so cell boundary aligns with origin (center of div at D,D)
          backgroundPosition: `${D % S}px ${D % S}px`,
        };
      }
      case 'sections': {
        const S = cellPx * 2;
        // Alternating bands along u axis (horizontal in rotated div); u=0 at center
        return {
          position: 'absolute',
          width: `${D * 2}px`,
          height: `${D * 2}px`,
          left: `${ox - D}px`,
          top: `${oy - D}px`,
          transform: `rotate(${rotDeg}deg)`,
          transformOrigin: `${D}px ${D}px`,
          backgroundImage: `repeating-linear-gradient(to right, ${onColor} 0, ${onColor} ${cellPx}px, ${offColor} ${cellPx}px, ${offColor} ${S}px)`,
          // Align so band boundary is at x=D (origin) → shift by D mod S
          backgroundPosition: `${D % S}px 0`,
        };
      }
      case 'scatter': {
        const alpha = (0.5 - sp.density * 0.3).toFixed(2);
        return {
          position: 'absolute',
          width: `${worldWidth}px`,
          height: `${worldHeight}px`,
          left: '0',
          top: '0',
          backgroundColor: `rgba(0,0,0,${alpha})`,
        };
      }
      case 'flow': {
        // Approximate Perlin blobs with overlapping soft radial gradients
        const blobR = sp.scale * worldWidth * 1.5;
        const on = 'rgba(255,255,255,0.18)';
        const off = 'rgba(0,0,0,0.45)';
        // Three blobs placed at stable offsets from origin
        const b1x = ox, b1y = oy;
        const b2x = ox + sp.scale * worldWidth * 1.2, b2y = oy - sp.scale * worldWidth * 0.8;
        const b3x = ox - sp.scale * worldWidth * 0.9, b3y = oy + sp.scale * worldWidth * 1.1;
        return {
          position: 'absolute',
          width: `${worldWidth}px`,
          height: `${worldHeight}px`,
          left: '0',
          top: '0',
          backgroundImage: [
            `radial-gradient(ellipse ${blobR}px ${blobR * 0.8}px at ${b1x}px ${b1y}px, ${on} 0%, transparent 100%)`,
            `radial-gradient(ellipse ${blobR * 0.9}px ${blobR}px at ${b2x}px ${b2y}px, ${on} 0%, transparent 100%)`,
            `radial-gradient(ellipse ${blobR}px ${blobR * 0.7}px at ${b3x}px ${b3y}px, ${on} 0%, transparent 100%)`,
          ].join(', '),
          backgroundColor: off,
        };
      }
    }
  }
}
