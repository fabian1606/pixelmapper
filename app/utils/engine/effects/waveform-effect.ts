import type { WaveformShape, WaveformShapeParams } from '../types';
import { BaseOscillatorEffect } from './base-oscillator-effect';
import { evaluatePhase, evaluateShape } from './waveform-math';

export class WaveformEffect extends BaseOscillatorEffect {
  public waveformShape: WaveformShape = 'sine';
  public waveformParams: WaveformShapeParams = { param: 0.5, start: 0, end: 1 };

  getShape(phase: number): number {
    return evaluatePhase(
      phase,
      this.waveformShape,
      this.waveformParams.param,
      this.waveformParams.start,
      this.waveformParams.end,
    );
  }

  /**
   * Override CSS preview to generate shape-aware gradient stops so the canvas
   * overlay matches the configured waveform.
   */
  override getPreviewCSS(params: {
    worldWidth: number;
    worldHeight: number;
    camera: { x: number; y: number; scale: number };
    viewportWidth: number;
    viewportHeight: number;
  }): Record<string, string> {
    if (this.fanning === 0 || this.direction === 'NONE') return {};

    const { worldWidth, worldHeight, camera, viewportWidth, viewportHeight } = params;
    const angleDeg = ((this.angle ?? 0) * 180) / Math.PI;
    const fanningPx = this.fanning * worldWidth;
    const ox = (this.originX ?? 0.5) * worldWidth;
    const oy = (this.originY ?? 0.5) * worldHeight;

    // Sample the waveform to build multi-stop gradient
    const STOPS = 16;
    const stopStrings: string[] = [];
    const { start, end, param } = this.waveformParams;

    for (let i = 0; i <= STOPS; i++) {
      const t = i / STOPS;
      let raw: number;
      if (t < start || t > end || start >= end) {
        raw = 0;
      } else {
        const localT = (t - start) / (end - start);
        raw = evaluateShape(this.waveformShape, localT, param);
      }
      const norm = (raw + 1) / 2;
      const opacity = 0.48 - norm * 0.384;
      const pxPos = t * fanningPx;
      stopStrings.push(`rgba(0, 0, 0, ${opacity.toFixed(3)}) ${pxPos.toFixed(1)}px`);
    }

    const gradientBody = stopStrings.join(', ');

    const vLeft = -camera.x / camera.scale;
    const vTop = -camera.y / camera.scale;
    const vRight = vLeft + viewportWidth / camera.scale;
    const vBottom = vTop + viewportHeight / camera.scale;

    if (this.direction === 'LINEAR' || this.direction === 'SYMMETRICAL') {
      const dists = [
        Math.hypot(vLeft - ox, vTop - oy),
        Math.hypot(vRight - ox, vTop - oy),
        Math.hypot(vLeft - ox, vBottom - oy),
        Math.hypot(vRight - ox, vBottom - oy)
      ];
      const maxDist = Math.max(...dists);
      const minSize = maxDist * 2;
      const N = Math.ceil(minSize / (fanningPx * 2));
      const pxC = N * 2 * fanningPx;

      return {
        position: 'absolute',
        width: `${pxC}px`,
        height: `${pxC}px`,
        left: `${ox - pxC / 2}px`,
        top: `${oy - pxC / 2}px`,
        transform: `rotate(${angleDeg}deg)`,
        transformOrigin: '50% 50%',
        backgroundImage: `repeating-linear-gradient(${this.reverse ? -90 : 90}deg, ${gradientBody})`,
        backgroundSize: `${fanningPx}px 100%`,
      };
    } else if (this.direction === 'RADIAL') {
      const vWidth = viewportWidth / camera.scale;
      const vHeight = viewportHeight / camera.scale;

      return {
        position: 'absolute',
        width: `${vWidth}px`,
        height: `${vHeight}px`,
        left: `${vLeft}px`,
        top: `${vTop}px`,
        backgroundImage: `repeating-radial-gradient(circle at ${ox - vLeft}px ${oy - vTop}px, ${gradientBody})`,
      };
    }
    return {};
  }
}
