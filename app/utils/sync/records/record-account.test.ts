/**
 * Account handling of the user record sync: offline cold start (auth event
 * without session), records written before the account is known, pending
 * counts before a web logout, and account switches during a running round.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeRecordServer, useFreshDevice } from './fake-record-remote';
import type { FakeRecordServer } from './fake-record-remote';
import { getRecord, listRecords, putRecords } from './record-db';
import { createRecordCollection } from './record-collection';
import {
  clearForeignRecords,
  clearLocalRecords,
  configureRecordRemote,
  countPendingRecords,
  getRecordUser,
  resetRecordSessionForTests,
  setRecordUser,
} from './record-session';
import { bindRecordUserToAuth } from './record-auth-binding';
import type { AuthEventSession } from '~/utils/auth/auth-event-user';
import type { PullCursor, UserRecordRow } from './types';
import { reportNetworkSuccess } from '../connectivity';

const KIND = 'account-kind';
const A = 'user-a';
const B = 'user-b';

interface Note { text: string }

let server: FakeRecordServer;

/** A collection without timer-driven rounds. */
async function notes() {
  const c = createRecordCollection<Note>(KIND, { debounceMs: 60_000 });
  await c.ready;
  return c;
}

/** Fake `supabase.auth`: emits events on demand, stores a session like auth-js. */
function fakeAuth(storedUserId: string | null) {
  let listener: ((event: string, session: AuthEventSession | null) => void) | null = null;
  return {
    storageKey: 'sb-test-auth-token',
    storage: {
      getItem: async () => (storedUserId ? JSON.stringify({ access_token: 'expired', user: { id: storedUserId } }) : null),
    },
    onAuthStateChange(cb: (event: string, session: AuthEventSession | null) => void) { listener = cb; },
    emit(event: string, session: AuthEventSession | null) { listener?.(event, session); },
  };
}

/** A server row of `userId`. */
function row(id: string, userId: string, text: string): UserRecordRow {
  const at = new Date().toISOString();
  return { id, user_id: userId, kind: KIND, data: { text }, updated_at: at, deleted_at: null, server_updated_at: at };
}

beforeEach(async () => {
  await useFreshDevice();
  server = createFakeRecordServer();
  configureRecordRemote(server);
  reportNetworkSuccess();
});

afterEach(() => {
  resetRecordSessionForTests();
});

// ── Defect 2 / C: offline cold start ─────────────────────────────────────────

describe('bindRecordUserToAuth', () => {
  it('keeps the cached account on an offline INITIAL_SESSION without session', async () => {
    const auth = fakeAuth(A);
    const seen: Array<string | null> = [];
    const idle = bindRecordUserToAuth(auth, async (id) => { seen.push(id); });
    auth.emit('INITIAL_SESSION', null);
    await idle();
    expect(seen).toEqual([A]);
  });

  it('reports null only on a real SIGNED_OUT', async () => {
    const auth = fakeAuth(A);
    const seen: Array<string | null> = [];
    const idle = bindRecordUserToAuth(auth, async (id) => { seen.push(id); });
    auth.emit('SIGNED_IN', { user: { id: B } });
    auth.emit('SIGNED_OUT', null);
    await idle();
    expect(seen).toEqual([B, null]);
  });

  it('defers the callback (never calls back inside the auth event)', async () => {
    const auth = fakeAuth(A);
    const seen: Array<string | null> = [];
    const idle = bindRecordUserToAuth(auth, async (id) => { seen.push(id); });
    auth.emit('SIGNED_IN', { user: { id: A } });
    expect(seen).toEqual([]);
    await idle();
    expect(seen).toEqual([A]);
  });

  it('records saved after an offline cold start belong to the cached account', async () => {
    server.offline = true;
    const auth = fakeAuth(A);
    const idle = bindRecordUserToAuth(auth, setRecordUser);
    auth.emit('INITIAL_SESSION', null);
    await idle();
    expect(getRecordUser()).toBe(A);
    const c = await notes();
    const id = await c.put({ text: 'offline save' });
    expect((await getRecord(id))?.ownerUserId).toBe(A);
    expect(await countPendingRecords(A)).toBe(1);
  });
});

// ── Defect 2: records written before the account is known ────────────────────

