// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleRestoreMarker,
  isRemoteRestorePending,
  isRestoreMarker,
  resetRemoteRestoreState,
  RESTORE_MARKER_TYPE,
  runLocalRestore,
  setRemoteRestoreHandler,
} from '~/utils/sync/remote-restore';

/** Let the scheduled macrotask (and its promise chain) run. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
}

afterEach(() => resetRemoteRestoreState());

describe('remote restore markers', () => {
  it('ignores other change types', () => {
    const handler = vi.fn(async () => {});
    setRemoteRestoreHandler(handler);
    expect(isRestoreMarker('SetModifiers')).toBe(false);
    expect(handleRestoreMarker('SetModifiers')).toBe(false);
    expect(isRemoteRestorePending()).toBe(false);
  });

  it('schedules one reload per burst of markers and blocks snapshots until it finished', async () => {
    let finish!: () => void;
    const handler = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    setRemoteRestoreHandler(handler);

    expect(handleRestoreMarker(RESTORE_MARKER_TYPE)).toBe(true);
    expect(handleRestoreMarker(RESTORE_MARKER_TYPE)).toBe(true);
    // Deferred: never runs inside the caller (sync cycle holds the engine lock).
    expect(handler).not.toHaveBeenCalled();
    expect(isRemoteRestorePending()).toBe(true);

    await settle();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(isRemoteRestorePending()).toBe(true);
    finish();
    await settle();
    expect(isRemoteRestorePending()).toBe(false);
  });

  it("the echo of this client's own restore does not reload twice", async () => {
    const handler = vi.fn(async () => {});
    setRemoteRestoreHandler(handler);
    await runLocalRestore(async () => {
      expect(handleRestoreMarker(RESTORE_MARKER_TYPE)).toBe(true);
    });
    await settle();
    expect(handler).not.toHaveBeenCalled();
    // Afterwards, a collaborator's restore reloads again.
    handleRestoreMarker(RESTORE_MARKER_TYPE);
    await settle();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a failing reload clears the pending flag', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setRemoteRestoreHandler(async () => { throw new Error('offline'); });
    handleRestoreMarker(RESTORE_MARKER_TYPE);
    await settle();
    expect(isRemoteRestorePending()).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
