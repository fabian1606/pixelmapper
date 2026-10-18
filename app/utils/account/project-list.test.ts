// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classifyLocal, mergeProjectList, projectActions, type ProjectListItem } from './project-list';
import { cloudMeta, head, meta } from './test-helpers';

// ── classifyLocal ────────────────────────────────────────────────────────────

describe('classifyLocal', () => {
  it('local-only projects are local regardless of the session', () => {
    expect(classifyLocal(meta('a'), null)).toBe('local');
    expect(classifyLocal(meta('a'), 'u1')).toBe('local');
  });

  it('cloud copies are cloud for their owner and foreign otherwise', () => {
    const m = cloudMeta('a', 'u1');
    expect(classifyLocal(m, 'u1')).toBe('cloud');
    expect(classifyLocal(m, 'u2')).toBe('foreign');
    expect(classifyLocal(m, null)).toBe('foreign');
  });
});

// ── mergeProjectList ─────────────────────────────────────────────────────────

describe('mergeProjectList', () => {
  it('adds uncached remote heads and sorts newest first', () => {
    const items = mergeProjectList({
      locals: [meta('loc', { updatedAt: Date.parse('2026-10-02T00:00:00Z') })],
      heads: [head('r1', { updatedAt: '2026-10-03T00:00:00Z', role: 'viewer' })],
      userId: 'u1',
      showForeign: false,
    });
    expect(items.map(i => i.id)).toEqual(['r1', 'loc']);
    expect(items[0]).toMatchObject({ kind: 'cloud', cached: false, role: 'viewer', ownerUserId: 'u1', pending: 0 });
    expect(items[1]).toMatchObject({ kind: 'local', cached: true, role: null, ownerUserId: null });
  });

  it('refreshes name/description/role of bound copies from the head and does not duplicate them', () => {
    const items = mergeProjectList({
      locals: [cloudMeta('p', 'u1', { name: 'Old', description: 'old', role: 'owner' })],
      heads: [head('p', { name: 'New', description: null, role: 'editor', latestChangeAt: '2026-10-05T00:00:00Z' })],
      userId: 'u1',
      pending: { p: 3 },
      showForeign: false,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'New', description: null, role: 'editor', pending: 3, cached: true });
    expect(items[0]!.updatedAt).toBe(Date.parse('2026-10-05T00:00:00Z'));
  });

  it('keeps the local name when the head carries none', () => {
    const items = mergeProjectList({
      locals: [cloudMeta('p', 'u1', { name: 'Local' })],
      heads: [head('p', { name: '' })],
      userId: 'u1',
      showForeign: false,
    });
    expect(items[0]!.name).toBe('Local');
  });

  it('hides foreign copies unless showForeign, and never applies heads to them', () => {
    const locals = [cloudMeta('f', 'u2', { name: 'Theirs', role: 'owner' })];
    const heads = [head('f', { name: 'Remote', role: 'viewer' })];
    const hidden = mergeProjectList({ locals, heads: [], userId: 'u1', showForeign: false });
    expect(hidden).toEqual([]);

    const shown = mergeProjectList({ locals, heads, userId: 'u1', showForeign: true });
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ kind: 'foreign', name: 'Theirs', role: null, ownerUserId: 'u2' });
  });

  it('works signed out without heads (bound copies are foreign)', () => {
    const items = mergeProjectList({
      locals: [meta('l'), cloudMeta('c', 'u1', { remoteDeletedAt: 5 })],
      heads: null,
      userId: null,
      showForeign: true,
    });
    expect(items.map(i => i.kind).sort()).toEqual(['foreign', 'local']);
    expect(items.find(i => i.id === 'c')!.remoteDeleted).toBe(true);
  });
});

// ── projectActions ───────────────────────────────────────────────────────────

/** List item with defaults. */
function item(over: Partial<ProjectListItem>): ProjectListItem {
  return {
    id: 'p', name: 'P', description: null, kind: 'cloud', role: 'owner', ownerUserId: 'u1',
    pending: 0, cached: true, remoteDeleted: false, updatedAt: null, ...over,
  };
}

describe('projectActions', () => {
  it('local: everything local, upload only when signed in', () => {
    const a = projectActions(item({ kind: 'local', role: null }), { online: false, signedIn: true });
    expect(a).toMatchObject({ rename: true, delete: true, deleteIsLocalOnly: true, detach: false, upload: true });
    expect(projectActions(item({ kind: 'local' }), { online: true, signedIn: false }).upload).toBe(false);
  });

  it('foreign: only local delete and detach', () => {
    const a = projectActions(item({ kind: 'foreign' }), { online: true, signedIn: true });
    expect(a).toMatchObject({ rename: false, delete: true, deleteIsLocalOnly: true, detach: true, upload: false });
    expect(a.disabledHint).toBeTruthy();
  });

  it('remote-deleted cloud copy: detach or remove locally', () => {
    const a = projectActions(item({ remoteDeleted: true }), { online: true, signedIn: true });
    expect(a).toMatchObject({ rename: false, deleteIsLocalOnly: true, detach: true });
    expect(a.disabledHint).toBe('Deleted on the server');
  });

  it('cloud owner: rename/delete need connectivity', () => {
    expect(projectActions(item({}), { online: true, signedIn: true }))
      .toMatchObject({ rename: true, delete: true, deleteIsLocalOnly: false, detach: true, disabledHint: null });
    const offline = projectActions(item({}), { online: false, signedIn: true });
    expect(offline).toMatchObject({ rename: false, delete: false });
    expect(offline.disabledHint).toMatch(/online/i);
  });

  it('cloud non-owner cannot rename/delete; detach only for cached copies', () => {
    const a = projectActions(item({ role: 'editor', cached: false }), { online: true, signedIn: true });
    expect(a).toMatchObject({ rename: false, delete: false, detach: false, disabledHint: null });
  });
});
