/**
 * Core SDK types: frame/sample/out views, params and the `Modifier` base
 * class plus registration (ADR §6.6). Re-exported by `index.ts`.
 */

// ── Buffer layouts (ABI v1) ─────────────────────

/** f32 slots per frame context. */
export const CTX_FIELDS: i32 = 16;
/** f32 slots per sample. */
export const SAMPLE_FIELDS: i32 = 16;

/**
 * Per-render-call context (one modifier instance, one frame).
 * Layout (f32): timeMs, beatTime, bpm, phaseSpeed, arity, seedLo, seedHi,
 * strength, reserved[8].
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
}

/**
 * One sample = one target (a channel for `scalar`, a head for `rgb`/`panTilt`).
 * Layout (f32): x, y, phase, groupIndex, groupCount, headIndex, headCount,
 * seed, base0, base1, base2, channelSeedLo, channelSeedHi, reserved[3].
 */
export class Sample {
  /** Address of the sample (set by the SDK). */
  ptr: usize = 0;

  /** Normalized world x (0–1). */
  @inline get x(): f32 { return load<f32>(this.ptr, 0); }
  /** Normalized world y (0–1). */
  @inline get y(): f32 { return load<f32>(this.ptr, 4); }
  /** Phase in cycles (1.0 = one full cycle): speed phase + spatial offset. */
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
 * `color` = 3, `point` = 2, `curve` = 128 (LUT).
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
