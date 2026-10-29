#!/usr/bin/env bun
/**
 * Starts the Art-Net 4 bridge `pmnet-bridge serve` for development (plan M3.4).
 *
 * Usage:
 *   bun run pmnet-bridge              # serve on ws://127.0.0.1:7777 (the app's default)
 *   bun run pmnet-bridge --mock       # extra arguments go to `serve` (--mock, --offline, -v, --port …)
 *
 * Lookup: `pmnet-bridge` on `PATH`, else
 * `$PIXELMAPPER_HARDWARE_DIR/target/{release,debug}/pmnet-bridge` (a
 * `pixelmapper-hardware` checkout). When none is found it prints how to build
 * it and exits 0, so `concurrently` in `bun run dev` keeps the other processes
 * running. SIGINT/SIGTERM are forwarded to the bridge.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Port of the bridge; the app's default bridge URL is `ws://127.0.0.1:7777`. */
const PMNET_BRIDGE_PORT = '7777';

/** Name of the binary (with `.exe` on Windows). */
const BINARY_NAME = process.platform === 'win32' ? 'pmnet-bridge.exe' : 'pmnet-bridge';

// ── Lookup ─────────────────────────────────────

/** Inputs of the lookup, injectable for tests. */
export interface BridgeLookup {
  /** Resolves a command on `PATH` (e.g. `Bun.which`); null when not found. */
  which: (command: string) => string | null;
  /** True when a file exists. */
  exists: (path: string) => boolean;
  /** `PIXELMAPPER_HARDWARE_DIR`, if set. */
  hardwareDir?: string;
}

/**
 * Finds the `pmnet-bridge` binary: `PATH` first, then the release and the
 * debug build of the hardware checkout. Null when none exists.
 */
export function findPmnetBridge({ which, exists, hardwareDir }: BridgeLookup): string | null {
  const onPath = which('pmnet-bridge');
  if (onPath) return onPath;
  if (!hardwareDir) return null;
  for (const profile of ['release', 'debug']) {
    const candidate = join(hardwareDir, 'target', profile, BINARY_NAME);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Arguments of the bridge: `serve`, the default port unless the caller
 * passes `--port`, then the caller's arguments.
 */
export function serveArgs(extra: string[]): string[] {
  const hasPort = extra.some(a => a === '--port' || a.startsWith('--port='));
  return ['serve', ...(hasPort ? [] : ['--port', PMNET_BRIDGE_PORT]), ...extra];
}

/**
 * The one hint printed when no binary is found (no own prefix: `concurrently`
 * already prefixes the process name).
 */
export function missingBridgeHint(hardwareDir?: string): string {
  const where = hardwareDir
    ? `not on PATH, not built in ${hardwareDir}/target/{release,debug}`
    : 'not on PATH, PIXELMAPPER_HARDWARE_DIR not set';
  return `pmnet-bridge not found (${where}): Art-Net devices (artnet connectors) stay unreachable, everything else keeps running.\n`
    + 'Build it in pixelmapper-hardware with `cargo build --release -p pmnet-bridge`, then put target/release on PATH '
    + 'or set PIXELMAPPER_HARDWARE_DIR=<pixelmapper-hardware checkout>.';
}

// ── Main ───────────────────────────────────────

/** Runs the bridge until it exits; forwards SIGINT/SIGTERM. */
async function main(): Promise<void> {
  const hardwareDir = process.env.PIXELMAPPER_HARDWARE_DIR?.trim() || undefined;
  const binary = findPmnetBridge({ which: cmd => Bun.which(cmd), exists: existsSync, hardwareDir });
  if (!binary) {
    console.log(missingBridgeHint(hardwareDir));
    process.exit(0);
  }

  const args = serveArgs(process.argv.slice(2));
  console.log(`Starting ${binary} ${args.join(' ')}`);
  const child = Bun.spawn([binary, ...args], { stdio: ['inherit', 'inherit', 'inherit'] });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal));
  }
  const code = await child.exited;
  // Stopped by a signal (Ctrl-C, concurrently shutting down): not a failure.
  process.exit(child.signalCode ? 0 : code);
}

if (import.meta.main) await main();
