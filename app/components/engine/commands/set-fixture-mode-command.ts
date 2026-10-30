/**
 * Changes the definition mode of a fixture (plan M4.3).
 *
 * Swaps the mode-dependent parts of the fixture (channels, beams, source,
 * definition, lens) in place, so the fixture keeps its identity: id, name,
 * position, size, rotation, address, group membership and extension data
 * (links of connectors) stay. Building the new mode needs the definition
 * (async for OFL fixtures), see `buildSetFixtureModeCommand` in
 * `app/utils/fixture-definitions/fixture-mode.ts`; the command itself is
 * synchronous and replays from its payload without the definition.
 */
import type { Fixture, FixtureSource } from '~/utils/engine/core/fixture';
import type { Channel } from '~/utils/engine/core/channel';
import type { SceneNode } from '~/utils/engine/core/group';
import { Beam } from '~/utils/engine/core/beam';
import type { OflFixture } from '~/utils/ofl/types';
import { findFixtureInTree } from '~/utils/engine/scene-tree';
import {
  deserializeChannel,
  serializeBeam,
  serializeChannel,
  type SerializedBeam,
  type SerializedChannel,
} from '~/utils/engine/serialize';
import { type SerializableCommand, registerCommand } from './serializable-command';

/** The mode-dependent state of a fixture. */
export interface FixtureModeState {
  channels: Channel[];
  beams: Beam[];
  source?: FixtureSource;
  /** In-session definition (not persisted). */
  definition?: OflFixture;
  lensDegreesMinMax?: [number, number];
}

/** Persisted form of `FixtureModeState`. */
export interface SerializedFixtureModeState {
  channels: SerializedChannel[];
  beams: SerializedBeam[];
  source?: FixtureSource;
  lensDegreesMinMax?: [number, number];
}

/** Payload of `SetFixtureMode`. */
export interface SetFixtureModePayload {
  fixtureId: string | number;
  before: SerializedFixtureModeState;
  after: SerializedFixtureModeState;
  description?: string;
}

/** Captures the current mode state of a fixture (by reference). */
export function captureModeState(fixture: Fixture): FixtureModeState {
  return {
    channels: fixture.channels,
    beams: fixture.beams,
    source: fixture.source ? { ...fixture.source } : undefined,
    definition: fixture.definition,
    lensDegreesMinMax: fixture.lensDegreesMinMax,
  };
}

/** Serializes a mode state for the payload. */
function serializeModeState(state: FixtureModeState): SerializedFixtureModeState {
  return {
    channels: state.channels.map(serializeChannel),
    beams: state.beams.map(serializeBeam),
    source: state.source ? { ...state.source } : undefined,
    lensDegreesMinMax: state.lensDegreesMinMax ? [...state.lensDegreesMinMax] : undefined,
  };
}

/** Recreates a mode state from its payload (no definition). */
function deserializeModeState(data: SerializedFixtureModeState): FixtureModeState {
  return {
    channels: data.channels.map(deserializeChannel),
    beams: data.beams.map(b => new Beam(b.id, b.localX, b.localY, b.localZ ?? 0)),
    source: data.source ? { ...data.source } : undefined,
    lensDegreesMinMax: data.lensDegreesMinMax ? [...data.lensDegreesMinMax] : undefined,
  };
}

/** Undoable, serializable mode change of one fixture. */
export class SetFixtureModeCommand implements SerializableCommand {
  readonly commandType = 'SetFixtureMode';
  readonly description: string;

  /**
   * @param sceneNodes Live root node array; the fixture is looked up by id on
   *   every execute/undo, so the command also works after replays.
   */
  constructor(
    private readonly sceneNodes: readonly SceneNode[],
    readonly fixtureId: string | number,
    private readonly before: FixtureModeState,
    private readonly after: FixtureModeState,
    description = 'Change Fixture Mode',
  ) {
    this.description = description;
  }

  execute() { this.apply(this.after); }
  undo() { this.apply(this.before); }

  toPayload(): SetFixtureModePayload {
    return {
      fixtureId: this.fixtureId,
      before: serializeModeState(this.before),
      after: serializeModeState(this.after),
      description: this.description,
    };
  }

  /** Writes a mode state onto the fixture (missing fixture: no-op). */
  private apply(state: FixtureModeState) {
    const fixture = findFixtureInTree(this.sceneNodes, this.fixtureId);
    if (!fixture) return;
    fixture.channels = state.channels;
    fixture.beams = state.beams;
    fixture.source = state.source ? { ...state.source } : undefined;
    fixture.definition = state.definition;
    fixture.lensDegreesMinMax = state.lensDegreesMinMax;
    fixture.invalidatePhotometry();
  }
}

registerCommand('SetFixtureMode', (payload, ctx) => {
  const p = payload as SetFixtureModePayload;
  return new SetFixtureModeCommand(
    ctx.sceneNodes,
    p.fixtureId,
    deserializeModeState(p.before),
    deserializeModeState(p.after),
    p.description,
  );
});
