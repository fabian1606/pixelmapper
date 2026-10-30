/**
 * Legacy custom fixture migration across tabs: two tabs starting at once
 * must migrate the localStorage list exactly once (Web Locks, or the
 * synchronous claim fallback).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { OflFixture } from '~/utils/ofl/types';
import {
  LEGACY_CUSTOM_FIXTURES_KEY,
  LEGACY_MIGRATION_CLAIM_KEY,
  migrateLegacyCustomFixtures,
} from './custom-fixture-legacy-migration';
import type { CustomFixtureData, CustomFixtureSink, MigrationLockManager } from './custom-fixture-legacy-migration';

/** Sink that records written entries after a short async write. */
function sink(): CustomFixtureSink & { written: CustomFixtureData[] } {
  const written: CustomFixtureData[] = [];
  return {
    written,
    async putMany(entries) {
      await new Promise(r => setTimeout(r, 5));
      written.push(...entries.map(e => e.data));
      return entries.map(() => crypto.randomUUID());
    },
  };
}

/** Exclusive in-process lock manager mimicking `navigator.locks`. */
function fakeLocks(): MigrationLockManager {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request<T>(name: string, callback: () => Promise<T>): Promise<T> {
      const prev = tails.get(name) ?? Promise.resolve();
      const next = prev.then(callback, callback);
      tails.set(name, next.catch(() => {}));
      return next;
    },
  };
}

const legacy = JSON.stringify([
  { id: 'custom-1', name: 'Foo', ofl: { name: 'Foo' } as OflFixture, createdAt: 1 },
  { id: 'custom-2', name: 'Bar', ofl: { name: 'Bar' } as OflFixture, createdAt: 2 },
]);

beforeEach(() => { localStorage.clear(); });

describe('migrateLegacyCustomFixtures across tabs', () => {
  it('migrates once when two tabs start together (Web Locks)', async () => {
    localStorage.setItem(LEGACY_CUSTOM_FIXTURES_KEY, legacy);
    const locks = fakeLocks();
    const tab1 = sink();
    const tab2 = sink();
    const counts = await Promise.all([
      migrateLegacyCustomFixtures(tab1, { locks }),
      migrateLegacyCustomFixtures(tab2, { locks }),
    ]);
    expect(counts.sort()).toEqual([0, 2]);
    expect(tab1.written.length + tab2.written.length).toBe(2);
    expect(localStorage.getItem(LEGACY_CUSTOM_FIXTURES_KEY)).toBeNull();
  });

  it('migrates once without Web Locks (synchronous claim)', async () => {
    localStorage.setItem(LEGACY_CUSTOM_FIXTURES_KEY, legacy);
    const tab1 = sink();
    const tab2 = sink();
    const counts = await Promise.all([
      migrateLegacyCustomFixtures(tab1, { locks: null }),
      migrateLegacyCustomFixtures(tab2, { locks: null }),
    ]);
    expect(counts).toEqual([2, 0]);
    expect(tab2.written).toEqual([]);
    expect(localStorage.getItem(LEGACY_CUSTOM_FIXTURES_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_MIGRATION_CLAIM_KEY)).toBeNull();
  });

  it('takes over a stale claim of a crashed tab, but not a fresh one', async () => {
    localStorage.setItem(LEGACY_MIGRATION_CLAIM_KEY, JSON.stringify({ at: 1_000, raw: legacy }));
    const fresh = sink();
    expect(await migrateLegacyCustomFixtures(fresh, { locks: null, now: () => 2_000 })).toBe(0);
    const late = sink();
    expect(await migrateLegacyCustomFixtures(late, { locks: null, now: () => 120_000 })).toBe(2);
    expect(localStorage.getItem(LEGACY_MIGRATION_CLAIM_KEY)).toBeNull();
  });

  it('keeps invalid JSON in place (fallback)', async () => {
    localStorage.setItem(LEGACY_CUSTOM_FIXTURES_KEY, '{broken');
    expect(await migrateLegacyCustomFixtures(sink(), { locks: null })).toBe(0);
    expect(localStorage.getItem(LEGACY_CUSTOM_FIXTURES_KEY)).toBe('{broken');
  });
});
