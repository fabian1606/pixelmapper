import type { Effect, EffectContext, ChannelType, SpeedConfig } from "../types";
import type { EffectEngine } from "../engine";

export abstract class BaseEffect implements Effect {
  public id: string;
  public targetChannels: ChannelType[] = [];
  public targetFixtureIds?: (string | number)[];
  public strength: number = 100;
  abstract fanning: number;
  abstract speed: SpeedConfig;

  constructor() {
    this.id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11);
  }

  abstract update(deltaTime: number, engine: EffectEngine): void;
  abstract render(context: EffectContext): number;
  abstract getPreviewCSS(params: {
    worldWidth: number;
    worldHeight: number;
    camera: { x: number; y: number; scale: number };
    viewportWidth: number;
    viewportHeight: number;
  }): Record<string, string>;
}
