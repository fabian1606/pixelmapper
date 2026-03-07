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

// ─── Module-level singleton state ────────────────────────────────────────────
// Defined once at module scope so ALL callers of useHistory() share the
// same stack — regardless of which component or composable calls it.
const MAX_SIZE = 100;
const past = ref<Command[]>([]);
const future = ref<Command[]>([]);
const version = ref(0);

/**
 * Global undo/redo history stack (singleton).
 *
 * All components and composables that call useHistory() share the same past/future
 * arrays. This means MoveFixtureCommand recorded inside FixtureEditor and
 * GroupNodesCommand recorded inside index.vue all live in the same timeline.
 *
 * Usage:
 *   const history = useHistory();
 *   history.execute(new MoveFixtureCommand(...));  // records and runs
 *   history.undo();                                // step back
 *   history.redo();                                // step forward
 */
export function useHistory() {
  const canUndo = computed(() => past.value.length > 0);
  const canRedo = computed(() => future.value.length > 0);
  const lastDescription = computed(() => past.value.at(-1)?.description ?? null);

  function execute(command: Command) {
    command.execute();
    past.value.push(command);
    if (past.value.length > MAX_SIZE) past.value.shift();
    future.value = [];
    version.value++;
  }

  function undo() {
    const command = past.value.pop();
    if (!command) {
      return;
    }
    command.undo();
    future.value.push(command);
    version.value++;
  }

  function redo() {
    const command = future.value.pop();
    if (!command) return;
    command.execute();
    past.value.push(command);
    version.value++;
  }

  return { execute, undo, redo, canUndo, canRedo, lastDescription, version };
}

export type History = ReturnType<typeof useHistory>;
