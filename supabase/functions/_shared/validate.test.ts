// Run with: bun test supabase/functions/_shared
// (Not part of the Vitest suite; this file is never imported by a function,
// so the Supabase CLI does not bundle it.)
import { describe, expect, test } from 'bun:test';
import {
  isUuid,
  parseCreateProject,
  parsePullChanges,
  parseSaveSnapshot,
  PULL_DEFAULT_LIMIT,
  PULL_MAX_LIMIT,
} from './validate.ts';

const ID = '3f2b8c1e-9a4d-4e1f-8b2a-0c6d7e8f9a0b';

describe('isUuid', () => {
  test('accepts canonical UUIDs in any case', () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid(ID.toUpperCase())).toBe(true);
  });
  test('rejects other values', () => {
    for (const v of ['', 'group-1', `${ID}x`, ID.replaceAll('-', ''), 42, null, undefined]) {
      expect(isUuid(v)).toBe(false);
    }
  });
});

describe('parsePullChanges', () => {
  test('applies the default limit', () => {
    expect(parsePullChanges({ projectId: ID, afterSequence: 0 }))
      .toEqual({ ok: true, value: { projectId: ID, afterSequence: 0, limit: PULL_DEFAULT_LIMIT } });
  });
  test('clamps the limit', () => {
    const r = parsePullChanges({ projectId: ID, afterSequence: 5, limit: 1_000_000 });
    expect(r.ok && r.value.limit).toBe(PULL_MAX_LIMIT);
  });
  test('rejects invalid input', () => {
    expect(parsePullChanges({ projectId: 'x', afterSequence: 0 }).ok).toBe(false);
    expect(parsePullChanges({ projectId: ID }).ok).toBe(false);
    expect(parsePullChanges({ projectId: ID, afterSequence: -1 }).ok).toBe(false);
    expect(parsePullChanges({ projectId: ID, afterSequence: 1.5 }).ok).toBe(false);
    expect(parsePullChanges({ projectId: ID, afterSequence: '3' }).ok).toBe(false);
    expect(parsePullChanges({ projectId: ID, afterSequence: 0, limit: 0 }).ok).toBe(false);
  });
});

describe('parseCreateProject', () => {
  test('legacy body { name, description }', () => {
    expect(parseCreateProject({ name: 'Show', description: 'd' })).toEqual({
      ok: true,
      value: { id: undefined, name: 'Show', description: 'd', snapshot: undefined, snapshotLabel: 'Uploaded' },
    });
  });
  test('client id is normalized to lower case; snapshot + label pass through', () => {
    const r = parseCreateProject({ name: 'Show', id: ID.toUpperCase(), snapshot: { version: 2 }, snapshotLabel: 'Local upload' });
    expect(r).toEqual({
      ok: true,
      value: { id: ID, name: 'Show', description: undefined, snapshot: { version: 2 }, snapshotLabel: 'Local upload' },
    });
  });
  test('rejects invalid input', () => {
    expect(parseCreateProject({}).ok).toBe(false);
    expect(parseCreateProject({ name: '  ' }).ok).toBe(false);
    expect(parseCreateProject({ name: 'a', id: 'not-a-uuid' }).ok).toBe(false);
    expect(parseCreateProject({ name: 'a', snapshot: [1] }).ok).toBe(false);
    expect(parseCreateProject({ name: 'a', snapshotLabel: 'x'.repeat(201) }).ok).toBe(false);
  });
});

describe('parseSaveSnapshot', () => {
  test('label is optional', () => {
    const r = parseSaveSnapshot({ projectId: ID, snapshot: {}, sequenceNumber: 0 });
    expect(r).toEqual({ ok: true, value: { projectId: ID, snapshot: {}, sequenceNumber: 0, label: null } });
  });
  test('keeps a label', () => {
    const r = parseSaveSnapshot({ projectId: ID, snapshot: {}, sequenceNumber: 12, label: 'before offline sync' });
    expect(r.ok && r.value.label).toBe('before offline sync');
  });
  test('rejects invalid input', () => {
    expect(parseSaveSnapshot({ projectId: ID, snapshot: {} }).ok).toBe(false);
    expect(parseSaveSnapshot({ projectId: ID, snapshot: null, sequenceNumber: 0 }).ok).toBe(false);
    expect(parseSaveSnapshot({ projectId: ID, snapshot: {}, sequenceNumber: -2 }).ok).toBe(false);
    expect(parseSaveSnapshot({ projectId: ID, snapshot: {}, sequenceNumber: 0, label: 3 }).ok).toBe(false);
  });
});
