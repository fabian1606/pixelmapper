// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { clearHistory, useHistory, type Command } from './use-history';

/** Plain local command (not serializable: nothing is persisted). */
function command(label: string): Command {
  return { description: label, execute: vi.fn(), undo: vi.fn() };
}

describe('clearHistory', () => {
  it('drops undo and redo entries (project switch, sync rebase)', () => {
    const history = useHistory();
    const a = command('a');
    const b = command('b');
    history.execute(a);
    history.execute(b);
    history.undo();
    expect(history.canUndo.value).toBe(true);
    expect(history.canRedo.value).toBe(true);

    clearHistory();

    expect(history.canUndo.value).toBe(false);
    expect(history.canRedo.value).toBe(false);
    // Stale commands are never replayed afterwards.
    history.undo();
    history.redo();
    expect(a.undo).not.toHaveBeenCalled();
    expect(b.execute).toHaveBeenCalledTimes(1);
  });
});
