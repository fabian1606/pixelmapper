/**
 * Tauri platform (ADR 0003): web platform plus the built-in Art-Net bridge (details in artnet-bridge.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
// `Channel` is imported by the Art-Net bridge module; a bare stub suffices here.
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args), Channel: class {} }));

const { createPlatform } = await import('./index');

beforeEach(() => {
  invoke.mockReset();
});

describe('Tauri platform', () => {
  it('reports kind tauri and provides the built-in Art-Net bridge', () => {
    const p = createPlatform();
    expect(p.kind).toBe('tauri');
    expect(p.artnetBridge).not.toBeNull();
  });
});
