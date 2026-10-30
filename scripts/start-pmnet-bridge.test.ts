// @vitest-environment node
/**
 * Lookup and arguments of the dev start script of `pmnet-bridge serve`
 * (plan M3.4). The spawning itself is checked by hand (`bun run pmnet-bridge`).
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPmnetBridge, missingBridgeHint, serveArgs } from './start-pmnet-bridge';

const HW = '/hw';
const bin = (profile: string) => join(HW, 'target', profile, process.platform === 'win32' ? 'pmnet-bridge.exe' : 'pmnet-bridge');

/** Lookup inputs with the given existing files and PATH result. */
function lookup(files: string[], onPath: string | null = null) {
  return { which: () => onPath, exists: (p: string) => files.includes(p), hardwareDir: HW };
}

describe('findPmnetBridge', () => {
  it('prefers the binary on PATH', () => {
    expect(findPmnetBridge(lookup([bin('release')], '/usr/local/bin/pmnet-bridge'))).toBe('/usr/local/bin/pmnet-bridge');
  });

  it('falls back to the release, then the debug build of the hardware checkout', () => {
    expect(findPmnetBridge(lookup([bin('release'), bin('debug')]))).toBe(bin('release'));
    expect(findPmnetBridge(lookup([bin('debug')]))).toBe(bin('debug'));
  });

  it('returns null without PATH entry and build, or without PIXELMAPPER_HARDWARE_DIR', () => {
    expect(findPmnetBridge(lookup([]))).toBeNull();
    expect(findPmnetBridge({ ...lookup([bin('debug')]), hardwareDir: undefined })).toBeNull();
  });
});

describe('serveArgs', () => {
  it('serves on the default port 7777 and passes extra arguments on', () => {
    expect(serveArgs([])).toEqual(['serve', '--port', '7777']);
    expect(serveArgs(['--mock', '-v'])).toEqual(['serve', '--port', '7777', '--mock', '-v']);
  });

  it('keeps a port given by the caller', () => {
    expect(serveArgs(['--port', '7790'])).toEqual(['serve', '--port', '7790']);
    expect(serveArgs(['--port=7790'])).toEqual(['serve', '--port=7790']);
  });
});

describe('missingBridgeHint', () => {
  it('says how to build the bridge and where it looked', () => {
    expect(missingBridgeHint()).toContain('PIXELMAPPER_HARDWARE_DIR not set');
    expect(missingBridgeHint(HW)).toContain(`${HW}/target/{release,debug}`);
    expect(missingBridgeHint(HW)).toContain('cargo build --release -p pmnet-bridge');
  });
});
