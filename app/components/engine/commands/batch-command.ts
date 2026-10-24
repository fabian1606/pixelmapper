/**
 * Batch command (plan M4.4): several commands as ONE history entry.
 *
 * Children execute in order and undo in reverse. A batch whose children are
 * all serializable is itself serializable (`commandType: 'Batch'`), so it is
 * persisted, replayed on load and synced to collaborators as one change.
 * Replayed children are created lazily, right before each executes, so a
 * child may refer to fixtures an earlier child of the same batch adds.
 */
import type { Command } from '../composables/use-history';
import { collectFixtures } from '~/utils/engine/scene-tree';
import {
  type ReplayContext,
  type SerializableCommand,
  commandFromPayload,
  isSerializable,
  registerCommand,
} from './serializable-command';

/** One persisted child of a batch. */
export interface BatchEntryPayload {
  commandType: string;
  payload: object;
}

/** Payload of `Batch`. */
export interface BatchPayload {
  description: string;
  commands: BatchEntryPayload[];
}

/** Command type of persisted batches. */
export const BATCH_COMMAND_TYPE = 'Batch';

/**
 * Runs `count` steps; when step `i` throws, the steps before it are rolled
 * back (newest first) and the error is rethrown, so a batch applies fully or
 * not at all.
 */
function runAtomically(count: number, step: (i: number) => void, rollback: (i: number) => void): void {
  let done = 0;
  try {
    for (; done < count; done++) step(done);
  }
  catch (err) {
    for (let i = done - 1; i >= 0; i--) {
      try { rollback(i); }
      catch (rollbackErr) { console.error('[batch] rollback failed:', rollbackErr); }
    }
    throw err;
  }
}

/** A batch of already constructed commands (local, not persisted). */
export class BatchCommand implements Command {
  constructor(
    protected readonly children: readonly Command[],
    public description: string,
  ) {}

  execute() {
    runAtomically(this.children.length, i => this.children[i]!.execute(), i => this.children[i]!.undo());
  }

  undo() {
    const n = this.children.length;
    runAtomically(n, i => this.children[n - 1 - i]!.undo(), i => this.children[n - 1 - i]!.execute());
  }

  /** Inverse when every child has one: the inverses in reverse order. */
  inverse(): Command | null {
    const inverses: Command[] = [];
    for (const child of [...this.children].reverse()) {
      const inv = child.inverse?.();
      if (!inv) return null;
      inverses.push(inv);
    }
    return createBatchCommand(inverses, `Undo ${this.description}`);
  }
}

/** A batch of serializable commands: persisted and synced as one change. */
export class SerializableBatchCommand extends BatchCommand implements SerializableCommand {
  readonly commandType = BATCH_COMMAND_TYPE;

  constructor(children: readonly SerializableCommand[], description: string) {
    super(children, description);
  }

  toPayload(): BatchPayload {
    return {
      description: this.description,
      commands: (this.children as SerializableCommand[]).map(c => ({ commandType: c.commandType, payload: c.toPayload() })),
    };
  }
}

/**
 * Creates a batch. Serializable when every child is serializable; otherwise a
 * local batch (one undo step, not persisted — like any non-serializable
 * command).
 */
export function createBatchCommand(commands: readonly Command[], description = 'Batch'): BatchCommand {
  return commands.every(isSerializable)
    ? new SerializableBatchCommand(commands as SerializableCommand[], description)
    : new BatchCommand(commands, description);
}

/** A batch recreated from its payload; children are built on first execute. */
class ReplayedBatchCommand implements SerializableCommand {
  readonly commandType = BATCH_COMMAND_TYPE;
  readonly description: string;
  /** Children built so far (null = no registered factory, skipped). */
  private readonly built: (Command | null | undefined)[] = [];

  constructor(private readonly payload: BatchPayload, private readonly ctx: ReplayContext) {
    this.description = payload.description;
  }

  /** Child `i`, created against the current tree on first use. */
  private child(i: number): Command | null {
    if (this.built[i] === undefined) {
      const entry = this.payload.commands[i]!;
      // Fresh fixture list: earlier children may have added fixtures in place.
      const ctx: ReplayContext = { ...this.ctx, flatFixtures: collectFixtures(this.ctx.sceneNodes) };
      const cmd = commandFromPayload(entry.commandType, entry.payload, ctx);
      if (!cmd) console.warn(`[batch] no handler for "${entry.commandType}" — skipped`);
      this.built[i] = cmd;
    }
    return this.built[i] ?? null;
  }

  execute() {
    runAtomically(this.payload.commands.length, i => this.child(i)?.execute(), i => this.built[i]?.undo());
  }

  undo() {
    const n = this.payload.commands.length;
    runAtomically(n, i => this.built[n - 1 - i]?.undo(), i => this.built[n - 1 - i]?.execute());
  }

  toPayload(): BatchPayload {
    return this.payload;
  }
}

registerCommand(BATCH_COMMAND_TYPE, (payload, ctx) => new ReplayedBatchCommand(payload as BatchPayload, ctx));

/**
 * Command types inside a persisted change, batches expanded (for the
 * requirement checks of the open gate).
 */
export function flattenCommandTypes(commandType: string, payload: unknown): string[] {
  if (commandType !== BATCH_COMMAND_TYPE) return [commandType];
  const entries = (payload as Partial<BatchPayload> | null)?.commands;
  if (!Array.isArray(entries)) return [commandType];
  return [commandType, ...entries.flatMap(e => flattenCommandTypes(e.commandType, e.payload))];
}
