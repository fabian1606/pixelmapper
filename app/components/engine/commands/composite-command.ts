/**
 * Composite command (ADR 0002 §4.3, plan A0.3).
 *
 * Groups several commands into one undo step: children execute in order and
 * undo in reverse. Used by the operations transaction runner (one `apply` =
 * one undo group, attributed to an actor) and by the extension API's
 * `commands.batch` (plan M4.4, `createBatchCommand`).
 *
 * Serialization: `{ label, actor, id, children: [{ commandType, payload }] }`.
 * Only serializable children are persisted; local-only children (e.g. a BPM
 * change, which persists itself as a live-op) are replayed by their own path.
 * Replayed children are created lazily, right before each executes, so a
 * child may refer to fixtures an earlier child of the same composite adds
 * (e.g. `AddFixtures` + `SetExtensionData` on the new fixtures).
 */
import type { Actor } from '@pixelmapper/agent-kit';
import type { Command } from '../composables/use-history';
import {
  commandFromPayload,
  isSerializable,
  registerCommand,
  type ReplayContext,
  type SerializableCommand,
} from './serializable-command';
import { newUuid } from '~/utils/ids';
import { collectFixtures } from '~/utils/engine/scene-tree';

// ── Payload ─────────────────────────────────────

/** One persisted child. */
export interface CompositeChildPayload {
  commandType: string;
  payload: object;
}

/** Persisted form of a composite. */
export interface CompositePayload {
  /** Group id (also the undo-group id in the event log). */
  id: string;
  label: string;
  actor: Actor;
  children: CompositeChildPayload[];
}

/** Command type key. */
export const COMPOSITE_COMMAND_TYPE = 'Composite';

// ── Command ─────────────────────────────────────

/** Ordered group of commands executed and undone as one step. */
export class CompositeCommand implements SerializableCommand {
  readonly commandType = COMPOSITE_COMMAND_TYPE;
  /** Undo-group id. */
  readonly id: string;
  /** Children in execution order (read-only after construction). */
  readonly children: readonly Command[];

  constructor(
    children: readonly Command[],
    public description: string,
    public readonly actor: Actor = 'user',
    id: string = newUuid(),
  ) {
    this.children = [...children];
    this.id = id;
  }

  /** Undo label (alias of `description`). */
  get label(): string {
    return this.description;
  }

  /**
   * Executes all children in order. If a child throws, the already executed
   * children are undone (in reverse) and the error is rethrown, so the
   * composite is atomic.
   */
  execute() {
    const done: Command[] = [];
    try {
      for (const child of this.children) {
        child.execute();
        done.push(child);
      }
    }
    catch (err) {
      for (const child of done.reverse()) {
        try { child.undo(); }
        catch (undoErr) { console.error('[composite] rollback failed:', undoErr); }
      }
      throw err;
    }
  }

  /** Undoes all children in reverse order. */
  undo() {
    for (let i = this.children.length - 1; i >= 0; i--) this.children[i]!.undo();
  }

  /**
   * Persistable inverse: the inverses of all children that provide one, in
   * reverse order. Children without `inverse()` are not persisted on undo —
   * the same behavior they have outside a composite. `null` when no child
   * has an inverse.
   */
  inverse(): Command | null {
    const inverses: Command[] = [];
    for (let i = this.children.length - 1; i >= 0; i--) {
      const inv = this.children[i]!.inverse?.();
      if (inv) inverses.push(inv);
    }
    if (inverses.length === 0) return null;
    return new CompositeCommand(inverses, `Undo ${this.description}`, this.actor);
  }

  toPayload(): CompositePayload {
    return {
      id: this.id,
      label: this.description,
      actor: this.actor,
      children: this.children.filter(isSerializable).map(c => ({ commandType: c.commandType, payload: c.toPayload() })),
    };
  }
}

// ── Batch (extension API) ───────────────────────

/**
 * `commands.batch` of the extension API (plan M4.4): several commands as ONE
 * history entry, persisted and synced as one `Composite` change.
 */
export function createBatchCommand(commands: readonly Command[], description = 'Batch'): CompositeCommand {
  return new CompositeCommand(commands, description);
}

// ── Replay ──────────────────────────────────────

/**
 * A replayed child: built from its payload against the current tree on its
 * first execute (fresh fixture list, so it sees fixtures added by earlier
 * children). Keeps its payload, so a replayed composite serializes unchanged.
 */
class LazyReplayedChild implements SerializableCommand {
  readonly description: string;
  /** Built command; `undefined` = not built yet, `null` = no registered factory. */
  private built: Command | null | undefined;

  constructor(
    readonly commandType: string,
    private readonly payload: object,
    private readonly ctx: ReplayContext,
  ) {
    this.description = commandType;
  }

  /** The real command, created on first use. */
  private command(): Command | null {
    if (this.built === undefined) {
      const ctx: ReplayContext = { ...this.ctx, flatFixtures: collectFixtures(this.ctx.sceneNodes) };
      this.built = commandFromPayload(this.commandType, this.payload, ctx);
      if (!this.built) console.warn(`[composite] unknown child command type "${this.commandType}" skipped`);
    }
    return this.built;
  }

  execute() { this.command()?.execute(); }
  undo() { this.built?.undo(); }
  inverse(): Command | null { return this.command()?.inverse?.() ?? null; }
  toPayload(): object { return this.payload; }
}

// Children are rebuilt through the same registry, so live collaboration and
// WAL replay handle composites of any registered command type. Unknown child
// types are skipped with a warning (same as an unknown top-level command).
registerCommand(COMPOSITE_COMMAND_TYPE, (payload: CompositePayload, ctx) => {
  const children = (payload.children ?? []).map(child => new LazyReplayedChild(child.commandType, child.payload, ctx));
  return new CompositeCommand(children, payload.label ?? 'Composite', payload.actor ?? 'user', payload.id ?? newUuid());
});
