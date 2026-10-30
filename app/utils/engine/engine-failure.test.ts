/**
 * Engine failures are surfaced, not swallowed: a worker that fails to load,
 * an ABI mismatch reported by the worker and rejected packets reach
 * `EffectEngine.onFailure`, fatal ones set `failure` (live output readers
 * check it) and `initEngine` turns them into a toast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { EngineFailure } from './engine-abi';

/** Stubbed engine workers (the real one needs the WASM build). */
const workers: FakeWorker[] = [];

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor() { workers.push(this); }
  postMessage() {}
  terminate() {}
  /** Delivers a worker message to the host. */
  emit(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

beforeEach(() => {
  vi.resetModules();
  workers.length = 0;
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EffectEngine failures', () => {
  it('reports a worker that fails to load as fatal', async () => {
    const { EffectEngine } = await import('./engine');
    const engine = new EffectEngine();
    const seen: EngineFailure[] = [];
    engine.onFailure = f => seen.push(f);
    workers[0]!.onerror?.({ message: 'Importing binding name \'WasmEngine\' is not found.' } as ErrorEvent);
    expect(engine.failure.value?.kind).toBe('load');
    expect(engine.failure.value?.fatal).toBe(true);
    expect(seen[0]?.message).toMatch(/bun run build:wasm/);
  });

  it('keeps the first fatal cause and passes non-fatal ones through', async () => {
    const { EffectEngine } = await import('./engine');
    const engine = new EffectEngine();
    const seen: EngineFailure[] = [];
    engine.onFailure = f => seen.push(f);
    const abi: EngineFailure = { kind: 'abi', message: 'Engine build does not match the app', fatal: true };
    workers[0]!.emit({ type: 'engine-error', failure: abi });
    workers[0]!.onerror?.({ message: '' } as ErrorEvent);
    workers[0]!.emit({ type: 'engine-error', failure: { kind: 'dispatch', message: 'rejected', fatal: false } });
    expect(engine.failure.value).toEqual(abi);
    expect(seen.map(f => f.kind)).toEqual(['abi', 'dispatch']);
  });

  it('a non-fatal failure does not mark the engine as failed', async () => {
    const { EffectEngine } = await import('./engine');
    const engine = new EffectEngine();
    workers[0]!.emit({ type: 'engine-error', failure: { kind: 'render', message: 'boom', fatal: false } });
    expect(engine.failure.value).toBeNull();
  });
});

describe('initEngine', () => {
  it('shows a toast for a fatal engine failure', async () => {
    setActivePinia(createPinia());
    const { useEngineStore } = await import('~/stores/engine-store');
    const { notifications } = await import('~/composables/use-notifications');
    const store = useEngineStore();
    void store.initEngine();
    workers[0]!.emit({ type: 'engine-error', failure: { kind: 'abi', message: 'Engine build does not match the app', fatal: true } });
    const toast = notifications.value.find(n => n.title === 'Render engine unavailable');
    expect(toast?.variant).toBe('error');
    expect(toast?.description).toMatch(/does not match/);
  });
});
