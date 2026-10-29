/**
 * Core SDK types: frame/sample/out views, params and the `Modifier` base
 * class plus registration (ADR §6.6). Re-exported by `index.ts`.
 */

// ── Buffer layouts (ABI v1 … v1.3) ──────────────

/** f32 slots per frame context (v1.3: 20; slot 19 reserved). */
export const CTX_FIELDS: i32 = 20;
/** f32 slots per sample (v1.3: 20; slot 19 reserved). */
export const SAMPLE_FIELDS: i32 = 20;

/**
 * Per-render-call context (one modifier instance, one frame).
 * Layout (f32): timeMs, beatTime, bpm, phaseSpeed, arity, seedLo, seedHi,
 * strength, timePhase, rankCount, distGroupCount (v1.1), spread and the
 * Spatial 2D handle origin x/y, end x/y (v1.2), worldAspect, worldDepth,
 * metersPerUnit, reserved (v1.3).
 *
 * Coordinates (v1.3): `Sample.x/y/z` are *world* coordinates — one unit on
 * every axis (a fraction of the stage width), so distances computed from
 * them are already isotropic. The *room* is the bounding box of all fixtures
 * in the layout; `Sample.u/v` place a sample inside it (0–1 per axis, each
 * axis normalized separately). Because u and v are stretched independently,
 * multiply u differences by `worldAspect` before measuring distances:
 * `dist = sqrt((du * worldAspect)² + dv²)` is in units of the room depth.
 * Heights join that space as `dz / worldDepth`.
 */
export class Frame {
  /** Address of the context buffer (set by the SDK). */
  ptr: usize = 0;

  /** Milliseconds since the shared clock epoch (same on every client). */
  @inline get timeMs(): f32 { return load<f32>(this.ptr, 0); }
  /** Beats since the clock epoch (piecewise integral of the BPM). */
  @inline get beatTime(): f32 { return load<f32>(this.ptr, 4); }
  /** Current tempo. */
  @inline get bpm(): f32 { return load<f32>(this.ptr, 8); }
  /** Instance speed in cycles per second (0 = frozen / infinite duration). */
  @inline get phaseSpeed(): f32 { return load<f32>(this.ptr, 12); }
  /** Components per sample: 1 (scalar), 3 (rgb), 2 (panTilt). */
  @inline get arity(): i32 { return <i32>load<f32>(this.ptr, 16); }
  /** Instance seed, low 16 bits. */
  @inline get seedLo(): u32 { return <u32>load<f32>(this.ptr, 20); }
  /** Instance seed, high 16 bits. */
  @inline get seedHi(): u32 { return <u32>load<f32>(this.ptr, 24); }
  /** Full 32-bit instance seed. */
  @inline get seed(): u32 { return (this.seedHi << 16) | this.seedLo; }
  /** Host-applied strength 0–1 (informational; the host blends the output). */
  @inline get strength(): f32 { return load<f32>(this.ptr, 28); }
  /** v1.1: speed phase in cycles (unwrapped; 1.0 = one pass). */
  @inline get timePhase(): f32 { return load<f32>(this.ptr, 32); }
  /** v1.1: number of distribution ranks (0 when the mode has none). */
  @inline get rankCount(): i32 { return <i32>load<f32>(this.ptr, 36); }
  /** v1.1: number of distribution groups (0 = no grouping). */
  @inline get distGroupCount(): i32 { return <i32>load<f32>(this.ptr, 40); }
  /** v1.2: the spread — `SPREAD_SAME`, `SPREAD_SPATIAL`, `SPREAD_ORDER` or `SPREAD_WITHIN`. */
  @inline get spread(): i32 { return <i32>load<f32>(this.ptr, 44); }
  /** v1.2: Spatial 2D handle origin x (normalized world, like `Sample.x`). */
  @inline get handleOriginX(): f32 { return load<f32>(this.ptr, 48); }
  /** v1.2: Spatial 2D handle origin y. */
  @inline get handleOriginY(): f32 { return load<f32>(this.ptr, 52); }
  /** v1.2: Spatial 2D handle end x. */
  @inline get handleEndX(): f32 { return load<f32>(this.ptr, 56); }
  /** v1.2: Spatial 2D handle end y. */
  @inline get handleEndY(): f32 { return load<f32>(this.ptr, 60); }
  /**
   * v1.3: room width / room depth (bounding box of all fixtures). Multiply a
   * `Sample.u` difference by this to compare it with a `Sample.v` difference
   * (`du * worldAspect` and `dv` are both in room-depth units). 1 for square
   * rooms, single rows and single fixtures.
   */
  @inline get worldAspect(): f32 { return load<f32>(this.ptr, 64); }
  /**
   * v1.3: room depth (y extent of the bounding box) in world units (> 0).
   * `dz / worldDepth` is comparable to a `Sample.v` difference.
   */
  @inline get worldDepth(): f32 { return load<f32>(this.ptr, 68); }
  /** v1.3: meters per world unit (e.g. 12: x = 0.5 is 6 m); 0 when unknown. */
  @inline get metersPerUnit(): f32 { return load<f32>(this.ptr, 72); }
}

