/**
 * Commands (ADR §5.8, D21).
 *
 * Every mutation goes through a command (undo/redo, persistence, live
 * collaboration). Extensions write state either with the typed core command
 * factory (`ctx.commands`) or by registering their own serializable commands,
 * namespaced `<extensionId>/<name>`. Extension commands SHOULD be composed
 * from core commands and MAY only touch state the extension owns.
 */
import type { FixtureId, Json, SceneNodeId, Vec2 } from './model';
import type { FixtureView } from './scopes';

/** An undoable operation. Mirrors the core `Command` interface. */
export interface Command {
  /** Human-readable description shown in history UI. */
  description: string;
  /** Apply the change. */
  execute(): void;
  /** Revert the change. */
  undo(): void;
  /**
   * Optional forward command that undoes this one. When present, undo is
   * persisted and synced to collaborators.
   */
  inverse?(): Command | null;
}

/** A command that can be persisted and replayed from a JSON payload. */
export interface SerializableCommand extends Command {
  /** Unique type key, e.g. `'neopixel-strip/reshape'`. */
  readonly commandType: string;
  /** Plain JSON payload from which `fromPayload` can recreate the command. */
  toPayload(): object;
}

/** Context available when replaying an extension command from its payload. */
export interface ExtensionReplayContext {
  /** Id of the extension that owns the command type. */
  extensionId: string;
  /** Looks up a fixture view by id. */
  getFixture(id: FixtureId): FixtureView | undefined;
  /** Core command constructors, for composing extension commands. */
  commands: CoreCommandFactory;
}

/** Registers a serializable command type owned by an extension. */
export interface CommandDefinition {
  /** `'<extensionId>/<name>'`; validated against the owning extension id. */
  type: `${string}/${string}`;
  /** Recreates the command from a persisted payload. */
  fromPayload(payload: unknown, ctx: ExtensionReplayContext): Command;
}

/** Who owns a piece of namespaced extension data. */
export type ExtensionDataOwner = 'fixture' | 'project' | 'liveWidget';

/** Arguments of `commands.setExtensionData`. */
export interface SetExtensionDataArgs {
  owner: ExtensionDataOwner;
  /** Id of the owner (ignored for `'project'`). */
  ownerId?: string | number;
  /** Writing extension (defaults to the calling extension when run via `ctx`). */
  extensionId?: string;
  key: string;
  /** JSON value; `undefined` deletes the key. */
  value: Json | undefined;
}

/** One channel write. */
export interface ChannelValueWrite {
  /** Index into the fixture's channel list. */
  channelIndex: number;
  /** DMX value 0–255. */
  value: number;
}

/** One channel output-range write (DMX 0–255; min/max are ordered by the host). */
export interface ChannelRangeWrite {
  fixtureId: FixtureId;
  channelIndex: number;
  min: number;
  max: number;
}

/**
 * Typed constructors of core commands available to extensions. The list is
 * part of the versioned API. Each call returns a `Command` that is executed
 * with `ctx.run(command)`.
 */
export interface CoreCommandFactory {
  /** Set programmed static values of channels of one fixture. */
  setChannelValues(args: { fixtureId: FixtureId; values: ChannelValueWrite[]; description?: string }): Command;
  /** Limit a channel's output range (DMX 0–255). */
  setChannelRange(args: ChannelRangeWrite): Command;
  /** Limit several channels' output ranges as one undo step. */
  setChannelRanges(args: { changes: ChannelRangeWrite[]; description?: string }): Command;
  /** Replace a kind fixture's config; rebuilds and stores `compiled`. Available from plan P5. */
  setFixtureKindConfig(args: { fixtureId: FixtureId; config: Json }): Command;
  /** Add a fixture from a kind or an OFL key at a normalized position. Available from plan P5. */
  addFixture(args: { kind?: { id: string; config?: Json }; ofl?: string; position: Vec2 }): Command;
  /** Write namespaced extension data. */
  setExtensionData(args: SetExtensionDataArgs): Command;
  /** Rename a scene node. */
  rename(args: { nodeId: SceneNodeId; name: string }): Command;
  /** Move fixtures to new normalized positions. */
  move(args: { moves: { fixtureId: FixtureId; position: Vec2 }[] }): Command;
  /** Rotate a fixture (degrees). */
  rotate(args: { fixtureId: FixtureId; rotation: number }): Command;
}
