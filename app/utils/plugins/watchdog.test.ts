/**
 * Watchdog arming: start-up and respawns are not stalls; silence after a
 * heartbeat is.
 */
import { describe, it, expect, vi } from 'vitest';
import { Watchdog } from './watchdog';

/** A watchdog on a manual clock. */
function setup() {
  let t = 0;
  const onStall = vi.fn();
  const wd = new Watchdog({ onStall, timeoutMs: 1000, now: () => t });
  wd.start();
  wd.stop(); // checks are driven manually
  return { wd, onStall, advance: (ms: number) => { t += ms; } };
}

describe('Watchdog', () => {
  it('does not fire before the first heartbeat (slow worker start-up)', () => {
    const { wd, onStall, advance } = setup();
    advance(5000);
    wd.check();
    expect(onStall).not.toHaveBeenCalled();
  });

  it('fires once after silence following a heartbeat', () => {
    const { wd, onStall, advance } = setup();
    wd.beat();
    advance(500);
    wd.check();
    expect(onStall).not.toHaveBeenCalled();
    advance(600);
    wd.check();
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('waits for the next heartbeat after disarm (respawn)', () => {
    const { wd, onStall, advance } = setup();
    wd.beat();
    wd.disarm();
    advance(5000);
    wd.check();
    expect(onStall).not.toHaveBeenCalled();
    wd.beat();
    advance(1500);
    wd.check();
    expect(onStall).toHaveBeenCalledTimes(1);
  });
});
