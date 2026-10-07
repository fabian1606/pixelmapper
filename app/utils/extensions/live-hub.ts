/**
 * Live-value hub (ADR §5.5, D22).
 *
 * Per-frame values are opt-in: components subscribe to targets, the hub
 * reference-counts subscriptions per target key and extracts only subscribed
 * targets from each rendered frame. With zero subscribers `ingest` returns
 * immediately and no extraction work happens.
 *
 * `channel`, `universe` and `beat` are extracted from the DMX frame on the
 * main thread. `signature` tuples (plan P3.15) come from the engine worker:
 * the hub reports the subscribed signature targets (`requestSignatures`),
 * the worker reads them after each render and the store passes them to
 * `ingest` tagged with the request generation, so stale tuples are dropped.
 */
import type { BeatInfo, FixtureId, LiveFrame, LiveTarget } from '@pixelmapper/extension-api';

/** Listener receiving one extracted value. */
export type LiveListener = (value: unknown) => void;

/** Callback receiving the whole (non-reactive) frame. */
export type FrameCallback = (frame: LiveFrame) => void;

/** Host-provided lookups. */
export interface LiveHubSources {
  /** Absolute 1-based DMX address of a channel's coarse byte, or `null`. */
  resolveChannelAddress(fixtureId: FixtureId, channelIndex: number): number | null;
  /** Current tempo and clock epoch (ms since Unix epoch). */
  beatSource(): { bpm: number; clockEpoch: number };
  /**
   * Asks the engine for these signature tuples from now on (empty = none).
   * `generation` must be echoed with the values (see `SignatureFrame`).
   */
  requestSignatures?(targets: SignatureTarget[], generation: number): void;
}

/** A `signature` live target. */
export type SignatureTarget = Extract<LiveTarget, { kind: 'signature' }>;

/** Signature tuples of one frame: 3 f32 per requested target (NaN = unavailable). */
export interface SignatureFrame {
  generation: number;
  values: Float32Array;
}

/** Stable key of a target (subscriptions with equal keys share extraction). */
export function targetKey(t: LiveTarget): string {
  switch (t.kind) {
    case 'channel': return `channel:${String(t.fixtureId)}:${t.channelIndex}`;
    case 'signature': return `signature:${String(t.fixtureId)}:${t.signature}`;
    case 'universe': return `universe:${t.universe}`;
    case 'beat': return 'beat';
  }
}

/**
 * Extraction functions. Exported as an object so tests can spy on them to
 * prove that no work happens without subscribers.
 */
export const extractors = {
  /** Beat clock from tempo + epoch (constant BPM since the epoch; P3.6 adds BPM history). */
  beat(nowMs: number, src: { bpm: number; clockEpoch: number }): BeatInfo {
    const beatTime = Math.max(0, ((nowMs - src.clockEpoch) * src.bpm) / 60000);
    return { beatTime, bpm: src.bpm, phase: beatTime - Math.floor(beatTime) };
  },
  /** Rendered coarse DMX value of a channel. */
  channel(dmx: Uint8Array, address: number | null): number | undefined {
    if (address === null || address < 1 || address > dmx.length) return undefined;
    return dmx[address - 1];
  },
  /** One universe (copy, so listeners may keep it). */
  universe(dmx: Uint8Array, universe: number): Uint8Array {
    const start = (universe - 1) * 512;
    const out = new Uint8Array(512);
    if (start >= 0 && start < dmx.length) out.set(dmx.subarray(start, Math.min(start + 512, dmx.length)));
    return out;
  },
};

/** One shared subscription per target key. */
interface Subscription {
  target: LiveTarget;
  listeners: Set<LiveListener>;
}

/** The hub. A single instance (`liveHub`) serves the app. */
export class LiveHub {
  private subs = new Map<string, Subscription>();
  private frameCallbacks = new Set<FrameCallback>();
  private sources: LiveHubSources | null = null;
  /** Latest frame, kept so new subscribers get a value immediately. */
  private last: { dmx: Uint8Array; timeMs: number } | null = null;
  /** Requested signature targets (request order) and their generation. */
  private signatureOrder: SignatureTarget[] = [];
  private signatureGeneration = 0;
  /** Latest tuple per signature target key. */
  private signatureValues = new Map<string, Float32Array>();

  /** Installs the host lookups (engine store). */
  configure(sources: LiveHubSources): void {
    this.sources = sources;
    this.updateSignatureRequests(true);
  }

  /** Re-sends the signature request (e.g. after a layout change). */
  refreshSignatureRequests(): void {
    this.updateSignatureRequests(true);
  }

