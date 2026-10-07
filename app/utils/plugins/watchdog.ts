/**
 * Worker watchdog (ADR §6.7, plan P3.10).
 *
 * The engine worker posts a frame (heartbeat) every ~16 ms. A plugin stuck in
 * a loop the budget instrumentation did not catch would freeze the worker;
 * when no heartbeat arrives for `timeoutMs`, `onStall` fires once (the owner
 * terminates and respawns the worker). Checking stops while the page is
 * hidden (browsers throttle workers' timers there).
 */
export interface WatchdogOptions {
  /** Silence before a stall is declared (default 1 000 ms). */
  timeoutMs?: number;
  /** Check interval (default 250 ms). */
  intervalMs?: number;
  /** Called once per stall. */
  onStall: () => void;
  /** Clock (tests). */
  now?: () => number;
}

export class Watchdog {
  private last = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: WatchdogOptions) {
    this.timeoutMs = opts.timeoutMs ?? 1000;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Records a heartbeat. */
  beat(): void {
    this.last = this.now();
  }

  /** Starts watching (the first heartbeat arms it). */
  start(): void {
    this.stop();
    this.last = this.now();
    this.timer = setInterval(() => this.check(), this.opts.intervalMs ?? 250);
  }

  /** Stops watching. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One check; exposed for tests. */
  check(): void {
    if (typeof document !== 'undefined' && document.hidden) {
      this.last = this.now();
      return;
    }
    if (this.now() - this.last > this.timeoutMs) {
      this.last = this.now();
      this.opts.onStall();
    }
  }
}
