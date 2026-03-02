import type { Command } from '../composables/use-history';
import type { EffectEngine } from '~/utils/engine/engine';
import type { Effect } from '~/utils/engine/types';
import { SineEffect } from '~/utils/engine/effects/sine-effect';

/**
 * Deep clones an array of effects to decouple them from the live engine state.
 * This is crucial for history snapshots so that future mutations don't alter past history.
 */
export function cloneEffectsList(effects: Effect[]): Effect[] {
  return effects.map(effect => {
    // Currently only SineEffect is implemented, but this is a scalable pattern
    let clone: Effect;
    if (effect instanceof SineEffect) {
      clone = new SineEffect();
    } else {
      // Fallback: Attempt to instantiate if it's a known class, or just object spread
      // (This will need expanding if complex new effect classes are added)
      clone = Object.create(Object.getPrototypeOf(effect));
    }

    // Clone all known properties
    clone.targetChannels = [...(effect.targetChannels || [])];
    clone.targetFixtureIds = effect.targetFixtureIds ? [...effect.targetFixtureIds] : undefined;
    clone.direction = effect.direction;
    clone.reverse = effect.reverse;
    clone.strength = effect.strength;
    clone.fanning = effect.fanning;
    clone.originX = effect.originX;
    clone.originY = effect.originY;
    clone.angle = effect.angle;
    if ('speed' in effect) {
      const spd = (effect as any).speed;
      (clone as any).speed = typeof spd === 'object' ? { ...spd } : spd;
    }

    // Internal state like timePhase should theoretically be cloned too
    if ('timePhase' in effect) {
      (clone as any).timePhase = (effect as any).timePhase;
    }

    return clone;
  });
}

/**
 * Snapshot-based command for undoing/redoing any changes to the global Modifiers (Effects) list.
 */
export class SetModifiersCommand implements Command {
  constructor(
    private effectEngine: EffectEngine,
    private beforeEffects: Effect[],
    private afterEffects: Effect[],
    public description: string = 'Modifier Change'
  ) { }

  execute() {
    this.effectEngine.clearEffects();
    // Deep clone again on apply so the snapshot remains pristine for future undo/redo cycles
    const toApply = cloneEffectsList(this.afterEffects);
    toApply.forEach(eff => this.effectEngine.addEffect(eff));
  }

  undo() {
    this.effectEngine.clearEffects();
    const toApply = cloneEffectsList(this.beforeEffects);
    toApply.forEach(eff => this.effectEngine.addEffect(eff));
  }
}