  /** Recomputes the requested signature targets; notifies on change. */
  private updateSignatureRequests(force = false): void {
    const next = [...this.subs.values()].map(s => s.target).filter((t): t is SignatureTarget => t.kind === 'signature');
    const same = next.length === this.signatureOrder.length
      && next.every((t, i) => targetKey(t) === targetKey(this.signatureOrder[i]!));
    if (same && !force) return;
    this.signatureOrder = next;
    this.signatureGeneration++;
    for (const key of [...this.signatureValues.keys()]) {
      if (!next.some(t => targetKey(t) === key)) this.signatureValues.delete(key);
    }
    this.sources?.requestSignatures?.(next, this.signatureGeneration);
  }

  /** Current signature request generation (tests). */
  get signatureRequestGeneration(): number {
    return this.signatureGeneration;
  }

  /** Number of distinct subscribed targets (ref-counted). */
  get targetCount(): number {
    return this.subs.size;
  }

  /** Listener count of one target. */
  refCount(target: LiveTarget): number {
    return this.subs.get(targetKey(target))?.listeners.size ?? 0;
  }

  /** True when any value or frame consumer is active. */
  get active(): boolean {
    return this.subs.size > 0 || this.frameCallbacks.size > 0;
  }

  /**
   * Subscribes a listener to a target. Returns the unsubscribe function;
   * the target is dropped when its last listener leaves.
   */
  subscribe(target: LiveTarget, listener: LiveListener): () => void {
    const key = targetKey(target);
    let sub = this.subs.get(key);
    if (!sub) {
      sub = { target, listeners: new Set() };
      this.subs.set(key, sub);
    }
    sub.listeners.add(listener);
    if (target.kind === 'signature') this.updateSignatureRequests();
    if (this.last) listener(this.extract(target, this.last.dmx, Date.now()));

    return () => {
      const s = this.subs.get(key);
      if (!s) return;
      s.listeners.delete(listener);
      if (s.listeners.size === 0) {
        this.subs.delete(key);
        if (target.kind === 'signature') this.updateSignatureRequests();
      }
    };
  }

  /**
   * Registers a whole-frame callback. `targets` are subscribed for the
   * callback's lifetime (so their extraction stays warm). Returns a disposer.
   */
  addFrameCallback(cb: FrameCallback, targets: LiveTarget[] = []): () => void {
    this.frameCallbacks.add(cb);
    const unsubs = targets.map(t => this.subscribe(t, () => {}));
    return () => {
      this.frameCallbacks.delete(cb);
      for (const u of unsubs) u();
    };
  }

  /** Extracts one target from a frame. */
  private extract(target: LiveTarget, dmx: Uint8Array, nowMs: number): unknown {
    const src = this.sources;
    switch (target.kind) {
      case 'channel':
        return extractors.channel(dmx, src?.resolveChannelAddress(target.fixtureId, target.channelIndex) ?? null);
      case 'universe':
        return extractors.universe(dmx, target.universe);
      case 'beat':
        return src ? extractors.beat(nowMs, src.beatSource()) : undefined;
      case 'signature':
        return this.signatureValues.get(targetKey(target));
    }
  }

  /**
   * Feeds a rendered frame (called by the engine store per worker frame).
   * Returns immediately when nobody listens.
   */
  ingest(dmx: Uint8Array, timeMs: number, nowMs: number = Date.now(), signatures?: SignatureFrame): void {
    if (!this.active) {
      this.last = null;
      return;
    }
    this.last = { dmx, timeMs };
    if (signatures) this.ingestSignatures(signatures);

    for (const sub of this.subs.values()) {
      const value = this.extract(sub.target, dmx, nowMs);
      for (const l of sub.listeners) l(value);
    }

    if (this.frameCallbacks.size > 0) {
      const src = this.sources?.beatSource() ?? { bpm: 120, clockEpoch: nowMs };
      const frame: LiveFrame = { timeMs, beat: extractors.beat(nowMs, src), dmx };
      for (const cb of this.frameCallbacks) {
        try {
          cb(frame);
        }
        catch (err) {
          console.error('[live-hub] onFrame callback failed:', err);
        }
      }
    }
  }

  /** Stores the tuples of a frame (ignored when the request changed since). */
  private ingestSignatures({ generation, values }: SignatureFrame): void {
    if (generation !== this.signatureGeneration || values.length < this.signatureOrder.length * 3) return;
    this.signatureOrder.forEach((t, i) => {
      const v = values.subarray(i * 3, i * 3 + 3);
      if (Number.isNaN(v[0])) {
        this.signatureValues.delete(targetKey(t));
        return;
      }
      // Copy only the signature's components so listeners may keep the array.
      const arity = t.signature === 'rgb' ? 3 : t.signature === 'panTilt' ? 2 : 1;
      this.signatureValues.set(targetKey(t), v.slice(0, arity));
    });
  }

  /** Test helper. */
  reset(): void {
    this.subs.clear();
    this.frameCallbacks.clear();
    this.last = null;
    this.signatureOrder = [];
    this.signatureValues.clear();
  }
}

/** The app-wide hub. */
export const liveHub = new LiveHub();
