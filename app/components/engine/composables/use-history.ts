import { ref, computed } from 'vue';
import { isSerializable, type SerializableCommand } from '../commands/serializable-command';

export interface Command {
  description: string;
  execute(): void;
  undo(): void;
  /** Optional: returns a new forward command that, when executed, will undo this one.
   *  When present, undo() pushes this inverse to the DB so the change persists
   *  across reloads and syncs to other clients. */
  inverse?(): Command | null;
}

// ─── Module-level singleton state ────────────────────────────────────────────
const MAX_SIZE = 100;
const SNAPSHOT_INTERVAL = 20;

const past = ref<Command[]>([]);
const future = ref<Command[]>([]);
const version = ref(0);
const commandsSinceSnapshot = ref(0);

export const lastSeenSequenceNumber = ref<number>(0);

export interface WalEntryForHooks {
  id: string;
  projectId: string;
  commandType: string;
  payload: unknown;
  enqueuedAt: number;
}

const persistenceHooks = {
  /** Persist a single command. `changeId` is the client-generated idempotency key
   *  (UUID) which must match the WAL entry written via `walAppend`. */
  pushChange: null as ((commandType: string, payload: object, changeId: string) => Promise<number | undefined>) | null,
  saveSnapshot: null as (() => Promise<void>) | null,
  /** Called after any local mutation that may need to land in a snapshot. */
  markDirty: null as (() => void) | null,
  /** Append a pending change to the IndexedDB WAL. Fire-and-forget — local
   *  apply does not block on the write, but the entry IS durable before any
   *  network call happens because the WAL write is queued first. */
  walAppend: null as ((entry: WalEntryForHooks) => Promise<void>) | null,
  /** Current project id — needed for WAL scoping. */
  currentProjectId: null as (() => string | null) | null,
  /** Called for every persisted command (requires bookkeeping, ADR §5.8). */
  onPersist: null as ((commandType: string, payload: object) => void) | null,
};

export function setPersistenceHooks(hooks: {
  pushChange: (commandType: string, payload: object, changeId: string) => Promise<number | undefined>;
  saveSnapshot: () => Promise<void>;
  markDirty?: () => void;
  walAppend?: (entry: WalEntryForHooks) => Promise<void>;
  currentProjectId?: () => string | null;
  onPersist?: (commandType: string, payload: object) => void;
}) {
  persistenceHooks.pushChange = hooks.pushChange;
  persistenceHooks.saveSnapshot = hooks.saveSnapshot;
  persistenceHooks.markDirty = hooks.markDirty ?? null;
  persistenceHooks.walAppend = hooks.walAppend ?? null;
  persistenceHooks.currentProjectId = hooks.currentProjectId ?? null;
  persistenceHooks.onPersist = hooks.onPersist ?? null;
}

export function triggerSaveSnapshot() {
  persistenceHooks.saveSnapshot?.();
}

/**
 * Single point of truth for: (1) WAL write, (2) server push, (3) snapshot-counter.
 * All four call sites (persistChange, execute, undo-inverse, redo) funnel through here.
 */
function persistOne(commandType: string, payload: object, label: string) {
  if (!persistenceHooks.pushChange) return;
  try {
    persistenceHooks.onPersist?.(commandType, payload);
  }
  catch (err) {
    console.warn(`[history] onPersist failed (${label}):`, err);
  }
  const changeId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // WAL FIRST — durable before any network call. The promise is not awaited so
  // local apply stays synchronous, but the IDB transaction is already queued.
  const projectId = persistenceHooks.currentProjectId?.() ?? '';
  if (projectId && persistenceHooks.walAppend) {
    persistenceHooks.walAppend({
      id: changeId,
      projectId,
      commandType,
      payload,
      enqueuedAt: Date.now(),
    }).catch(err => console.warn(`[history] WAL append failed (${label}):`, err));
  }

  persistenceHooks.pushChange(commandType, payload, changeId).then((seq) => {
    if (seq != null && seq > lastSeenSequenceNumber.value) lastSeenSequenceNumber.value = seq;
    commandsSinceSnapshot.value++;
    if (commandsSinceSnapshot.value >= SNAPSHOT_INTERVAL && persistenceHooks.saveSnapshot) {
      commandsSinceSnapshot.value = 0;
      persistenceHooks.saveSnapshot();
    }
  }).catch(err => console.warn(`[history] persist ${label} failed:`, err));
}

/**
 * Persist a change directly to the project_changes tail WITHOUT pushing it onto
 * the undo stack. For state transitions that must survive reload / sync to
 * collaborators but should not be reachable via Ctrl+Z (e.g. activating a
 * preset). Replayed on load via the registered command factory.
 */
export function persistChange(commandType: string, payload: object) {
  if (!persistenceHooks.pushChange) return;
  persistenceHooks.markDirty?.();
  persistOne(commandType, payload, 'persistChange');
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
    persistenceHooks.markDirty?.();

    if (isSerializable(command)) {
      persistOne(command.commandType, command.toPayload(), 'execute');
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
    persistenceHooks.markDirty?.();

    // Persist the undo by pushing an inverse forward-command to the DB so
    // (a) the change survives reload and (b) collaborators see the undo too.
    // Only commands that opt-in via inverse() participate; others stay local.
    if (command.inverse) {
      const inv = command.inverse();
      if (inv && isSerializable(inv)) {
        const sCmd = inv as SerializableCommand;
        persistOne(sCmd.commandType, sCmd.toPayload(), 'undo');
      }
    }
  }

  function redo() {
    const command = future.value.pop();
    if (!command) return;
    command.execute();
    past.value.push(command);
    version.value++;
    persistenceHooks.markDirty?.();

    if (isSerializable(command)) {
      persistOne(command.commandType, command.toPayload(), 'redo');
    }
  }

  return { execute, executeRemote, undo, redo, canUndo, canRedo, lastDescription, version };
}

export type History = ReturnType<typeof useHistory>;
