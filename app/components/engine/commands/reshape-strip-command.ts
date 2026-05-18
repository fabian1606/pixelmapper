import type { Fixture, StripPoint } from '~/utils/engine/core/fixture';
import { type SerializableCommand, registerCommand } from './serializable-command';
import { syncStripBounds } from '~/utils/engine/neopixel-strip-factory';

export interface StripPointsSnapshot {
  id: string | number;
  points: StripPoint[];
}

/**
 * Reversible reshape command for NeoPixel strip polylines.
 * Captures the entire vertex list before and after a vertex drag, body
 * translate, vertex insertion, or vertex deletion.
 *
 * On apply, replaces `stripConfig.points` and refreshes the centroid/AABB
 * via `syncStripBounds` so the spatial index and label position stay correct.
 */
export class ReshapeStripCommand implements SerializableCommand {
  readonly commandType = 'ReshapeStrip';
  readonly description: string;

  constructor(
    private readonly fixtures: Fixture[],
    private readonly before: StripPointsSnapshot,
    private readonly after: StripPointsSnapshot,
  ) {
    this.description = `Reshape Strip ${before.id}`;
  }

  execute() { this.applySnapshot(this.after); }
  undo()    { this.applySnapshot(this.before); }

  toPayload() {
    return { before: this.before, after: this.after };
  }

  private applySnapshot(snap: StripPointsSnapshot) {
    const f = this.fixtures.find(f => f.id === snap.id);
    if (!f || !f.stripConfig) return;
    f.stripConfig.points = snap.points.map(p => ({ x: p.x, y: p.y }));
    syncStripBounds(f);
  }
}

registerCommand('ReshapeStrip', (payload, ctx) => {
  const fixtures = ctx.flatFixtures.filter(f => f.id === payload.after.id);
  return new ReshapeStripCommand(fixtures, payload.before, payload.after);
});
