/**
 * Undoable BPM change (operation `project.setBpm`).
 *
 * BPM is persisted and broadcast as the `engine.bpm` live-op (tap tempo,
 * beat widgets). This local command routes execute/undo through that live-op
 * so collaborators and the change log see both directions; it is therefore
 * not serializable itself (the live-op persists).
 */
import type { Command } from '../composables/use-history';
import { useEngineStore } from '~/stores/engine-store';

/** Writes a BPM: via the live bus when available, else directly to the store. */
export type BpmWriter = (bpm: number) => void;

/** Default writer: `engine.bpm` live-op, falling back to the store (tests, no Nuxt context). */
async function dispatchBpm(bpm: number): Promise<void> {
  const store = useEngineStore();
  // Apply locally first so readers see the new value synchronously.
  store.baseBpm = bpm;
  try {
    const { useLiveBusStore } = await import('~/stores/live-bus-store');
    useLiveBusStore().dispatch('engine.bpm', { bpm });
  }
  catch (err) {
    // No live bus (headless / tests): the local write above is the change.
    console.debug('[set-bpm] live bus unavailable, BPM set locally:', err);
  }
}

/** Sets the base BPM; undo restores the previous value. */
export class SetBpmCommand implements Command {
  readonly description: string;

  constructor(
    private readonly before: number,
    private readonly after: number,
    private readonly write: BpmWriter = bpm => void dispatchBpm(bpm),
  ) {
    this.description = `Set BPM to ${after}`;
  }

  execute() { this.write(this.after); }
  undo() { this.write(this.before); }
}
