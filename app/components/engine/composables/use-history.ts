import { ref, computed } from 'vue';

/**
 * A reversible operation. Implement this interface for any action that
 * should be undoable in the editor (e.g. moving fixtures, renaming, etc.)
 */
export interface Command {
  /** Human-readable label, shown e.g. in a future Edit menu */
  description: string;
  execute(): void;
  undo(): void;
}

/**
 * Generic undo/redo history stack.
 *
 * Usage:
 *   const history = useHistory();
 *   history.execute(new MoveFixtureCommand(...));  // records and runs
 *   history.undo();                                // step back
 *   history.redo();                                // step forward
 */
export function useHistory(maxSize = 100) {
  const past = ref<Command[]>([]);
  const future = ref<Command[]>([]);

  const canUndo = computed(() => past.value.length > 0);
  const canRedo = computed(() => future.value.length > 0);

  const lastDescription = computed(() => past.value.at(-1)?.description ?? null);

  /**
   * Execute a command and push it to the undo stack.
   * Clears the redo stack (branching history is discarded).
   */
  function execute(command: Command) {
    command.execute();
    past.value.push(command);
    if (past.value.length > maxSize) past.value.shift();
    future.value = [];
  }

  function undo() {
    const command = past.value.pop();
    if (!command) return;
    command.undo();
    future.value.push(command);
  }

  function redo() {
    const command = future.value.pop();
    if (!command) return;
    command.execute();
    past.value.push(command);
  }

  return { execute, undo, redo, canUndo, canRedo, lastDescription };
}

export type History = ReturnType<typeof useHistory>;
