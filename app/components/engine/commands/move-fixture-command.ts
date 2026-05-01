import type { Command } from '../composables/use-history';
import type { Fixture } from '~/utils/engine/core/fixture';
import { type SerializableCommand, registerCommand } from './serializable-command';

export interface FixturePositionSnapshot {
  id: string | number;
  x: number;
  y: number;
}

/**
 * Reversible move command. Stores world-space normalized positions 
 * (0-1) before and after a drag operation.
 *
 * To add new undoable actions in the future, create a new file in
 * `/commands/` and implement the `Command` interface.
 */
export class MoveFixtureCommand implements SerializableCommand {
  readonly commandType = 'MoveFixture';
  readonly description: string;

  constructor(
    private readonly fixtures: Fixture[],
    private readonly before: FixturePositionSnapshot[],
    private readonly after: FixturePositionSnapshot[],
  ) {
    const count = before.length;
    this.description = count === 1
    //@ts-ignore
      ? `Move Fixture ${before[0].id}`
      : `Move ${count} Fixtures`;
  }

  execute() {
    this.applySnapshots(this.after);
  }

  undo() {
    this.applySnapshots(this.before);
  }

  toPayload() {
    return { before: this.before, after: this.after };
  }

  private applySnapshots(snapshots: FixturePositionSnapshot[]) {
    for (const snap of snapshots) {
      const f = this.fixtures.find(f => f.id === snap.id);
      if (f) {
        f.fixturePosition.x = snap.x;
        f.fixturePosition.y = snap.y;
      }
    }
  }
}

registerCommand('MoveFixture', (payload, ctx) => {
  const fixtures = ctx.flatFixtures.filter(f =>
    payload.after.some((s: FixturePositionSnapshot) => s.id === f.id)
  );
  return new MoveFixtureCommand(fixtures, payload.before, payload.after);
});