describe('records written while the account is unknown', () => {
  it('are adopted by the account resolved afterwards and uploaded', async () => {
    const c = await notes();
    const id = await c.put({ text: 'migrated before auth' });
    expect((await getRecord(id))?.ownerUserId).toBeNull();
    await setRecordUser(A);
    expect((await getRecord(id))?.ownerUserId).toBe(A);
    expect(server.rows.get(id)?.user_id).toBe(A);
  });

  it('also covers bulk writes (legacy migration via putMany)', async () => {
    const c = await notes();
    const ids = await c.putMany([{ data: { text: '1' } }, { data: { text: '2' } }]);
    await setRecordUser(A);
    for (const id of ids) expect((await getRecord(id))?.ownerUserId).toBe(A);
  });

  it('stay local-only when the first resolution is "signed out"', async () => {
    const c = await notes();
    const id = await c.put({ text: 'local' });
    await setRecordUser(null);
    await setRecordUser(A);
    expect((await getRecord(id))?.ownerUserId).toBeNull();
    expect(server.rows.size).toBe(0);
  });
});

// ── Defect 2: pending count before a web logout ──────────────────────────────

describe('countPendingRecords', () => {
  it('counts local-only records, which clearLocalRecords would delete', async () => {
    await setRecordUser(A);
    await putRecords([{ id: 'orphan', kind: KIND, data: {}, updatedAt: 1, deletedAt: null, dirty: true, ownerUserId: null }]);
    expect(await countPendingRecords(A)).toBe(1);
  });

  it('ignores dirty records of other accounts', async () => {
    await setRecordUser(A);
    await putRecords([{ id: 'other', kind: KIND, data: {}, updatedAt: 1, deletedAt: null, dirty: true, ownerUserId: B }]);
    expect(await countPendingRecords(A)).toBe(0);
  });
});

// ── clearForeignRecords ─────────────────────────────────────────────────────

describe('clearForeignRecords', () => {
  it('removes synced copies of other accounts and keeps their unsynced changes', async () => {
    await setRecordUser(A);
    const rec = (id: string, ownerUserId: string | null, dirty: boolean) =>
      ({ id, kind: KIND, data: {}, updatedAt: 1, deletedAt: null, dirty, ownerUserId });
    await putRecords([
      rec('b-clean', B, false),
      rec('b-dirty', B, true),
      rec('a-clean', A, false),
      rec('a-dirty', A, true),
      rec('local', null, true),
    ]);
    expect(await clearForeignRecords(A)).toEqual({ removed: 1, keptDirty: 1 });
    expect((await listRecords()).map(r => r.id).sort()).toEqual(['a-clean', 'a-dirty', 'b-dirty', 'local']);
  });
});

// ── Defect 5: account switch during a pull ───────────────────────────────────

describe('account switch during a running round', () => {
  it('does not file rows pulled for A under A after switching to B', async () => {
    await setRecordUser(A);
    const c = await notes();
    await c.whenIdle();
    server.rows.set('a-row', row('a-row', A, 'from A'));

    // Hold A's pull until the account has switched; pulls honour "RLS".
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pullPage = server.pullPage.bind(server);
    let serverUser = A;
    let held = false;
    server.pullPage = async (kind: string, after: PullCursor | null, limit: number) => {
      const asUser = serverUser;
      const rows = (await pullPage(kind, after, limit)).filter(r => r.user_id === asUser);
      if (!held) { held = true; await gate; }
      return rows;
    };

    const round = c.syncNow();
    await new Promise(r => setTimeout(r, 0));
    serverUser = B;
    const switched = setRecordUser(B);
    release();
    await round;
    await switched;
    server.pullPage = pullPage;

    // A's row arrived after the switch: not written (neither as A's nor B's).
    expect(await getRecord('a-row')).toBeUndefined();
    expect(c.get('a-row')).toBeUndefined();
    expect(c.status.value).toBe('idle');
  });

  it('setRecordUser waits for the running round before resolving', async () => {
    await setRecordUser(A);
    const c = await notes();
    await c.whenIdle();
    server.rows.set('a-row', row('a-row', A, 'from A'));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pullPage = server.pullPage.bind(server);
    server.pullPage = async (kind: string, after: PullCursor | null, limit: number) => {
      await gate;
      return pullPage(kind, after, limit);
    };
    const round = c.syncNow();
    let done = false;
    const switched = setRecordUser(null).then(() => { done = true; });
    await new Promise(r => setTimeout(r, 10));
    expect(done).toBe(false);
    release();
    await Promise.all([round, switched]);
    // The aborted round wrote nothing after the switch.
    expect(await getRecord('a-row')).toBeUndefined();
  });

  it('a round running into clearLocalRecords writes nothing back', async () => {
    await setRecordUser(A);
    const c = await notes();
    await c.whenIdle();
    server.rows.set('a-row', row('a-row', A, 'from A'));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pullPage = server.pullPage.bind(server);
    server.pullPage = async (kind: string, after: PullCursor | null, limit: number) => {
      await gate;
      return pullPage(kind, after, limit);
    };
    const round = c.syncNow();
    const cleared = clearLocalRecords();
    release();
    await Promise.all([round, cleared]);
    expect(await listRecords()).toEqual([]);
  });
});
