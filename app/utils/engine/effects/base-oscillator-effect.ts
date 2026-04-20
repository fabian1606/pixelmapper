import type { EffectContext, EffectDirection, SpeedConfig } from "../types";
import type { EffectEngine } from "../engine";
import { BaseEffect } from "./base-effect";

export abstract class BaseOscillatorEffect extends BaseEffect {
  constructor() {
    super();
  }
  public direction: EffectDirection = 'LINEAR';
  public originX: number = 0.5;
  public originY: number = 0.5;
  public angle: number = 0;
  public override strength: number = 100;
  public reverse: boolean = false;

  public speed: SpeedConfig = { mode: 'time', timeMs: 2000, beatValue: 1, beatOffset: 0 };
  public fanning: number = 0.5;

  protected timePhase: number = 0;
  protected currentOffsetPhase: number = 0;

  override update(deltaTime: number, engine: EffectEngine): void {
    const durationMs = this.resolveSpeedToMs(this.speed, engine);

    if (durationMs === Infinity || durationMs === 0) {
      return;
    }

    if (this.speed.mode === 'beat' && this.speed.beatOffset) {
      const beatDurMs = 60000 / engine.globalBpm.value;
      const offsetMs = this.speed.beatOffset * beatDurMs;
      this.currentOffsetPhase = (offsetMs / durationMs) * Math.PI * 2;
    } else {
      this.currentOffsetPhase = 0;
    }

    const phaseAdvance = (deltaTime / durationMs) * Math.PI * 2;
    this.timePhase += phaseAdvance;
  }

  protected resolveSpeedToMs(speed: SpeedConfig, engine: EffectEngine): number {
    if (speed.mode === 'infinite') return Infinity;
    if (speed.mode === 'beat') return (60000 / engine.globalBpm.value) * speed.beatValue;
    return speed.timeMs;
  }

  protected getDirectionalOffset(context: EffectContext): number {
    const { x, y } = context;

    const dx = x - (this.originX ?? 0.5);
    const dy = y - (this.originY ?? 0.5);
    const angle = this.angle ?? 0;

    switch (this.direction) {
      case 'LINEAR':
        return dx * Math.cos(angle) + dy * Math.sin(angle);
      case 'RADIAL':
        return Math.sqrt(dx * dx + dy * dy);
      case 'SYMMETRICAL':
        return Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle));
      default:
        return dx * Math.cos(angle) + dy * Math.sin(angle);
    }
  }

  override render(context: EffectContext): number {
    if (this.fanning === 0 || this.direction === 'NONE') {
      return this.getShape(this.timePhase);
    }

    const dist = this.getDirectionalOffset(context);
    const fanning = Math.max(0.0001, this.fanning);
    let phaseOffset = (dist / fanning) * Math.PI * 2;

    if (this.reverse) phaseOffset = -phaseOffset;

    return this.getShape(this.timePhase - phaseOffset + this.currentOffsetPhase);
  }

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

    const cCrest = 'rgba(255, 255, 255, 0.096)';
    const cTrough = 'rgba(0, 0, 0, 0.48)';

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
        backgroundImage: `repeating-linear-gradient(${this.reverse ? -90 : 90}deg, ${cTrough} 0px, ${cCrest} ${fanningPx / 2}px, ${cTrough} ${fanningPx}px)`
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
        backgroundImage: `repeating-radial-gradient(circle at ${ox - vLeft}px ${oy - vTop}px, ${cTrough} 0px, ${cCrest} ${fanningPx / 2}px, ${cTrough} ${fanningPx}px)`
      };
    }
    return {};
  }

  abstract getShape(phase: number): number;
}
