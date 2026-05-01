import type { Command } from '../composables/use-history';
import type { Fixture } from '../../../utils/engine/core/fixture';
import { type SerializableCommand, registerCommand } from './serializable-command';

export interface FixtureRotationSnapshot {
    id: string | number;
    rotation: number;
}

export class RotateFixtureCommand implements SerializableCommand {
    readonly commandType = 'RotateFixture';
    public description = 'Rotate Fixture(s)';

    constructor(
        private allFixtures: Fixture[],
        private stateBefore: FixtureRotationSnapshot[],
        private stateAfter: FixtureRotationSnapshot[]
    ) { }

    execute() {
        this.applyState(this.stateAfter);
    }

    undo() {
        this.applyState(this.stateBefore);
    }

    toPayload() {
        return { before: this.stateBefore, after: this.stateAfter };
    }

    private applyState(state: FixtureRotationSnapshot[]) {
        for (const snapshot of state) {
            const fixture = this.allFixtures.find(f => f.id === snapshot.id);
            if (fixture) {
                fixture.rotation = snapshot.rotation;
            }
        }
    }
}

registerCommand('RotateFixture', (payload, ctx) => {
    const fixtures = ctx.flatFixtures.filter(f =>
        payload.after.some((s: FixtureRotationSnapshot) => s.id === f.id)
    );
    return new RotateFixtureCommand(fixtures, payload.before, payload.after);
});
