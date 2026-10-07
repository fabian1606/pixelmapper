/**
 * Extension commands replay from payloads and `activate` runs once (ADR
 * §5.8, D21).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Command, SerializableCommand } from '@pixelmapper/extension-api';
import { registerExtension, resetRegistry } from './registry';
import { installSharedGlobals } from './shared-globals';
import { commandFromPayload } from '~/components/engine/commands/serializable-command';

/** A counter command owned by the test extension. */
const state = { count: 0 };
class Bump implements SerializableCommand {
  readonly commandType = 'counter/bump';
  description = 'Bump';
  constructor(private by: number) {}
  execute() { state.count += this.by; }
  undo() { state.count -= this.by; }
  toPayload() { return { by: this.by }; }
}

beforeAll(() => {
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
});

beforeEach(() => {
  setActivePinia(createPinia());
  resetRegistry();
  installSharedGlobals();
  state.count = 0;
});

describe('extension activation', () => {
  it('registers commands for replay and calls activate once', () => {
    const activate = vi.fn();
    registerExtension({
      id: 'counter', version: '1.0.0', apiVersion: '^1.0.0', displayName: 'Counter', description: 'Test commands.',
      contributes: { commands: [{ type: 'counter/bump', fromPayload: p => new Bump((p as { by: number }).by) as Command }] },
      activate,
    });
    expect(activate).toHaveBeenCalledOnce();
    expect(activate.mock.calls[0]![0].extensionId).toBe('counter');

    const replayed = commandFromPayload('counter/bump', { by: 3 }, {} as never)!;
    replayed.execute();
    expect(state.count).toBe(3);
  });
});
