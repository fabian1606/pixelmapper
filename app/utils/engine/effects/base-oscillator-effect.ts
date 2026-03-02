import type { Effect, EffectContext, ChannelType, EffectDirection } from "../types";

export abstract class BaseOscillatorEffect implements Effect {
  public targetChannels: ChannelType[] = [];
  public targetFixtureIds?: (string | number)[];
  public direction: EffectDirection = 'LINEAR';
  public originX: number = 0.5;
  public originY: number = 0.5;
  public angle: number = 0;
  public strength: number = 100;
  public reverse: boolean = false;

  /**
   * Speed of the oscillator animation.
   */
  public speed: number = 0.002;

  /**
   * Frequency (phase offset scaling) across fixtures.
   */
  public fanning: number = 0.5;

  protected timePhase: number = 0;

  update(deltaTime: number): void {
    this.timePhase += deltaTime * this.speed;
  }

  protected getDirectionalOffset(context: EffectContext): number {
    const { x, y } = context;

    // All coordinates are normalized [0-1] world space
    const dx = x - (this.originX ?? 0.5);
    const dy = y - (this.originY ?? 0.5);
    const angle = this.angle ?? 0;

    switch (this.direction) {
      case 'LINEAR': {
        // Signed projection along the direction vector (origin → endpoint)
        return dx * Math.cos(angle) + dy * Math.sin(angle);
      }
      case 'RADIAL': {
        // Radial distance from origin
        return Math.sqrt(dx * dx + dy * dy);
      }
      case 'SYMMETRICAL': {
        // Mirrored projection
        return Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle));
      }
      default:
        return dx * Math.cos(angle) + dy * Math.sin(angle);
    }
  }

  render(context: EffectContext): number {
    if (this.fanning === 0 || this.direction === 'NONE') {
      return this.getShape(this.timePhase); // All fixtures perfectly synchronized
    }

    // Normalized distance of this fixture along the effect direction
    const dist = this.getDirectionalOffset(context);

    // fanning = one full wavelength in normalized world coords.
    // phase advances by 2π across one wavelength.
    const fanning = Math.max(0.0001, this.fanning);
    let phaseOffset = (dist / fanning) * Math.PI * 2;

    // By default, subtract phaseOffset so waves propagate AWAY from the origin.
    // If reversed, add phaseOffset so waves propagate TOWARDS the origin.
    if (this.reverse) phaseOffset = -phaseOffset;

    return this.getShape(this.timePhase - phaseOffset);
  }

  getPreviewCSS(params: {
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

    // Very subtle dark gray pattern overlay (80% of current)
    const cCrest = 'rgba(255, 255, 255, 0.096)';
    const cTrough = 'rgba(0, 0, 0, 0.48)';

    // Visible screen boundaries in world space coordinates
    const vLeft = -camera.x / camera.scale;
    const vTop = -camera.y / camera.scale;
    const vRight = vLeft + viewportWidth / camera.scale;
    const vBottom = vTop + viewportHeight / camera.scale;

    if (this.direction === 'LINEAR' || this.direction === 'SYMMETRICAL') {
      // Find the furthest visible corner from the origin to ensure the rotated div covers the screen
      const dists = [
        Math.hypot(vLeft - ox, vTop - oy),
        Math.hypot(vRight - ox, vTop - oy),
        Math.hypot(vLeft - ox, vBottom - oy),
        Math.hypot(vRight - ox, vBottom - oy)
      ];
      const maxDist = Math.max(...dists);
      // Double the maximum distance to use as the diameter for our square container
      const minSize = maxDist * 2;

      // Find the next even integer multiple of fanningPx to guarantee the exact center matches 0px phase
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
      // For radial, we just size the div EXACTLY to the visible viewport bounds in world space
      // and offset the `circle at` mathematically from the new top left. Zero clipping, 100% optimized.
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

  /**
   * Subclasses must implement this to return a value from -1 to 1 based on phase.
   */
  abstract getShape(phase: number): number;
}
