import type { Command } from '../composables/use-history';
import type { Fixture } from '../../../utils/engine/core/fixture';

export interface FixtureRotationSnapshot {
    id: string | number;
    rotation: number;
}

export class RotateFixtureCommand implements Command {
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

    private applyState(state: FixtureRotationSnapshot[]) {
        for (const snapshot of state) {
            const fixture = this.allFixtures.find(f => f.id === snapshot.id);
            if (fixture) {
                fixture.rotation = snapshot.rotation;
            }
        }
    }
}
