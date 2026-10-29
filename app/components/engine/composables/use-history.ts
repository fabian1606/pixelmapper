import { ref, computed } from 'vue';
import { isSerializable, type SerializableCommand } from '../commands/serializable-command';
import { newUuid } from '~/utils/ids';
import { logEvent, type Actor } from '~/utils/observability/event-log';

export interface Command {
  description: string;
  execute(): void;
  undo(): void;
  /** Optional: returns a new forward command that, when executed, will undo this one.
   *  When present, undo() pushes this inverse to the DB so the change persists
   *  across reloads and syncs to other clients. */
  inverse?(): Command | null;
}

/** Options of `useHistory().execute`. */
export interface ExecuteOptions {
  /** Who caused the change (event log attribution). Default: the command's own `actor`, else `user`. */
  actor?: Actor;
  /**
   * The command's effect is already in the state (transaction runners that
   * executed the children incrementally): only record, log and persist it.
   */
  applied?: boolean;
}

// ─── Event log ───────────────────────────────────────────────────────────────

/** Actor of an executed command: explicit option, the command's own `actor` field, or `user`. */
function actorOf(command: Command, explicit?: Actor): Actor {
  return explicit ?? (command as { actor?: Actor }).actor ?? 'user';
}

/** Logs a history step (`command.execute` / `.undo` / `.redo`) to the event log. */
function logCommand(step: 'execute' | 'undo' | 'redo' | 'remote', command: Command, actor: Actor) {
  try {
    const groupId = (command as { id?: unknown }).id;
    logEvent({
      actor,
      kind: `command.${step}`,
      code: isSerializable(command) ? command.commandType : 'local',
      message: command.description,
      undoGroupId: typeof groupId === 'string' ? groupId : undefined,
    });
  }
  catch (err) {
    console.warn('[history] event log failed:', err);
  }
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
  /** Persist a single command. `changeId` is the client-generated idempotency key
   *  (UUID); the persist queue appends it to the outbox before sending it. */
  pushChange: null as ((commandType: string, payload: object, changeId: string) => Promise<number | undefined>) | null,
  saveSnapshot: null as (() => Promise<void>) | null,
  /** Called after any local mutation that may need to land in a snapshot. */
  markDirty: null as (() => void) | null,
  /** Called for every persisted command (requires bookkeeping, ADR §5.8). */
  onPersist: null as ((commandType: string, payload: object) => void) | null,
};

export function setPersistenceHooks(hooks: {
  pushChange: (commandType: string, payload: object, changeId: string) => Promise<number | undefined>;
  saveSnapshot: () => Promise<void>;
  markDirty?: () => void;
  onPersist?: (commandType: string, payload: object) => void;
}) {
  persistenceHooks.pushChange = hooks.pushChange;
  persistenceHooks.saveSnapshot = hooks.saveSnapshot;
  persistenceHooks.markDirty = hooks.markDirty ?? null;
  persistenceHooks.onPersist = hooks.onPersist ?? null;
}

/**
 * Drop the undo/redo stacks (project switch / close, and after a sync
 * rebase). The stored commands capture before/after states of the old live
 * state; undoing or redoing them after a rebase that merged a peer's edits
 * would push those stale payloads and silently revert the peer's changes.
 */
export function clearHistory(): void {
  past.value = [];
  future.value = [];
  version.value++;
}

export function triggerSaveSnapshot() {
  persistenceHooks.saveSnapshot?.();
}

/**
 * Single point of truth for: (1) outbox write + server push (persist queue),
 * (2) snapshot-counter.
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
  const changeId = newUuid();

  // The persist queue appends the outbox row (durable) before any network
  // call; local apply stays synchronous.
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

  /** Executes (unless `opts.applied`) and records a command as one undo step. */
  function execute(command: Command, opts: ExecuteOptions = {}) {
    if (!opts.applied) command.execute();
    logCommand('execute', command, actorOf(command, opts.actor));
    past.value.push(command);
    if (past.value.length > MAX_SIZE) past.value.shift();
    future.value = [];
    version.value++;
    persistenceHooks.markDirty?.();

    if (isSerializable(command)) {
      persistOne(command.commandType, command.toPayload(), 'execute');
    }
  }

  /** Applies a command that came from a collaborator (already persisted). */
  function executeRemote(command: Command, opts: { actor?: Actor } = {}) {
    command.execute();
    logCommand('remote', command, opts.actor ?? 'collaborator:remote');
    past.value.push(command);
    if (past.value.length > MAX_SIZE) past.value.shift();
    future.value = [];
    version.value++;
    // No persistence — command came from Realtime, already in DB
  }

  /** Undoes the newest step; `opts.actor` = who undoes (default `user`). */
  function undo(opts: { actor?: Actor } = {}) {
    const command = past.value.pop();
    if (!command) return;
    command.undo();
    logCommand('undo', command, opts.actor ?? 'user');
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

  /** Redoes the newest undone step; `opts.actor` = who redoes (default `user`). */
  function redo(opts: { actor?: Actor } = {}) {
    const command = future.value.pop();
    if (!command) return;
    command.execute();
    logCommand('redo', command, opts.actor ?? 'user');
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
