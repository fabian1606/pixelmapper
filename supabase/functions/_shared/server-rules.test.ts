// Run with: bun test supabase/functions/_shared
// Pure server rules: DB error mapping and the create-project decision.
import { describe, expect, test } from 'bun:test';
import { statusForDbError } from './db-errors.ts';
import { ORPHAN_AGE_MS, planExistingProject, PROJECT_BEING_CREATED, type ExistingProjectFacts } from './create-project-plan.ts';
import { LOADABLE_SNAPSHOT_FILTER, SAFETY_SNAPSHOT_LABEL } from './snapshots.ts';

describe('statusForDbError', () => {
  test('maps the SQLSTATEs raised by the 009 RPCs', () => {
    expect(statusForDbError({ code: '28000', message: '' })).toBe(401);
    expect(statusForDbError({ code: '42501', message: '' })).toBe(403);
    expect(statusForDbError({ code: 'P0002', message: '' })).toBe(404);
    expect(statusForDbError({ code: '22023', message: '' })).toBe(400);
    expect(statusForDbError({ code: '22P02', message: '' })).toBe(400);
    expect(statusForDbError({ code: '23505', message: '' })).toBe(409);
  });
  test('anything else is a server error', () => {
    expect(statusForDbError({ code: '40001', message: '' })).toBe(500);
    expect(statusForDbError({ message: 'x' })).toBe(500);
    expect(statusForDbError(null)).toBe(500);
  });
});

describe('planExistingProject', () => {
  const ME = 'u-me';
  const base: ExistingProjectFacts = {
    callerId: ME,
    ownerIds: [ME],
    collaboratorCount: 1,
    createdBy: ME,
    ageMs: 5_000,
    snapshotSupplied: true,
    headSequence: 0,
  };

  test('own project without changes: store the supplied (newer) snapshot', () => {
    expect(planExistingProject(base)).toEqual({ kind: 'owned', adopt: false, storeSnapshot: true });
  });
  test('own project, legacy create without snapshot: just return it', () => {
    expect(planExistingProject({ ...base, snapshotSupplied: false })).toEqual({ kind: 'owned', adopt: false, storeSnapshot: false });
  });
  test('own project that has changes already: 409 instead of binding a diverged base', () => {
    expect(planExistingProject({ ...base, headSequence: 7 }).kind).toBe('conflict');
  });
  test('owned by someone else: 409', () => {
    expect(planExistingProject({ ...base, ownerIds: ['u-other'] })).toEqual({ kind: 'conflict', error: 'project id already in use' });
  });
  test('no owner row yet and young: 503 retry (concurrent create in flight)', () => {
    expect(planExistingProject({ ...base, ownerIds: [], collaboratorCount: 0 }))
      .toEqual({ kind: 'retry', error: PROJECT_BEING_CREATED });
  });
  test('old orphan created by the caller: adopt it', () => {
    expect(planExistingProject({ ...base, ownerIds: [], collaboratorCount: 0, ageMs: ORPHAN_AGE_MS }))
      .toEqual({ kind: 'owned', adopt: true, storeSnapshot: true });
  });
  test('old orphan of someone else or of unknown creator: 409', () => {
    const orphan = { ...base, ownerIds: [], collaboratorCount: 0, ageMs: ORPHAN_AGE_MS * 2 };
    expect(planExistingProject({ ...orphan, createdBy: 'u-other' }).kind).toBe('conflict');
    expect(planExistingProject({ ...orphan, createdBy: null }).kind).toBe('conflict');
  });
  test('collaborators without an owner: 409', () => {
    expect(planExistingProject({ ...base, ownerIds: [], collaboratorCount: 2 }).kind).toBe('conflict');
  });
});

describe('LOADABLE_SNAPSHOT_FILTER', () => {
  test('keeps unlabelled snapshots and excludes the safety label', () => {
    expect(LOADABLE_SNAPSHOT_FILTER).toBe(`label.is.null,label.neq."${SAFETY_SNAPSHOT_LABEL}"`);
  });
});
