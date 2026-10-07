import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import type { LiveFrame } from '@pixelmapper/extension-api';
import { extractors, liveHub } from './live-hub';
import { useLiveValue } from '~/composables/extensions/use-live-value';
import { onFrame } from '~/composables/extensions/on-frame';

/** A 2-universe frame where byte i = i % 256. */
const frame = () => Uint8Array.from({ length: 1024 }, (_, i) => i % 256);

beforeEach(() => {
  liveHub.reset();
  liveHub.configure({
    // Fixture "f" starts at address 10; channel n sits at 10 + n.
    resolveChannelAddress: (id, idx) => (id === 'f' ? 10 + idx : null),
    beatSource: () => ({ bpm: 120, clockEpoch: 0 }),
  });
});

afterEach(() => vi.restoreAllMocks());

describe('live hub', () => {
  it('reference-counts subscriptions per target', () => {
    const t = { kind: 'channel', fixtureId: 'f', channelIndex: 0 } as const;
    const a = liveHub.subscribe(t, () => {});
    const b = liveHub.subscribe({ ...t }, () => {});
    expect(liveHub.targetCount).toBe(1);
    expect(liveHub.refCount(t)).toBe(2);
    a();
    expect(liveHub.refCount(t)).toBe(1);
    b();
    expect(liveHub.targetCount).toBe(0);
    b(); // idempotent
    expect(liveHub.targetCount).toBe(0);
  });

  it('does no extraction work without subscribers', () => {
    const spies = [vi.spyOn(extractors, 'channel'), vi.spyOn(extractors, 'universe'), vi.spyOn(extractors, 'beat')];
    liveHub.ingest(frame(), 0);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it('extracts only subscribed targets', () => {
    const universe = vi.spyOn(extractors, 'universe');
    const got: unknown[] = [];
    liveHub.subscribe({ kind: 'channel', fixtureId: 'f', channelIndex: 2 }, v => got.push(v));
    liveHub.ingest(frame(), 16);
    expect(got).toEqual([11]); // address 12 → index 11
    expect(universe).not.toHaveBeenCalled();
  });

  it('extracts universes and beat info', () => {
    let uni: Uint8Array | undefined;
    let beat: { beatTime: number; bpm: number; phase: number } | undefined;
    liveHub.subscribe({ kind: 'universe', universe: 2 }, v => { uni = v as Uint8Array; });
    liveHub.subscribe({ kind: 'beat' }, v => { beat = v as typeof beat; });
    liveHub.ingest(frame(), 0, 1250); // 1.25 s @ 120 bpm = 2.5 beats
    expect(uni!.length).toBe(512);
    expect(uni![0]).toBe(0); // byte 512 % 256
    expect(uni![1]).toBe(1);
    expect(beat).toEqual({ beatTime: 2.5, bpm: 120, phase: 0.5 });
  });

  it('frame callbacks receive the raw frame and keep their targets subscribed', () => {
    const frames: LiveFrame[] = [];
    const dispose = liveHub.addFrameCallback(f => frames.push(f), [{ kind: 'beat' }]);
    expect(liveHub.targetCount).toBe(1);
    const dmx = frame();
    liveHub.ingest(dmx, 33, 500);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.dmx).toBe(dmx);
    expect(frames[0]!.beat.beatTime).toBe(1);
    dispose();
    expect(liveHub.active).toBe(false);
  });
});

describe('useLiveValue / onFrame', () => {
  it('subscribes while mounted, throttles, and unsubscribes on unmount', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    let value: ReturnType<typeof useLiveValue> | undefined;
    const C = defineComponent({
      setup() {
        value = useLiveValue({ kind: 'channel', fixtureId: 'f', channelIndex: 0 }, { fps: 10 });
        return () => h('div');
      },
    });
    const w = mount(C);
    expect(liveHub.targetCount).toBe(1);

    now = 1000;
    liveHub.ingest(frame(), 0);
    expect(value!.value).toBe(9);

    // Within 100 ms (10 fps): ignored.
    const next = frame();
    next[9] = 200;
    now = 1050;
    liveHub.ingest(next, 0);
    expect(value!.value).toBe(9);
    now = 1101;
    liveHub.ingest(next, 0);
    expect(value!.value).toBe(200);

    w.unmount();
    await nextTick();
    expect(liveHub.targetCount).toBe(0);
  });

  it('onFrame is disposed with its component', () => {
    const cb = vi.fn();
    const C = defineComponent({
      setup() {
        onFrame(cb);
        return () => h('div');
      },
    });
    const w = mount(C);
    liveHub.ingest(frame(), 0);
    expect(cb).toHaveBeenCalledTimes(1);
    w.unmount();
    liveHub.ingest(frame(), 0);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(liveHub.active).toBe(false);
  });
});
