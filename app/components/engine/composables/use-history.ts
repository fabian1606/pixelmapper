import { ref, computed } from 'vue';
import { isSerializable } from '../commands/serializable-command';

export interface Command {
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

export const lastSeenSequenceNumber = ref<number>(0);

const persistenceHooks = {
  pushChange: null as ((commandType: string, payload: object) => Promise<number | undefined>) | null,
  saveSnapshot: null as (() => Promise<void>) | null,
};

export function setPersistenceHooks(hooks: {
  pushChange: (commandType: string, payload: object) => Promise<number | undefined>;
  saveSnapshot: () => Promise<void>;
}) {
  persistenceHooks.pushChange = hooks.pushChange;
  persistenceHooks.saveSnapshot = hooks.saveSnapshot;
}

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

    if (isSerializable(command) && persistenceHooks.pushChange) {
      const payload = command.toPayload();
      persistenceHooks.pushChange(command.commandType, payload).then((seq) => {
        if (seq != null) lastSeenSequenceNumber.value = seq;
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

  function executeRemote(command: Command) {
    command.execute();
    past.value.push(command);
    if (past.value.length > MAX_SIZE) past.value.shift();
    future.value = [];
    version.value++;
    // No persistence — command came from Realtime, already in DB
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

  return { execute, executeRemote, undo, redo, canUndo, canRedo, lastDescription, version };
}

export type History = ReturnType<typeof useHistory>;
