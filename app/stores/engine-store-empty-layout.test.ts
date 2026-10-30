import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { TYPE_CHAN_BIN, TYPE_LAYOUT_BIN } from '~/utils/connectors/binary-encoder';

/**
 * Regression: on a route without a project (login), the engine store's first
 * packet build saw zero fixtures. Their layout fingerprint is `''`, equal to
 * the old start value, so the layout packet was never built and the render
 * loop dispatched its 0-byte placeholder — the worker reported
 * "Engine rejected packet 0x14 (format mismatch?)".
 *
 * The worker is stubbed and records every posted `dispatch`; the payloads are
 * then fed to the real core engine (WASM in Node) when its build is present.
 */

// ── Fakes ────────────────────────────────────────────────────────────────────

/** A `dispatch` message posted to the engine worker. */
type Dispatch = { packetType: number; data: Uint8Array };

/** Every packet dispatched to any stubbed worker, in order. */
const dispatched: Dispatch[] = [];
/** Stubbed engine workers; `engineReady()` delivers their ready message. */
const workers: FakeWorker[] = [];

/** Stand-in for the engine worker: records dispatched packets. */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor() { workers.push(this); }
  postMessage(m: { type: string; packetType?: number; data?: ArrayBuffer }) {
    if (m.type === 'dispatch' && m.packetType !== undefined && m.data) {
      dispatched.push({ packetType: m.packetType, data: new Uint8Array(m.data.slice(0)) });
    }
  }
  terminate() {}
}

/** Resolve `engine.ready` (the WASM engine finished loading). */
function engineReady(): void {
  for (const w of workers) w.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
}

/** Let promise chains, timers and rAF callbacks settle. */
async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>(r => setTimeout(r, 0));
}

beforeEach(() => {
  vi.resetModules();
  workers.length = 0;
  dispatched.length = 0;
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('Worker', FakeWorker);
  // Built-in modifier plugins are fetched at engine init; no network here.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
  vi.stubGlobal('useSupabaseClient', () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  }));
  vi.stubGlobal('useSupabaseUser', () => ref(null));
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { supabase: { url: 'http://localhost' } } }));
  vi.stubGlobal('useRouter', () => ({ push: vi.fn() }));
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Starts the engine store without loading a project (login route). */
async function startWithoutProject(): Promise<void> {
  const { useEngineStore } = await import('~/stores/engine-store');
  const store = useEngineStore();
  const init = store.initEngine();
  engineReady();
  await init;
  // Let the render loop (rAF) dispatch the cached packets.
  await settle();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('engine start without a project (zero fixtures)', () => {
  it('dispatches a valid empty layout packet, never a 0-byte payload', async () => {
    await startWithoutProject();

    const layouts = dispatched.filter(d => d.packetType === TYPE_LAYOUT_BIN);
    expect(layouts.length).toBeGreaterThan(0);
    for (const d of [...layouts, ...dispatched.filter(p => p.packetType === TYPE_CHAN_BIN)]) {
      expect(d.data.byteLength).toBeGreaterThan(0);
    }
    // v3 empty layout: f32 metersPerUnit + u16 count = 0.
    const last = layouts.at(-1)!;
    expect(last.data.byteLength).toBe(6);
    expect(new DataView(last.data.buffer).getUint16(4, true)).toBe(0);
  });

  const ROOT = join(__dirname, '../..');
  // wasm-pack output (scripts/engine-packages.ts; not imported: it needs
  // `import.meta.url` as a file URL, which happy-dom does not provide).
  const CORE = join(ROOT, 'rs-engine/core/pkg');
  const wasmReady = existsSync(join(CORE, 'rs_engine_core_bg.wasm'));

  it.skipIf(!wasmReady)('the real engine accepts every dispatched layout/channels packet', async () => {
    await startWithoutProject();

    const core = await import(join(CORE, 'rs_engine_core.js'));
    await core.default({ module_or_path: readFileSync(join(CORE, 'rs_engine_core_bg.wasm')) });
    const engine = new core.WasmEngine();
    const packets = dispatched.filter(d => d.packetType === TYPE_LAYOUT_BIN || d.packetType === TYPE_CHAN_BIN);
    expect(packets.length).toBeGreaterThan(0);
    // Empty project: 0 fixtures / 0 chaser groups, not -1 (rejected).
    for (const d of packets) expect(engine.dispatch(d.packetType, d.data)).toBe(0);
  });
});