/** v1.2 `Frame.spread`: every fixture the same (spatial 0). */
export const SPREAD_SAME: i32 = 0;
/** v1.2 `Frame.spread`: Spatial 2D (linear / radial / conical handle). */
export const SPREAD_SPATIAL: i32 = 1;
/** v1.2 `Frame.spread`: fixture by fixture (`Sample.rank` = number − 1). */
export const SPREAD_ORDER: i32 = 2;
/** v1.2 `Frame.spread`: within each fixture (`Sample.rank` = head). */
export const SPREAD_WITHIN: i32 = 3;

/**
 * One sample = one target (a channel for `scalar`, a head for `rgb`/`panTilt`).
 * Layout (f32): x, y, phase, groupIndex, groupCount, headIndex, headCount,
 * seed, base0, base1, base2, channelSeedLo, channelSeedHi, spatial, rank,
 * distGroup (v1.1), z, u, v, reserved (v1.3). See `Frame` for the coordinate
 * spaces.
 */
export class Sample {
  /** Address of the sample (set by the SDK). */
  ptr: usize = 0;

  /** Normalized world x (0–1 across the stage; same unit as y and z). */
  @inline get x(): f32 { return load<f32>(this.ptr, 0); }
  /** Normalized world y (0–1 across the stage; same unit as x and z). */
  @inline get y(): f32 { return load<f32>(this.ptr, 4); }
  /** Phase in cycles (1.0 = one full cycle): time phase − spatial (legacy; prefer `spatial`). */
  @inline get phase(): f32 { return load<f32>(this.ptr, 8); }
  /** Index of the fixture among the targeted fixtures. */
  @inline get groupIndex(): i32 { return <i32>load<f32>(this.ptr, 12); }
  /** Number of targeted fixtures. */
  @inline get groupCount(): i32 { return <i32>load<f32>(this.ptr, 16); }
  /** Index of the head within its fixture. */
  @inline get headIndex(): i32 { return <i32>load<f32>(this.ptr, 20); }
  /** Number of heads of the fixture. */
  @inline get headCount(): i32 { return <i32>load<f32>(this.ptr, 24); }
  /** Stable 24-bit seed of (fixture, head, instance). */
  @inline get seed(): u32 { return <u32>load<f32>(this.ptr, 28); }
  /** Current value of component 0 before this modifier (normalized 0–1). */
  @inline get base0(): f32 { return load<f32>(this.ptr, 32); }
  /** Current value of component 1 (rgb: green, panTilt: tilt). */
  @inline get base1(): f32 { return load<f32>(this.ptr, 36); }
  /** Current value of component 2 (rgb: blue). */
  @inline get base2(): f32 { return load<f32>(this.ptr, 40); }
  /** 32-bit seed of the channel type (scalar samples; 0 otherwise). */
  @inline get channelSeed(): u32 {
    return (<u32>load<f32>(this.ptr, 48) << 16) | <u32>load<f32>(this.ptr, 44);
  }
  /** v1.1: position along the distribution (0 at the origin / first rank, 1 at the end). */
  @inline get spatial(): f32 { return load<f32>(this.ptr, 52); }
  /** v1.1: rank of the sample in the distribution order (−1 if none). */
  @inline get rank(): i32 { return <i32>load<f32>(this.ptr, 56); }
  /** v1.1: distribution group of the sample (−1 without grouping). */
  @inline get distGroup(): i32 { return <i32>load<f32>(this.ptr, 60); }
  /**
   * v1.3: height above the floor in world units (same unit as x/y, so
   * `dist3(s.x, s.y, s.z, …, 1, 1)` is isotropic). 0 for fixtures on the floor
   * or when heights were never set.
   */
  @inline get z(): f32 { return load<f32>(this.ptr, 64); }
  /** v1.3: room x — 0 at the leftmost fixture, 1 at the rightmost (0.5 in a single column). */
  @inline get u(): f32 { return load<f32>(this.ptr, 68); }
  /** v1.3: room y — 0 at the frontmost (top) fixture, 1 at the backmost (0.5 in a single row). */
  @inline get v(): f32 { return load<f32>(this.ptr, 72); }
}

