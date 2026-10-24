import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vue from 'vue';
import { defineExtension, registerExtension, useScope } from '@pixelmapper/extension-api';
import { installSharedGlobals } from './shared-globals';
import { getExtension, resetRegistry } from './registry';

/** Minimal valid manifest. */
const manifest = (id: string) => defineExtension({
  id, version: '1.0.0', apiVersion: '^1.0.0', displayName: id, description: 'test',
});

beforeEach(() => {
  resetRegistry();
  globalThis.__PIXELMAPPER_SHARED__ = undefined;
  globalThis.__PIXELMAPPER_PENDING__ = undefined;
});

describe('shared globals', () => {
  it('queues registrations made before the host is ready and drains them at install', () => {
    registerExtension(manifest('early'));
    expect(getExtension('early')).toBeUndefined();
    expect(globalThis.__PIXELMAPPER_PENDING__).toHaveLength(1);

    installSharedGlobals();
    expect(getExtension('early')?.source).toBe('layer');
    expect(globalThis.__PIXELMAPPER_PENDING__).toEqual([]);

    // After install, registration is immediate.
    registerExtension(manifest('late'));
    expect(getExtension('late')).toBeDefined();
  });

  it('exposes vue and the API (exports + host implementations) to bundles', () => {
    installSharedGlobals();
    const shared = globalThis.__PIXELMAPPER_SHARED__!;
    expect(shared.vue).toBe(vue);
    expect(typeof shared.api.defineExtension).toBe('function');
    expect(shared.api.apiVersion).toBe('1.3.0');
    // Declared composables resolve through the globals.
    const scope = vue.effectScope();
    scope.run(() => {
      const comp = vue.defineComponent({ setup: () => { expect(useScope('fixture').value).toBeUndefined(); return () => null; } });
      expect(comp).toBeTruthy();
    });
    scope.stop();
  });

  it('logs instead of throwing for invalid manifests', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    installSharedGlobals();
    registerExtension(manifest('Bad Id'));
    expect(err).toHaveBeenCalledWith(expect.stringContaining('Extension "Bad Id" rejected'));
    err.mockRestore();
  });
});
