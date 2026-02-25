import { BaseOscillatorEffect } from "./base-oscillator-effect";

export class SineEffect extends BaseOscillatorEffect {
  getShape(phase: number): number {
    // Generate sine wave (-1 to 1) based on pure phase
    return Math.sin(phase);
  }
}
