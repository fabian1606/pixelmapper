/**
 * Native HTTP and bundled resources (ADR 0004 D19) over `invoke`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { createTauriHttp, createTauriResources } = await import('./native-files');

beforeEach(() => {
  invoke.mockReset();
});

describe('Tauri native files', () => {
  it('downloads bytes through http_get_bytes', async () => {
    invoke.mockResolvedValueOnce(new Uint8Array([1, 2]).buffer);
    const bytes = await createTauriHttp().getBytes('https://github.com/x');
    expect(invoke).toHaveBeenCalledWith('http_get_bytes', { url: 'https://github.com/x' });
    expect([...bytes]).toEqual([1, 2]);
  });

  it('maps a missing resource to null and rethrows other errors', async () => {
    const resources = createTauriResources();
    invoke.mockResolvedValueOnce([7]);
    expect([...(await resources.read('firmware/firmware.bin'))!]).toEqual([7]);
    invoke.mockRejectedValueOnce('not_bundled');
    expect(await resources.read('firmware/firmware.bin')).toBeNull();
    invoke.mockRejectedValueOnce('invalid resource path: ../x');
    await expect(resources.read('../x')).rejects.toThrow(/invalid/);
  });
});
