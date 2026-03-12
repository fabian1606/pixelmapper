import type { Command } from '../composables/use-history';
import type { Fixture } from '~/utils/engine/core/fixture';

/**
 * Reversible command for updating a fixture's DMX start address.
 * Since universe is derived from startAddress, this covers both.
 */
export class UpdateDmxCommand implements Command {
    readonly description: string;

    constructor(
        private readonly fixture: Fixture,
        private readonly beforeAddress: number,
        private readonly afterAddress: number,
    ) {
        this.description = `Update DMX for ${fixture.name}`;
    }

    execute() {
        this.fixture.startAddress = this.afterAddress;
    }

    undo() {
        this.fixture.startAddress = this.beforeAddress;
    }
}
