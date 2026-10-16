/**
 * Web Serial plumbing shared by the ESP serial connectors: port open/close,
 * line-based read loop, boot wait, retry after drops, writes.
 *
 * Web Serial needs a user gesture for the first `requestPort()`; reopening
 * the same port within a session does not, so drops retry until the device
 * disappears (then the user has to click Connect again).
 */
import { ConnectorBase } from '@pixelmapper/extension-api';

/** Retry interval after a drop. */
const RETRY_INTERVAL_MS = 2000;

export abstract class SerialPortConnector extends ConnectorBase {
  baudRate: number;

  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readAbort: AbortController | null = null;
  private readLoopDone: Promise<void> = Promise.resolve();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lineWaiters: ((line: string) => void)[] = [];

  /** Log tag, e.g. `serial`. */
  protected abstract readonly tag: string;
  /** Line prefixes that mean "booted" (e.g. `[boot]`). */
  protected abstract readonly bootMarkers: string[];

  constructor(id: string, baudRate: number) {
    super(id);
    this.baudRate = baudRate;
  }

  /** Called for every received line (after logging). */
  protected onLine(_line: string): void {}
  /** Called once the device is ready after connecting. */
  protected onReady(): void {}
  /** Called right after the port opened (reset caches). */
  protected onOpen(): void {}

  /** Opens the port (requesting it on first use), waits for boot. */
  async connect(): Promise<void> {
    this.clearRetryTimer();
    this.status.value = 'connecting';
    this.errorMessage.value = null;
    try {
      const serial = (navigator as Navigator & { serial?: Serial }).serial;
      if (!serial) throw new Error('Web Serial is not supported in this browser');
      if (!this.port) this.port = await serial.requestPort();
      await this.port.open({ baudRate: this.baudRate });
      this.writer = this.port.writable!.getWriter();
      this.onOpen();
      this.startReadLoop();
      await this.waitForLine(l => this.bootMarkers.some(m => l.startsWith(m)), 3000).catch(() => {
        this.pushLog(`[${this.tag}] boot wait timed out — proceeding`);
      });
      this.status.value = 'connected';
      this.autoReconnect.value = true;
      this.pushLog(`[${this.tag}] ready`);
      this.onReady();
    }
    catch (e) {
      this.handleFailure(e as Error);
    }
  }

  /** Closes the port and stops retrying. */
  async disconnect(): Promise<void> {
    this.autoReconnect.value = false;
    this.clearRetryTimer();
    await this.teardownHandles();
    this.port = null;
    this.status.value = 'disconnected';
    this.errorMessage.value = null;
  }

  /** True while the port is writable. */
  protected get writable(): boolean {
    return !!this.writer;
  }

  /** Writes a packet (fire-and-forget; a failed write disconnects). */
  protected send(packet: Uint8Array): void {
    if (!this.writer) return;
    try {
      this.writer.write(packet).catch(() => this.disconnect());
    }
    catch {
      void this.disconnect();
    }
  }

  /** Resolves with the first received line matching `match` (rejects after `timeoutMs`). */
  protected waitForLine(match: (line: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const waiter = (line: string) => {
        if (!match(line)) return;
        clearTimeout(timer);
        this.lineWaiters = this.lineWaiters.filter(w => w !== waiter);
        resolve(line);
      };
      const timer = setTimeout(() => {
        this.lineWaiters = this.lineWaiters.filter(w => w !== waiter);
        reject(new Error(`timeout waiting for device (${timeoutMs}ms)`));
      }, timeoutMs);
      this.lineWaiters.push(waiter);
    });
  }

  // ── Internals ──────────────────────────────────

  /** Drop or failed attempt: retry when armed, else settle in error. */
  private handleFailure(e: Error) {
    const msg = e?.message ?? 'Connection failed';
    this.pushLog(`[${this.tag}] connect failed: ${msg}`);
    this.errorMessage.value = msg;
    void this.teardownHandles();
    // The device went away: the port handle is dead, a new gesture is needed.
    if (e?.name === 'NotFoundError' || /no longer|not found|invalid state/i.test(msg)) {
      this.port = null;
      this.autoReconnect.value = false;
    }
    if (this.autoReconnect.value) {
      this.status.value = 'connecting';
      this.retryTimer = setTimeout(() => this.connect(), RETRY_INTERVAL_MS);
      this.pushLog(`[${this.tag}] retry in ${RETRY_INTERVAL_MS}ms`);
    }
    else {
      this.status.value = 'error';
    }
  }

  private async teardownHandles() {
    this.readAbort?.abort();
    this.readAbort = null;
    try { await this.readLoopDone; } catch { /* loop already failed */ }
    try { this.writer?.releaseLock(); } catch { /* not locked */ }
    this.writer = null;
    try { await this.port?.close(); } catch { /* already closed */ }
  }

  private clearRetryTimer() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  }

  /** Reads text lines until aborted; an unexpected end triggers a retry. */
  private startReadLoop() {
    const ctrl = new AbortController();
    this.readAbort = ctrl;
    const port = this.port!;
    const run = async () => {
      const decoder = new TextDecoder();
      const reader = port.readable!.getReader();
      const onAbort = () => reader.cancel().catch(() => {});
      ctrl.signal.addEventListener('abort', onAbort);
      let partial = '';
      let dropError: unknown = null;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            if (!ctrl.signal.aborted) dropError = new Error('Serial port closed');
            break;
          }
          partial += decoder.decode(value, { stream: true });
          const lines = partial.split('\n');
          partial = lines.pop() ?? '';
          for (const raw of lines) {
            const line = raw.trimEnd();
            if (!line) continue;
            this.pushLog(line);
            this.onLine(line);
            for (const w of [...this.lineWaiters]) w(line);
          }
        }
      }
      catch (e) {
        if (!ctrl.signal.aborted) dropError = e;
      }
      finally {
        ctrl.signal.removeEventListener('abort', onAbort);
        try { reader.releaseLock(); } catch { /* released */ }
      }
      if (dropError && this.status.value === 'connected') this.handleFailure(dropError as Error);
    };
    this.readLoopDone = run();
  }
}
