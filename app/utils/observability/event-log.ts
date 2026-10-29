/**
 * Event log (ADR 0002 D9, §6.5).
 *
 * A bounded ring buffer of attributed events: command execute/undo/redo,
 * operation runs, engine warnings, connector errors. Agents read it through
 * `inspect({ selector: 'events' })`; dev panels subscribe to it.
 */
import type { Actor } from '@pixelmapper/agent-kit';

export type { Actor } from '@pixelmapper/agent-kit';

// ── Types ───────────────────────────────────────

/** One logged event. */
export interface EventEntry {
  /** Monotonic id (unique per log). */
  id: number;
  /** Wall-clock time in ms (`Date.now()`). */
  t: number;
  actor: Actor;
  /** Category, e.g. `command.execute`, `command.undo`, `operation`, `engine`, `connector`. */
  kind: string;
  /** Machine code inside the kind, e.g. the command type `MoveFixture` or op id `modifiers.add`. */
  code: string;
  message: string;
  entityIds?: string[];
  /** History group the event belongs to (composite command id). */
  undoGroupId?: string;
}

/** Input of `append` (id and time are assigned by the log). */
export type EventInput = Omit<EventEntry, 'id' | 't'> & { t?: number };

/** Filter of `list`. */
export interface EventQuery {
  /** Only events with an id greater than this. */
  sinceId?: number;
  /** Kind or kind prefix (`command` matches `command.execute`). */
  kind?: string;
  actor?: Actor;
  undoGroupId?: string;
  /** Newest N matches (default: all). */
  limit?: number;
}

/** A ring-buffered event log. */
export interface EventLog {
  readonly capacity: number;
  append(event: EventInput): EventEntry;
  /** Matching events, oldest first. */
  list(query?: EventQuery): EventEntry[];
  /** Id of the newest event (0 when empty); use as `sinceId` cursor. */
  lastId(): number;
  clear(): void;
  /** Called for every appended event; returns an unsubscribe function. */
  subscribe(listener: (event: EventEntry) => void): () => void;
}

/** Default capacity (ADR §6.5). */
export const DEFAULT_EVENT_LOG_CAPACITY = 5000;

// ── Implementation ──────────────────────────────

/** Creates an event log keeping the newest `capacity` entries. */
export function createEventLog(capacity = DEFAULT_EVENT_LOG_CAPACITY): EventLog {
  const size = Math.max(1, Math.floor(capacity));
  // Fixed-size ring: `start` is the index of the oldest entry.
  const buffer: (EventEntry | undefined)[] = new Array(size);
  let start = 0;
  let count = 0;
  let nextId = 1;
  const listeners = new Set<(event: EventEntry) => void>();

  /** Entries oldest → newest. */
  function entries(): EventEntry[] {
    const out: EventEntry[] = [];
    for (let i = 0; i < count; i++) out.push(buffer[(start + i) % size]!);
    return out;
  }

  return {
    capacity: size,

    append(event) {
      const entry: EventEntry = { ...event, id: nextId++, t: event.t ?? Date.now() };
      if (count < size) {
        buffer[(start + count) % size] = entry;
        count++;
      }
      else {
        // Full: overwrite the oldest entry.
        buffer[start] = entry;
        start = (start + 1) % size;
      }
      for (const l of listeners) {
        try { l(entry); }
        catch (err) { console.warn('[event-log] listener failed:', err); }
      }
      return entry;
    },

    list(query = {}) {
      let out = entries().filter(e =>
        (query.sinceId === undefined || e.id > query.sinceId)
        && (query.kind === undefined || e.kind === query.kind || e.kind.startsWith(`${query.kind}.`))
        && (query.actor === undefined || e.actor === query.actor)
        && (query.undoGroupId === undefined || e.undoGroupId === query.undoGroupId));
      if (query.limit !== undefined) out = out.slice(Math.max(0, out.length - query.limit));
      return out;
    },

    lastId: () => nextId - 1,

    clear() {
      buffer.fill(undefined);
      start = 0;
      count = 0;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// ── App singleton ───────────────────────────────

/** The app-wide event log. */
export const eventLog: EventLog = createEventLog();

/** Appends to the app-wide event log. */
export function logEvent(event: EventInput): EventEntry {
  return eventLog.append(event);
}
