/**
 * Process plumbing of the Art-Net end-to-end test: finds the hardware repo
 * (`PIXELMAPPER_HARDWARE_DIR`), builds or reuses `pmnet` / `pmnet-bridge`,
 * picks free ports, starts the simulated node and the bridge, waits for
 * their ready lines and kills them again (whole process group).
 *
 * Tests only (Node APIs); never imported by extension runtime code.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { existsSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

// ── Hardware repo ──────────────────────────────

/** Default location of the hardware repo checkout on the developer machine. */
export const DEFAULT_HARDWARE_DIR = '/Users/fabian.rafreider/Documents/projekte/pixelmapper-hardware';

/**
 * The hardware repo to test against: `PIXELMAPPER_HARDWARE_DIR`, else the
 * default checkout when it exists; null when neither is usable (the suite
 * is skipped then).
 */
export function resolveHardwareDir(): string | null {
  const fromEnv = process.env.PIXELMAPPER_HARDWARE_DIR?.trim();
  const candidate = fromEnv || DEFAULT_HARDWARE_DIR;
  return existsSync(join(candidate, 'crates', 'pmnet-bridge')) ? candidate : null;
}

/** Paths of the two binaries in a hardware repo. */
export interface Binaries {
  pmnet: string;
  bridge: string;
}

/**
 * Builds `pmnet` and `pmnet-bridge` (`cargo build`, a no-op when up to
 * date) and returns their paths. Without cargo, existing binaries are
 * reused; throws when there are none.
 */
export function buildBinaries(dir: string): Binaries {
  const binaries = { pmnet: join(dir, 'target', 'debug', 'pmnet'), bridge: join(dir, 'target', 'debug', 'pmnet-bridge') };
  const build = spawnSync('cargo', ['build', '-p', 'pixelmapper-net', '-p', 'pmnet-bridge'], { cwd: dir, encoding: 'utf8', timeout: 600_000 });
  const built = build.status === 0;
  if (!built && !(existsSync(binaries.pmnet) && existsSync(binaries.bridge))) {
    throw new Error(`cargo build failed in ${dir}: ${build.error?.message ?? build.stderr?.slice(-2000)}`);
  }
  if (!built) console.warn(`[e2e] cargo build failed; reusing the existing binaries in ${dir}/target/debug`);
  return binaries;
}

// ── Free ports ─────────────────────────────────

/** A free UDP port on 127.0.0.1 (bound and released again). */
export function freeUdpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', () => {
      const { port } = socket.address();
      socket.close(() => resolve(port));
    });
  });
}

/** A free TCP port on 127.0.0.1 (listened on and released again). */
export function freeTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

// ── Child processes ────────────────────────────

/** Removes ANSI colour codes (tracing colours its output on some terminals). */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001B\[[0-9;]*m/g, '');
}

/** A started helper process with its collected output. */
export interface RunningProcess {
  name: string;
  child: ChildProcess;
  /** stdout + stderr so far (ANSI codes removed). */
  output: () => string;
  /** Terminates the process group: SIGTERM, then SIGKILL after `graceMs`. */
  kill: (graceMs?: number) => Promise<void>;
}

/**
 * Starts `command` in its own process group and resolves once its output
 * matches `ready` (stdout or stderr). Rejects when it exits first or the
 * line does not come within `timeoutMs`.
 */
export function startProcess(name: string, command: string, args: string[], ready: RegExp, timeoutMs = 20_000): Promise<RunningProcess> {
  const child = spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let exited = false;
  child.once('exit', () => { exited = true; });

  /** Signals the whole group (falls back to the child alone). */
  const signal = (sig: NodeJS.Signals) => {
    if (exited || child.pid === undefined) return;
    try {
      process.kill(-child.pid, sig);
    }
    catch {
      try { child.kill(sig); }
      catch { /* already gone */ }
    }
  };

  // Safety net: when the test runner itself ends without afterAll (e.g. Ctrl-C), no orphan stays behind.
  const onRunnerExit = () => signal('SIGKILL');
  process.once('exit', onRunnerExit);
  child.once('exit', () => { process.removeListener('exit', onRunnerExit); });

  const running: RunningProcess = {
    name,
    child,
    output: () => output,
    kill: async (graceMs = 2000) => {
      if (exited) return;
      const gone = new Promise<void>(resolve => child.once('exit', () => resolve()));
      signal('SIGTERM');
      const timer = setTimeout(() => signal('SIGKILL'), graceMs);
      await Promise.race([gone, new Promise(resolve => setTimeout(resolve, graceMs + 1000))]);
      clearTimeout(timer);
    },
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      void running.kill();
      reject(new Error(`${name} did not get ready within ${timeoutMs} ms. Output:\n${output}`));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      output += stripAnsi(chunk.toString('utf8'));
      if (ready.test(output)) {
        clearTimeout(timer);
        resolve(running);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`${name} could not start: ${err.message}`));
    });
    child.once('exit', (code, sig) => {
      clearTimeout(timer);
      reject(new Error(`${name} exited (${code ?? sig}) before it was ready. Output:\n${output}`));
    });
  });
}

// ── WebSocket upgrade probe ────────────────────

/**
 * Sends a bare WebSocket upgrade with `origin` to `ws://127.0.0.1:<port>/`
 * and returns the HTTP status (101 = accepted, 403 = Origin refused).
 */
export function upgradeStatus(port: number, origin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path: '/',
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        'Origin': origin,
      },
    });
    req.once('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.once('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.once('error', reject);
    req.end();
  });
}
