import { type SerializableCommand } from './serializable-command';
import type { EffectEngine } from '~/utils/engine/engine';
import type { ModifierInstance } from '~/utils/engine/types';
import { cloneModifiers } from '~/utils/engine/modifiers';

/**
 * Snapshot-based command for undoing/redoing any change to the modifier
 * list. Modifier instances are plain JSON, so snapshots are deep copies.
 */
export class SetModifiersCommand implements SerializableCommand {
  readonly commandType = 'SetModifiers';

  constructor(
    private effectEngine: EffectEngine,
    private beforeModifiers: ModifierInstance[],
    private afterModifiers: ModifierInstance[],
    public description: string = 'Modifier Change',
  ) {}

  toPayload() {
    return { before: cloneModifiers(this.beforeModifiers), after: cloneModifiers(this.afterModifiers) };
  }

  execute() {
    // Clone on apply so the snapshot stays pristine for later undo/redo.
    this.effectEngine.setModifiers(cloneModifiers(this.afterModifiers));
  }

  undo() {
    this.effectEngine.setModifiers(cloneModifiers(this.beforeModifiers));
  }
}

// SetModifiers replay needs the live EffectEngine — registered in engine-store.ts
// to avoid circular dependencies.
