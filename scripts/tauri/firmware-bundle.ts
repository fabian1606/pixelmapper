#!/usr/bin/env bun
/**
 * Bundles the ESP32 firmware matching the app release into the desktop app
 * (ADR 0004 D19). Runs in the Tauri `beforeBuildCommand`.
 *
 * Source, first match wins:
 * 1. `PM_FIRMWARE_BIN=<path>` — explicit local file;
 * 2. the `firmware.bin` asset of the GitHub release `v<package.json version>`
 *    (published by `.github/workflows/build-firmware.yml` when
 *    `bun run release` pushes the tag);
 * 3. a local PlatformIO build (`pio/.pio/build/<env>/firmware.bin`, dev only).
 *
 * Writes `src-tauri/resources/firmware/firmware.bin` + `firmware-meta.json`
 * (`{ version, source }`). Fails soft: without a binary it removes stale
 * files, prints a clear warning and exits 0 — the app then reports
 * "No bundled firmware" and can still download one when online.
 * `PM_FIRMWARE_REQUIRED=1` turns the warning into an error (release CI).
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Repository root (this file lives in scripts/tauri). */
const ROOT = join(import.meta.dir, '..', '..');
/** Target folder, bundled via `bundle.resources` in src-tauri/tauri.conf.json. */
const OUT_DIR = join(ROOT, 'src-tauri', 'resources', 'firmware');
/** Release download URL pattern of the firmware asset. */
const RELEASE_ASSET = (version: string) =>
  `https://github.com/fabian1606/pixelmapper/releases/download/v${version}/firmware.bin`;
/** PlatformIO env of the USB serial node (same as the CI workflow). */
const PIO_BUILD = join(ROOT, 'pio', '.pio', 'build', 'waveshare_p4_poe', 'firmware.bin');

/** Metadata the app reads next to the binary. */
interface FirmwareMeta {
  /** Firmware version (semver without `v`), `dev` for local builds. */
  version: string;
  /** Where the binary came from (for logs). */
  source: string;
}

/** True when the file exists. */
async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

/** Downloads the release asset; `null` when unavailable (offline, no release yet). */
async function download(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      console.warn(`[firmware-bundle] ${url} → HTTP ${res.status}`);
      return null;
    }
    return new Uint8Array(await res.arrayBuffer());
  }
  catch (err) {
    console.warn(`[firmware-bundle] download failed: ${(err as Error).message}`);
    return null;
  }
}

/** Writes binary + metadata. */
async function write(bytes: Uint8Array, meta: FirmwareMeta): Promise<void> {
  await writeFile(join(OUT_DIR, 'firmware.bin'), bytes);
  await writeFile(join(OUT_DIR, 'firmware-meta.json'), JSON.stringify(meta, null, 2));
  console.log(`[firmware-bundle] bundled firmware v${meta.version} (${bytes.length} bytes, ${meta.source})`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as { version: string };
await mkdir(OUT_DIR, { recursive: true });
// Never ship a stale binary from an earlier build.
await rm(join(OUT_DIR, 'firmware.bin'), { force: true });
await rm(join(OUT_DIR, 'firmware-meta.json'), { force: true });

const explicit = process.env.PM_FIRMWARE_BIN;
if (explicit) {
  await write(new Uint8Array(await readFile(explicit)), {
    version: process.env.PM_FIRMWARE_VERSION ?? pkg.version,
    source: explicit,
  });
}
else {
  const url = RELEASE_ASSET(pkg.version);
  const released = await download(url);
  if (released) {
    await write(released, { version: pkg.version, source: url });
  }
  else if (await exists(PIO_BUILD)) {
    await write(new Uint8Array(await readFile(PIO_BUILD)), { version: 'dev', source: 'local PlatformIO build' });
  }
  else {
    const msg = `[firmware-bundle] no firmware for v${pkg.version}: release asset unavailable and no local PlatformIO build. `
      + 'The desktop app will build without bundled firmware (online download still works). '
      + 'Set PM_FIRMWARE_BIN=<path> or run `pio run` in pio/ to bundle one.';
    if (process.env.PM_FIRMWARE_REQUIRED === '1') {
      console.error(msg);
      process.exit(1);
    }
    console.warn(msg);
  }
}
