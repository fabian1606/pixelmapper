import type { Fixture, NeoPixelChipType } from '~/utils/engine/core/fixture';
import { type SerializableCommand, registerCommand } from './serializable-command';
import { regenerateStripChannelsAndBeams, type StripConfigPatch } from '~/utils/engine/strip-regenerator';

export interface StripConfigSnapshot {
  ledCount:     number;
  groupSize:    number;
  ledsPerMeter: number;
  chipType:     NeoPixelChipType;
}

/**
 * Reversible update of a strip fixture's `stripConfig` numeric parameters
 * (ledCount, groupSize, ledsPerMeter, chipType). Rebuilds channels + beams.
 *
 * The polyline points are NOT touched here — they're handled by ReshapeStrip.
 * Only the target length is re-enforced inside the regenerator if ledCount or
 * ledsPerMeter changed.
 */
export class UpdateStripConfigCommand implements SerializableCommand {
  readonly commandType = 'UpdateStripConfig';
  readonly description: string;

  constructor(
    private readonly fixtures: Fixture[],
    private readonly fixtureId: string | number,
    private readonly before: StripConfigSnapshot,
    private readonly after:  StripConfigSnapshot,
  ) {
    this.description = `Update Strip ${fixtureId}`;
  }

  execute() { this.apply(this.after); }
  undo()    { this.apply(this.before); }

  toPayload() {
    return { fixtureId: this.fixtureId, before: this.before, after: this.after };
  }

  private apply(snap: StripConfigSnapshot) {
    const f = this.fixtures.find(f => f.id === this.fixtureId);
    if (!f || !f.stripConfig) return;
    const patch: StripConfigPatch = {
      ledCount:     snap.ledCount,
      groupSize:    snap.groupSize,
      ledsPerMeter: snap.ledsPerMeter,
      chipType:     snap.chipType,
    };
    regenerateStripChannelsAndBeams(f, patch);
  }
}

registerCommand('UpdateStripConfig', (payload, ctx) => {
  return new UpdateStripConfigCommand(
    ctx.flatFixtures,
    payload.fixtureId,
    payload.before,
    payload.after,
  );
});
