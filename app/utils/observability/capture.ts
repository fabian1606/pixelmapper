/**
 * `live` observations (ADR 0002 §6, plan M2): captures the real output of
 * the running engine over a window.
 *
 * Per target fixture one `signature` live target is subscribed through the
 * live hub (the worker reads the tuples after each render, first head of the
 * fixture). When a tuple is unavailable the value is decoded from the DMX
 * frame instead (coarse bytes of the signature's channels, before range
 * remap is not recoverable, so this is the wire value / 255). Frames arrive
 * at the engine's rate; they are resampled onto the requested fps grid
 * (sample-and-hold of the latest frame at each grid time).
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

/** Recorded frame: relative time (s) and one tuple per fixture. */
interface Recorded {
  t: number;
  tuples: (ArrayLike<number> | null)[];
}

// ── Capture ─────────────────────────────────────

/** Captures `durationS` of live output. */
export async function captureLive(input: CaptureInput, hub: CaptureHub): Promise<Trace> {
  const arity = COMPONENTS[input.signature].length;
  const now = input.now ?? (() => performance.now());
  const wait = input.wait ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  const notes: string[] = [];

  // Latest signature tuple per fixture (filled by the hub listeners).
  const latest: (Float32Array | null)[] = input.fixtures.map(() => null);
  const addresses = input.fixtures.map(f => componentAddresses(f, input.signature));
  const unsubs = input.fixtures.map((f, i) => hub.subscribe(
    { kind: 'signature', fixtureId: f.id, signature: input.signature },
    (v) => { latest[i] = v instanceof Float32Array ? v : null; },
  ));

  const recorded: Recorded[] = [];
  let fallbackUsed = false;
  const start = now();
  const onFrame = (frame: LiveFrame) => {
    const tuples = input.fixtures.map((_, i) => {
      const sig = latest[i];
      if (sig && sig.length >= arity) return sig.slice(0, arity);
      const addr = addresses[i];
      if (!addr) return null;
      fallbackUsed = true;
      return addr.map(a => (frame.dmx[a] ?? 0) / 255);
    });
    recorded.push({ t: (now() - start) / 1000, tuples });
  };
  const disposeFrames = hub.addFrameCallback(onFrame);

  try {
    await wait(input.durationS * 1000);
  }
  finally {
    disposeFrames();
    for (const u of unsubs) u();
  }

  // Resample onto the fps grid (sample-and-hold).
  const frames = recorded.length > 0 ? Math.max(1, Math.round(input.durationS * input.fps)) : 0;
  const times = new Float64Array(frames);
  const values = input.fixtures.map(() => new Float32Array(frames * arity).fill(Number.NaN));
  let k = 0;
  for (let f = 0; f < frames; f++) {
    const t = f / input.fps;
    times[f] = t;
    while (k + 1 < recorded.length && recorded[k + 1]!.t <= t) k++;
    const rec = recorded[k]!;
    rec.tuples.forEach((tuple, s) => {
      if (!tuple) return;
      for (let c = 0; c < arity; c++) values[s]![f * arity + c] = tuple[c]!;
    });
  }

  if (recorded.length === 0) notes.push('no engine frames arrived during the window (engine stopped or output paused?)');
  if (fallbackUsed) notes.push('some values were decoded from the DMX output (wire values after range remap)');
  const missing = input.fixtures.filter((_, i) => !addresses[i]).length;
  if (missing > 0) notes.push(`${missing} fixture(s) lack ${input.signature} channels`);

  // Fixtures that never produced a value (no signature, no channels) are dropped.
  const keep = input.fixtures.map((_, s) => frames === 0 ? !!addresses[s] : values[s]!.some(v => !Number.isNaN(v)));
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
    signature: input.signature,
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
}
