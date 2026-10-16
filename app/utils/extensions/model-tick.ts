/**
 * Model tick for scope projections.
 *
 * Fixtures are plain class instances (only `chaserConfig` is reactive), so
 * projections cannot track e.g. channel ranges, positions or names directly.
 * The engine store bumps this tick whenever the layout or channel revision or
 * the scene graph changes; projections read it to re-evaluate.
 */
import { shallowRef } from 'vue';

/** Monotonic counter; read it to depend on "the fixture model changed". */
export const modelTick = shallowRef(0);

/** Signals a model change (called by the engine store). */
export function bumpModelTick(): void {
  modelTick.value++;
}
