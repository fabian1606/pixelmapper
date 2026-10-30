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
import type { FixtureDefinitionKey } from './patch';

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
 * One fixture to add with `commands.addFixtures` (plan M4.1). Give exactly
 * one of `definition` or `kind`.
 */
export interface AddFixtureItem {
  /**
   * Definition to build the fixture from: an OFL key `'<manufacturer>/<fixture>'`
   * or a custom fixture `'custom/<id>'` (e.g. `RdmDefinitionMatch.key`).
   */
  definition?: FixtureDefinitionKey;
  /** A fixture kind instead of a definition. */
  kind?: { id: string; config?: Json };
  /** 0-based mode of `definition` (default 0; ignored for kinds). */
  modeIndex?: number;
  /**
   * Absolute 1-based DMX start address (universe = ⌊(startAddress − 1) / 512⌋ + 1).
   * Omitted: appended after the highest used address, like the add dialog.
   * Overlaps are allowed (the caller decides how to flag them).
   */
  startAddress?: number;
  /** Display name (default: the definition's / kind's name). */
  name?: string;
}

/**
 * Command returned by `commands.addFixtures`. The ids of the new fixtures are
 * known before the command runs, so further commands for them can be
 * composed into the same undo step with `commands.batch`.
 */
export interface AddFixturesCommand extends SerializableCommand {
  /** Ids of the fixtures this command adds, in item order. */
  readonly fixtureIds: readonly FixtureId[];
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
  /**
   * Add fixtures from definitions (OFL / custom) or kinds — the same add path
   * as the add-fixture dialog: placed at the centre with a diagonal cascade,
   * one undo step, and added to the selection when the command first runs.
   * Async because OFL definitions are loaded on demand; rejects when a
   * definition or mode does not exist, a kind is not installed or an address
   * is invalid. Available from API 1.3.
   *
   * To store extension data on the new fixtures in the same undo step,
   * batch it (`setExtensionData` resolves its fixture when it runs):
   *
   * @example
   * const add = await ctx.commands.addFixtures([
   *   { definition: match.key, modeIndex: match.modeByPersonality[personality], startAddress: 1 },
   * ]);
   * ctx.run(ctx.commands.batch([
   *   add,
   *   ...add.fixtureIds.map(id => ctx.commands.setExtensionData({ owner: 'fixture', ownerId: id, key: 'link', value: { uid } })),
   * ], 'Add devices'));
   */
  addFixtures(items: readonly AddFixtureItem[]): Promise<AddFixturesCommand>;
  /**
   * Set a fixture's absolute 1-based DMX start address (this also sets its
   * universe). Not guarded by `onBeforeFixtureChange`. Available from API 1.3.
   */
  setStartAddress(args: { fixtureId: FixtureId; startAddress: number }): Command;
  /**
   * Switch a fixture created from a definition (`FixtureView.source`) to
   * another mode of that definition. Rebuilds channels and heads; id, name,
   * position, address, group and extension data stay. Async because the
   * definition may have to be loaded; rejects for fixtures without a source
   * or unknown modes. Available from API 1.3.
   */
  setFixtureMode(args: { fixtureId: FixtureId; modeIndex: number }): Promise<Command>;
  /**
   * Combine commands into ONE undo step, executed in order and undone in
   * reverse; if one fails the earlier ones are rolled back. Persisted and
   * synced as one change when every command is serializable (all core
   * commands and registered extension commands are). Available from API 1.3.
   */
  batch(commands: readonly Command[], description?: string): Command;
  /** Write namespaced extension data. */
  setExtensionData(args: SetExtensionDataArgs): Command;
  /** Rename a scene node. */
  rename(args: { nodeId: SceneNodeId; name: string }): Command;
  /** Move fixtures to new normalized positions. */
  move(args: { moves: { fixtureId: FixtureId; position: Vec2 }[] }): Command;
  /** Rotate a fixture (degrees). */
  rotate(args: { fixtureId: FixtureId; rotation: number }): Command;
}
