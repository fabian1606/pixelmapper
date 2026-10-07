/**
 * Fixture kinds (ADR §5.6, D15).
 *
 * A kind compiles its config into the canonical fixture model: channels,
 * beams, body primitives and handles. The core renders bodies generically in
 * 2D and 3D; there are no custom renderers. Curves are sampled inside
 * `build()`; the core never knows about curve types.
 */
import type { Component } from 'vue';
import type { ChannelRole, ChannelType, Rect, Vec2 } from './model';
import type { ParamSchema } from './params';

/** Context passed to pure kind functions. */
export interface KindBuildContext {
  /** World pixels per physical meter (core constant `PIXELS_PER_METER`). */
  pixelsPerMeter: number;
  /** World size in pixels. */
  worldWidth: number;
  worldHeight: number;
  /** Id of the fixture being built (stable across rebuilds). */
  fixtureId: string;
}

/** Canonical channel definition, same as OFL-derived fixtures. */
export interface ChannelDef {
  type: ChannelType;
  role: ChannelRole;
  /** 0-based offset from the fixture start address. */
  addressOffset: number;
  /** Bytes: 1 = 8-bit, 2 = 16-bit, 3 = 24-bit. Default 1. */
  resolution?: 1 | 2 | 3;
  fineAddressOffsets?: number[];
  /** Peak hue (hex) for color/dimmer channels. */
  colorValue: string;
  /** Default DMX value 0–255. */
  defaultValue: number;
  /** Display name. */
  name?: string;
  /** Beam this channel controls. */
  beamId?: string;
}

/**
 * A beam/head. Positions are in world pixels relative to the fixture origin
 * (`fixture.position`); the core applies the fixture's position and rotation.
 */
export interface BeamDef {
  id: string;
  /** Center of the beam (relative world pixels). */
  pos: Vec2;
  /**
   * Physical emitters that share this beam's color, e.g. the LEDs of one
   * pixel group of a strip (relative world pixels). Drawn as dots in 2D/3D.
   * Default: one emitter at `pos`.
   */
  emitters?: Vec2[];
  /** Dot radius of the emitters in world pixels. Default 4. */
  emitterRadius?: number;
}

/** Stroke/fill of a body primitive. Colors SHOULD be theme tokens (CSS vars). */
export interface BodyStyle {
  stroke?: string;
  fill?: string;
  /** 0–1. */
  opacity?: number;
}

/** Geometry the core draws for a fixture (world pixels relative to the fixture origin). */
export type BodyPrimitive =
  | { type: 'polyline'; points: Vec2[]; closed?: boolean; width: number; style: BodyStyle }
  | { type: 'polygon'; points: Vec2[]; style: BodyStyle }
  | { type: 'circle'; center: Vec2; radius: number; style: BodyStyle }
  | { type: 'rect'; rect: Rect; radius?: number; style: BodyStyle }
  | { type: 'svg'; markup: string; headElementMap: Record<string, string>; rect: Rect };

/**
 * An editable control point (relative world pixels).
 *
 * `anchor` handles are active whenever the fixture is selected; all other
 * roles only in edit mode (second click on a selected fixture that has at
 * least one non-anchor handle).
 */
export interface Handle {
  id: string;
  pos: Vec2;
  role: 'vertex' | 'midpoint' | 'anchor' | 'rotate';
}

/** Output of `build()`. */
export interface KindBuildResult {
  channels: ChannelDef[];
  beams: BeamDef[];
  body: BodyPrimitive[];
  handles: Handle[];
  /** Bounds for selection/hit-testing (world pixels). */
  bounds: Rect;
}

/** A fixture kind contributed by an extension. */
export interface FixtureKindDefinition<Config = unknown> {
  /** Unique across all extensions, e.g. `'neopixel-strip'`. */
  id: string;
  /** Semver of the config format. */
  version: string;
  label: string;
  /** Lucide icon name (kebab-case). */
  icon: string;
  /** Human/AI-readable description. */
  description: string;
  /** Schema of the config (rendered by `ParamForm` unless `library.addForm`). */
  configSchema: ParamSchema;
  /** Default config for new fixtures. */
  defaults(): Config;
  /** Pure, synchronous compilation into the canonical model. */
  build(config: Config, ctx: KindBuildContext): KindBuildResult;
  /**
   * Pure handle-drag reducer. The core always passes the config from the
   * start of the drag and the current pointer position (relative world
   * pixels), so the result must not depend on previous move events.
   */
  onHandleMove?(config: Config, handleId: string, pos: Vec2, ctx: KindBuildContext): Config;
  /** Pure reducer for deleting a focused handle (Delete/Backspace); return the config unchanged to refuse. */
  onHandleDelete?(config: Config, handleId: string, ctx: KindBuildContext): Config;
  /** Upgrade a config persisted with an older `version`. */
  migrate?(config: unknown, fromVersion: string): Config;
  library: {
    /** Library grouping. */
    category: string;
    /** Custom add form; default is `ParamForm` from `configSchema`. */
    addForm?: Component;
  };
  /** Whether using this kind adds a project dependency. Default true. */
  requiredWhenUsed?: boolean;
  /**
   * Channels may cross DMX universe boundaries (e.g. pixel strips fed as one
   * buffer). Default false: auto-addressing starts a new universe instead.
   */
  spansUniverses?: boolean;
}

/** Identity helper for typing a fixture kind. */
export function defineFixtureKind<Config>(def: FixtureKindDefinition<Config>): FixtureKindDefinition<Config> {
  return def;
}
