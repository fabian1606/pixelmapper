#!/usr/bin/env bun
/**
 * Build / upload / monitor PlatformIO firmware.
 *
 * Usage:
 *   bun run flash ws                    # build + upload + monitor (S3 NeoPixel)
 *   bun run flash p4                    # build + upload + monitor (P4 PoE)
 *   bun run flash ws --build            # build only
 *   bun run flash ws --upload           # upload (re-builds if needed)
 *   bun run flash ws --monitor          # serial monitor only
 *   bun run flash ws --port /dev/cu.usbmodem1101
 *   bun run flash ws --clean            # full clean before build
 *
 * Default action (no flag) is the full cycle: build → upload → monitor.
 */
import { $ } from 'bun';

const TARGETS: Record<string, { dir: string; env: string; label: string }> = {
  ws: { dir: 'pio-ws', env: 'esp32s3_neopixel', label: 'ESP32-S3 NeoPixel (pio-ws)' },
  p4: { dir: 'pio',    env: 'waveshare_p4_poe', label: 'ESP32-P4 PoE (pio)' },
};

const args = process.argv.slice(2);
const target = args[0];

if (!target || !(target in TARGETS)) {
  console.error('Usage: bun run flash <ws|p4> [--build | --upload | --monitor] [--port <path>] [--clean]');
  console.error('Targets:');
  for (const [k, v] of Object.entries(TARGETS)) console.error(`  ${k}  ${v.label}`);
  process.exit(1);
}

const t = TARGETS[target]!;
const flag = (name: string) => args.includes(`--${name}`);
const flagValue = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const buildOnly   = flag('build');
const uploadOnly  = flag('upload');
const monitorOnly = flag('monitor');
const cleanFirst  = flag('clean');
const port        = flagValue('port');

if ([buildOnly, uploadOnly, monitorOnly].filter(Boolean).length > 1) {
  console.error('Pick at most one of --build, --upload, --monitor');
  process.exit(1);
}

const doBuild   = !uploadOnly && !monitorOnly;
const doUpload  = !buildOnly && !monitorOnly;
const doMonitor = !buildOnly && !uploadOnly;

const cwd = t.dir;
const portArg = port ? ['--upload-port', port] : [];

console.log(`▸ Target: ${t.label}`);

if (cleanFirst) {
  console.log('▸ pio run -t clean');
  await $`pio run -e ${t.env} -t clean`.cwd(cwd);
}

if (doBuild && !doUpload) {
  console.log('▸ pio run (build only)');
  await $`pio run -e ${t.env}`.cwd(cwd);
}

if (doUpload) {
  console.log(`▸ pio run -t upload${port ? ` (port=${port})` : ''}`);
  await $`pio run -e ${t.env} -t upload ${portArg}`.cwd(cwd);
}

if (doMonitor) {
  console.log('▸ pio device monitor (Ctrl-C to exit)');
  const monPort = port ? ['-p', port] : [];
  // Inherits stdin/stdout — Ctrl-C exits cleanly.
  await $`pio device monitor -e ${t.env} ${monPort}`.cwd(cwd);
}
