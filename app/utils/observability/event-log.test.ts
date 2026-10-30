// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createEventLog, eventLog } from './event-log';
import { useHistory, type Command } from '~/components/engine/composables/use-history';
import { CompositeCommand } from '~/components/engine/commands/composite-command';

describe('event log ring buffer', () => {
  it('evicts the oldest entries beyond its capacity', () => {
    const log = createEventLog(3);
    for (let i = 1; i <= 5; i++) log.append({ actor: 'user', kind: 'test', code: `c${i}`, message: `m${i}` });
    const entries = log.list();
    expect(entries.map(e => e.code)).toEqual(['c3', 'c4', 'c5']);
    expect(entries.map(e => e.id)).toEqual([3, 4, 5]);
    expect(log.lastId()).toBe(5);
  });

  it('filters by kind prefix, actor, sinceId and limit', () => {
    const log = createEventLog();
    log.append({ actor: 'user', kind: 'command.execute', code: 'A', message: '' });
    log.append({ actor: 'agent:x', kind: 'command.undo', code: 'B', message: '' });
    log.append({ actor: 'agent:x', kind: 'operation', code: 'C', message: '' });
    expect(log.list({ kind: 'command' }).map(e => e.code)).toEqual(['A', 'B']);
    expect(log.list({ actor: 'agent:x' }).map(e => e.code)).toEqual(['B', 'C']);
    expect(log.list({ sinceId: 2 }).map(e => e.code)).toEqual(['C']);
    expect(log.list({ limit: 1 }).map(e => e.code)).toEqual(['C']);
  });

  it('notifies subscribers', () => {
    const log = createEventLog();
    const seen: string[] = [];
    const off = log.subscribe(e => seen.push(e.code));
    log.append({ actor: 'user', kind: 'k', code: 'x', message: '' });
    off();
    log.append({ actor: 'user', kind: 'k', code: 'y', message: '' });
    expect(seen).toEqual(['x']);
  });
});

describe('history logs execute / undo with actor', () => {
  /** Plain local command. */
  const command = (label: string): Command => ({ description: label, execute() {}, undo() {} });

  it('records the default user actor and an explicit actor', () => {
    const history = useHistory();
    const since = eventLog.lastId();
    history.execute(command('by user'));
    history.execute(command('by agent'), { actor: 'agent:copilot' });
    history.undo();
    history.redo({ actor: 'agent:copilot' });
    const events = eventLog.list({ sinceId: since });
    // Undo/redo are attributed to whoever triggers them (default: the user).
    expect(events.map(e => [e.kind, e.actor, e.message])).toEqual([
      ['command.execute', 'user', 'by user'],
      ['command.execute', 'agent:copilot', 'by agent'],
      ['command.undo', 'user', 'by agent'],
      ['command.redo', 'agent:copilot', 'by agent'],
    ]);
  });

  it('uses the composite actor, command type and group id; `applied` skips execution', () => {
    const history = useHistory();
    const since = eventLog.lastId();
    let runs = 0;
    const child: Command = { description: 'child', execute: () => { runs++; }, undo() {} };
    const group = new CompositeCommand([child], 'AI: test', 'agent:mcp');
    history.execute(group, { applied: true });
    expect(runs).toBe(0);
    const [entry] = eventLog.list({ sinceId: since });
    expect(entry).toMatchObject({ kind: 'command.execute', code: 'Composite', actor: 'agent:mcp', undoGroupId: group.id });
    history.undo();
    history.redo();
    expect(runs).toBe(1);
  });
});
