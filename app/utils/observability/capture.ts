/**
 * `live` observations (ADR 0002 §6, plan M2): captures the real output of
 * the running engine over a window.
 *
 * Per target fixture one `signature` live target is subscribed through the
 * live hub (the worker reads the tuples after each render, first head of the
 * fixture). When a tuple is unavailable the value is decoded from the DMX
 * frame instead (coarse bytes of the signature's channels, before range
 * remap is not recoverable, so this is the wire value / 255). Frames arrive
 * at the engine's rate and in bursts: they are placed on the engine's own
 * timeline (`LiveFrame.timeMs`) and linearly resampled onto the requested
 * fps grid, so main-thread arrival jitter does not distort periods.
 * Several signatures can be captured in one window (`captureLiveSignatures`).
 */
import type { LiveFrame, LiveTarget } from '@pixelmapper/extension-api';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { ChannelType, Signature } from '~/utils/engine/types';
import type { FrameCallback, LiveListener } from '~/utils/extensions/live-hub';
import type { Trace, TraceSample } from './types';

// ── Inputs ──────────────────────────────────────

/** The live-hub surface the capture needs (injectable for tests). */
export interface CaptureHub {
  subscribe(target: LiveTarget, listener: LiveListener): () => void;
  addFrameCallback(cb: FrameCallback, targets?: LiveTarget[]): () => void;
}

/** One live capture. */
export interface CaptureInput {
  fixtures: readonly Fixture[];
  signature: Signature;
  durationS: number;
  fps: number;
  bpm: number;
  /** Group ids of a fixture (innermost first). */
  groupIds(f: Fixture): Array<string | number>;
  /** Waits `ms` (default `setTimeout`); tests drive frames meanwhile. */
  wait?: (ms: number) => Promise<void>;
  /** Wall clock in ms (default `performance.now`). */
  now?: () => number;
}

/** Channel types per signature component. */
const COMPONENTS: Record<Signature, ChannelType[]> = {
  scalar: ['DIMMER'],
  rgb: ['RED', 'GREEN', 'BLUE'],
  panTilt: ['PAN', 'TILT'],
};

/** Absolute 0-based DMX indices of a fixture's signature components (first head), or null. */
export function componentAddresses(f: Fixture, signature: Signature): number[] | null {
  const coarse = f.channels.filter(c => !c.isFine);
  const firstBeam = coarse.find(c => c.beamId !== undefined)?.beamId;
  const onHead = coarse.filter(c => c.beamId === firstBeam);
  const out: number[] = [];
  for (const type of COMPONENTS[signature]) {
    const ch = onHead.find(c => c.type === type) ?? (signature === 'scalar' ? onHead[0] : undefined);
    if (!ch) return null;
    out.push(f.startAddress - 1 + ch.addressOffset);
  }
  return out;
}

/** Recorded frame: wall / engine time (s) and, per signature, one tuple per fixture. */
interface Recorded {
  /** Wall-clock time since the capture start (s). */
  wall: number;
  /** Engine time of the frame (`LiveFrame.timeMs` in s), NaN when unknown. */
  engine: number;
  tuples: (ArrayLike<number> | null)[][];
}

// ── Timeline ────────────────────────────────────

/**
 * Frame times (s, relative to the first frame) of a recording.
 *
 * The engine time of each frame (`LiveFrame.timeMs`) is preferred: frames
 * reach the main thread in bursts, so the wall clock at arrival jitters by
 * a frame or more, while the engine time is when the frame was rendered.
 * The wall clock is the fallback when the engine time is missing, not
 * strictly increasing, or disagrees with the wall-clock span (clock reset).
 */
export function frameTimes(recorded: readonly { wall: number; engine: number }[]): { times: number[]; source: 'engine' | 'wall' } {
  const w0 = recorded[0]?.wall ?? 0;
  const wall = recorded.map(r => r.wall - w0);
  if (recorded.length < 2) return { times: wall, source: 'wall' };
  const e0 = recorded[0]!.engine;
  const engine = recorded.map(r => r.engine - e0);
  const increasing = engine.every((t, i) => Number.isFinite(t) && (i === 0 || t > engine[i - 1]!));
  const wallSpan = wall[wall.length - 1]!;
  const engineSpan = engine[engine.length - 1]!;
  const consistent = wallSpan <= 0 || Math.abs(engineSpan - wallSpan) <= 0.25 * wallSpan + 0.1;
  return increasing && consistent ? { times: engine, source: 'engine' } : { times: wall, source: 'wall' };
}

/**
 * Resamples recorded tuples onto a regular grid of `frames` frames at
 * `fps`: linear interpolation between the neighbouring recorded frames,
 * held before the first and after the last one. Returns one
 * `frames × arity` array per sample (NaN = unavailable).
 */