/** Output of one sample: `arity` values. */
export class Out {
  /** Address of the sample's output slots (set by the SDK). */
  ptr: usize = 0;

  /** Writes component `i`. */
  @inline set(i: i32, v: f32): void { store<f32>(this.ptr + (<usize>i << 2), v); }
  /** Writes component 0. */
  @inline setScalar(v: f32): void { store<f32>(this.ptr, v); }
  /** Writes an RGB triple. */
  @inline setRgb(r: f32, g: f32, b: f32): void {
    store<f32>(this.ptr, r);
    store<f32>(this.ptr, g, 4);
    store<f32>(this.ptr, b, 8);
  }
}

/**
 * The params block: the f32 slots of all params in manifest order (ADR §6.2).
 * `number`/`int`/`angle` = 1 slot, `bool` = 1 (0/1), `enum` = 1 (index),
 * `color` = 3, `point` = 2, `curve` = 128 (LUT), `gradient` = 33, `steps` = 18,
 * `trigger` = 4 (read with `triggerPressed` / `triggerMsSincePress` / …).
 */
export class Params {
  /** Address of the params block (set by the SDK). */
  ptr: usize = 0;
  /** Number of f32 slots. */
  count: i32 = 0;

  /** Slot `i` as f32 (0 when out of range). */
  @inline get(i: i32): f32 { return i < this.count ? load<f32>(this.ptr + (<usize>i << 2)) : 0; }
  /** Slot `i` as integer (enums, ints). */
  @inline int(i: i32): i32 { return <i32>Mathf.round(this.get(i)); }
  /** Slot `i` as boolean. */
  @inline bool(i: i32): bool { return this.get(i) >= 0.5; }
  /** Address of a curve LUT starting at slot `i` (128 values). */
  @inline lut(i: i32): usize { return this.ptr + (<usize>i << 2); }
}

/** Base class of a modifier. */
export abstract class Modifier {
  /** Current params (valid from the first `prepare`). */
  params: Params = new Params();

  /**
   * Called on load and whenever params change. MAY precompute lookup tables
   * (a cache, not state across frames).
   */
  prepare(params: Params): void {}

  /** Computes `out` for one sample. MUST be pure (no state across frames). */
  abstract render(ctx: Frame, s: Sample, out: Out): void;
}

// ── Registration ────────────────────────────────

/** The registered modifier (one per module). */
let current: Modifier | null = null;

/** Registers the module's modifier. Call once at top level. */
export function register(m: Modifier): Modifier {
  current = m;
  return m;
}

/** The registered modifier; aborts when none was registered. */
export function registered(): Modifier {
  const m = current;
  if (m === null) abort("no modifier registered: call register(new MyModifier())");
  return changetype<Modifier>(m);
}
