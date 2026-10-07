/**
 * ESP connectors (plan P6.2): firmware packets and rendered strip frames.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Json } from '@pixelmapper/extension-api';
import { installSharedGlobals } from '~/utils/extensions/shared-globals';
import { registerExtension, resetRegistry } from '~/utils/extensions/registry';
import { createKindFixture, getKind } from '~/utils/kinds/kind-host';
import { useEngineStore } from '~/stores/engine-store';
import strips from '../neopixel-strip/extension';
import { dmxFrame, pixelFrame, stripSlots, TYPE_DMX_FRAME, TYPE_PIXEL_FRAME, TYPE_STRIP_SLOTS } from './protocol';
import { WsStripConnector } from './ws-strip-connector';
import { isNewer } from './serial-connector';

/** Captures WebSocket sends. */
const sent: Uint8Array[] = [];
class FakeWebSocket {
  static OPEN = 1;
  readyState = 1;
  binaryType = '';
  private handlers: Record<string, (ev?: unknown) => void> = {};
  constructor(public url: string) { setTimeout(() => this.handlers.open?.(), 0); }
  addEventListener(type: string, cb: (ev?: unknown) => void) { this.handlers[type] = cb; }
  send(p: Uint8Array | string) { if (typeof p !== 'string') sent.push(p); }
  close() {}
}

beforeAll(() => {
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

beforeEach(() => {
  setActivePinia(createPinia());
  resetRegistry();
  installSharedGlobals();
  registerExtension(strips);
  sent.length = 0;
});

describe('ESP protocol', () => {
  it('frames packets', () => {
    const d = dmxFrame(3, new Uint8Array(512).fill(9));
    expect([d[0], d[1], d[2], d[3] | (d[4]! << 8), d[5], d[6]]).toEqual([0xaa, 0x55, TYPE_DMX_FRAME, 513, 3, 9]);
    const s = stripSlots([{ pin: 5, chipType: 'SK6812-RGBW', ledCount: 300, groupSize: 2, ledsPerMeter: 60 }]);
    expect([s[2], s[5], s[6], s[7], s[8] | (s[9]! << 8)]).toEqual([TYPE_STRIP_SLOTS, 1, 5, 3, 300]);
    const p = pixelFrame(1, Uint8Array.from([1, 2, 3]));
    expect([p[2], p[5], p[6], p.length]).toEqual([TYPE_PIXEL_FRAME, 1, 3, 11]);
  });

  it('compares firmware versions', () => {
    expect(isNewer('1.2.0', '1.1.9')).toBe(true);
    expect(isNewer('1.2.0', '1.2.0')).toBe(false);
    expect(isNewer('1.0.0', 'dev')).toBe(true);
  });
});

describe('WebSocket strip node', () => {
  it('sends the slot layout once and the strip pixels every frame', async () => {
    const store = useEngineStore();
    const f = createKindFixture(getKind('neopixel-strip')!.def, { id: 'strip-1', config: { shapeType: 'line', ledCount: 4, ledsPerMeter: 4, groupSize: 1, chipType: 'WS2812B', clockwise: true, points: [] } as Json });
    f.startAddress = 11;
    store.sceneNodes.push(f);

    const c = WsStripConnector.fromConfig('n', { url: 'ws://node/ws', fixtureSlots: [{ fixtureId: 'strip-1', pin: 7 }] });
    await c.connect();
    await new Promise(r => setTimeout(r, 5));
    expect(c.status.value).toBe('connected');
    sent.length = 0;

    const dmx = new Uint8Array(512);
    for (let i = 0; i < 12; i++) dmx[10 + i] = i + 1;
    c.onEngineState({ bpm: 120, elapsedMs: 0, beatTime: 0, dmxBuffer: dmx });
    c.onEngineState({ bpm: 120, elapsedMs: 16, beatTime: 0, dmxBuffer: dmx });

    expect(sent.map(p => p[2])).toEqual([TYPE_STRIP_SLOTS, TYPE_PIXEL_FRAME, TYPE_PIXEL_FRAME]);
    expect(sent[0]![6]).toBe(7); // pin
    expect(Array.from(sent[1]!.subarray(8))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});