export function resampleTuples(
  times: readonly number[],
  tuples: readonly (readonly (ArrayLike<number> | null)[])[],
  samples: number,
  arity: number,
  frames: number,
  fps: number,
): Float32Array[] {
  const values = Array.from({ length: samples }, () => new Float32Array(frames * arity).fill(Number.NaN));
  let k = 0;
  for (let f = 0; f < frames; f++) {
    const t = f / fps;
    while (k + 1 < times.length && times[k + 1]! <= t) k++;
    const a = tuples[k];
    const b = k + 1 < tuples.length ? tuples[k + 1] : undefined;
    const span = b ? times[k + 1]! - times[k]! : 0;
    // Interpolation weight towards the next recorded frame (0 = hold).
    const u = b && span > 0 ? Math.max(0, Math.min(1, (t - times[k]!) / span)) : 0;
    for (let s = 0; s < samples; s++) {
      const va = a?.[s];
      if (!va) continue;
      const vb = b?.[s];
      for (let c = 0; c < arity; c++) {
        const x = va[c]!;
        values[s]![f * arity + c] = vb && u > 0 ? x + (vb[c]! - x) * u : x;
      }
    }
  }
  return values;
}

// ── Capture ─────────────────────────────────────

/** Captures `durationS` of live output in `input.signature`. */
export async function captureLive(input: CaptureInput, hub: CaptureHub): Promise<Trace> {
  const [trace] = await captureLiveSignatures(input, [input.signature], hub);
  return trace!;
}

/**
 * Captures `durationS` of live output in several signatures at once (one
 * window, one trace per signature, in the given order). Fixtures without
 * a signature's channels are dropped from that signature's trace.
 */
export async function captureLiveSignatures(input: CaptureInput, signatures: readonly Signature[], hub: CaptureHub): Promise<Trace[]> {
  const now = input.now ?? (() => performance.now());
  const wait = input.wait ?? (ms => new Promise<void>(r => setTimeout(r, ms)));

  // Latest tuple per signature and fixture (filled by the hub listeners).
  const latest = signatures.map(() => input.fixtures.map((): Float32Array | null => null));
  const addresses = signatures.map(sig => input.fixtures.map(f => componentAddresses(f, sig)));
  const unsubs = signatures.flatMap((sig, g) => input.fixtures.map((f, i) => hub.subscribe(
    { kind: 'signature', fixtureId: f.id, signature: sig },
    (v) => { latest[g]![i] = v instanceof Float32Array ? v : null; },
  )));

  const recorded: Recorded[] = [];
  const fallbackUsed = signatures.map(() => false);
  const start = now();
  const onFrame = (frame: LiveFrame) => {
    const tuples = signatures.map((sig, g) => {
      const arity = COMPONENTS[sig].length;
      return input.fixtures.map((_, i) => {
        const v = latest[g]![i];
        if (v && v.length >= arity) return v.slice(0, arity);
        // No tuple from the worker: decode the wire values.
        const addr = addresses[g]![i];
        if (!addr) return null;
        fallbackUsed[g] = true;
        return addr.map(a => (frame.dmx[a] ?? 0) / 255);
      });
    });
    const engine = typeof frame.timeMs === 'number' ? frame.timeMs / 1000 : Number.NaN;
    recorded.push({ wall: (now() - start) / 1000, engine, tuples });
  };
  const disposeFrames = hub.addFrameCallback(onFrame);

  try {
    await wait(input.durationS * 1000);
  }
  finally {
    disposeFrames();
    for (const u of unsubs) u();
  }

  // Resample onto the fps grid (linear between frames, on the engine timeline).
  const frames = recorded.length > 0 ? Math.max(1, Math.round(input.durationS * input.fps)) : 0;
  const times = Float64Array.from({ length: frames }, (_, f) => f / input.fps);
  const timeline = frameTimes(recorded);

  return signatures.map((signature, g): Trace => {
    const arity = COMPONENTS[signature].length;
    const notes: string[] = [];
    const values = resampleTuples(timeline.times, recorded.map(r => r.tuples[g]!), input.fixtures.length, arity, frames, input.fps);
    if (recorded.length === 0) notes.push('no engine frames arrived during the window (engine stopped or output paused?)');
    if (fallbackUsed[g]) notes.push('some values were decoded from the DMX output (wire values after range remap)');
    const missing = input.fixtures.filter((_, i) => !addresses[g]![i]).length;
    if (missing > 0) notes.push(`${missing} fixture(s) lack ${signature} channels`);

    // Fixtures that never produced a value (no signature, no channels) are dropped.
    const keep = input.fixtures.map((_, s) => frames === 0 ? !!addresses[g]![s] : values[s]!.some(v => !Number.isNaN(v)));
    const samples: TraceSample[] = input.fixtures.filter((_, s) => keep[s]).map(f => ({
      fixtureId: f.id,
      fixtureName: f.name,
      head: 0,
      headCount: 1,
      x: f.fixturePosition.x,
      y: f.fixturePosition.y,
      z: Number.isFinite(f.positionZ) ? f.positionZ : 0,
      groupIds: input.groupIds(f),
    }));
    return {
      mode: 'live',
      signature,
      arity,
      fps: input.fps,
      fromS: 0,
      durationS: input.durationS,
      bpm: input.bpm,
      times,
      samples,
      values: values.filter((_, s) => keep[s]),
      notes: notes.length > 0 ? notes : undefined,
    };
  });
}
