import { ref, computed } from 'vue';
import { isSerializable } from '../commands/serializable-command';

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
const MAX_SIZE = 100;
const SNAPSHOT_INTERVAL = 20;

const past = ref<Command[]>([]);
const future = ref<Command[]>([]);
const version = ref(0);
const commandsSinceSnapshot = ref(0);

/**
 * Called by the persistence layer (engine-store) to inject push/snapshot hooks.
 * Kept as a plain ref so the store can set them after initialization without
 * creating circular import chains.
 */
const persistenceHooks = {
  pushChange: null as ((commandType: string, payload: object) => Promise<void>) | null,
  saveSnapshot: null as (() => Promise<void>) | null,
};

export function setPersistenceHooks(hooks: typeof persistenceHooks) {
  persistenceHooks.pushChange = hooks.pushChange;
  persistenceHooks.saveSnapshot = hooks.saveSnapshot;
}

/**
 * Global undo/redo history stack (singleton).
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

    // Persist to Supabase if hooks are wired up and command is serializable
    if (isSerializable(command) && persistenceHooks.pushChange) {
      const payload = command.toPayload();
      persistenceHooks.pushChange(command.commandType, payload).then(() => {
        commandsSinceSnapshot.value++;
        if (commandsSinceSnapshot.value >= SNAPSHOT_INTERVAL && persistenceHooks.saveSnapshot) {
          commandsSinceSnapshot.value = 0;
          persistenceHooks.saveSnapshot();
        }
      }).catch(err => {
        console.warn('[history] persist failed:', err);
      });
    }
  }

  function undo() {
    const command = past.value.pop();
    if (!command) return;
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
