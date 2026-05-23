import type { Fixture, StripPoint, StripShapeType } from '~/utils/engine/core/fixture';
import { type SerializableCommand, registerCommand } from './serializable-command';
import { syncStripBounds } from '~/utils/engine/neopixel-strip-factory';

export interface StripShapeSnapshot {
  id: string | number;
  shapeType: StripShapeType;
  points: StripPoint[];
  clockwise?: boolean;
}

/**
 * Reversible switch of a strip's `shapeType`. Because shape changes also
 * regenerate the `points` array (e.g. bezier → circle collapses to 1 center
 * point), both fields are snapshotted together.
 *
 * Channels/beams/length are not touched — they don't depend on shape.
 */
export class SetStripShapeCommand implements SerializableCommand {
  readonly commandType = 'SetStripShape';
  readonly description: string;

  constructor(
    private readonly fixtures: Fixture[],
    private readonly before: StripShapeSnapshot,
    private readonly after: StripShapeSnapshot,
  ) {
    this.description = `Set Strip Shape ${before.id} → ${after.shapeType}`;
  }

  execute() { this.applySnapshot(this.after); }
  undo()    { this.applySnapshot(this.before); }

  toPayload() {
    return { before: this.before, after: this.after };
  }

  private applySnapshot(snap: StripShapeSnapshot) {
    const f = this.fixtures.find(f => f.id === snap.id);
    if (!f || !f.stripConfig) return;
    f.stripConfig.shapeType = snap.shapeType;
    f.stripConfig.points = snap.points.map(p => ({ x: p.x, y: p.y }));
    if (snap.clockwise !== undefined) f.stripConfig.clockwise = snap.clockwise;
    syncStripBounds(f);
  }
}

registerCommand('SetStripShape', (payload, ctx) => {
  return new SetStripShapeCommand(ctx.flatFixtures, payload.before, payload.after);
});
