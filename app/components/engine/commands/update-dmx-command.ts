import type { Command } from '../composables/use-history';
import type { Fixture } from '~/utils/engine/core/fixture';
import { useEngineStore } from '~/stores/engine-store';

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

    private oldOverrides = new Map<number, number>();
    private newOverrides = new Map<number, number>();

    execute() {
        this.fixture.startAddress = this.afterAddress;
        
        // Migrate any active manual overrides from the old address to the new one
        const store = useEngineStore();
        const overrides = store.overrideMap || new Map<number, number>();
        this.oldOverrides.clear();
        this.newOverrides.clear();
        
        for (let i = 0; i < this.fixture.channels.length; i++) {
            const oldBufIdx = this.beforeAddress - 1 + i;
            const newBufIdx = this.afterAddress - 1 + i;
            
            if (overrides.has(oldBufIdx)) {
                const val = overrides.get(oldBufIdx)!;
                this.oldOverrides.set(oldBufIdx, val);
                this.newOverrides.set(newBufIdx, val);
                
                store.clearOverride(oldBufIdx);
                store.setOverride(newBufIdx, val);
            }
        }
    }

    undo() {
        this.fixture.startAddress = this.beforeAddress;
        
        const store = useEngineStore();
        for (const [newBufIdx, _] of this.newOverrides) {
            store.clearOverride(newBufIdx);
        }
        for (const [oldBufIdx, val] of this.oldOverrides) {
            store.setOverride(oldBufIdx, val);
        }
    }
}
