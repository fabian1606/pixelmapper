/**
 * App commands (menu bar) and the "Open Recent" list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAppCommand, type AppCommandContext } from './app-commands';
import { clearRecentProjects, loadRecentProjects, MAX_RECENT, recentProjects, recordProjectOpened, syncRecentNames } from './recent-projects';

/** A context with spies; `project` is the open project id. */
function context(project: string | null) {
  return {
    projectId: () => project,
    navigate: vi.fn(),
    newProject: vi.fn(),
    openFile: vi.fn(async () => {}),
    save: vi.fn(),
    exportFile: vi.fn(async () => {}),
    clearRecent: vi.fn(),
    openSettings: vi.fn(),
    copyMcpSetup: vi.fn(async () => {}),
  } satisfies AppCommandContext;
}

describe('runAppCommand', () => {
  it('switches project views only inside a project', () => {
    const inside = context('p1');
    runAppCommand('view.live', inside);
    runAppCommand('view.design', inside);
    expect(inside.navigate.mock.calls).toEqual([['/project/p1/live'], ['/project/p1']]);

    const outside = context(null);
    expect(runAppCommand('view.connections', outside)).toBe(true);
    expect(outside.navigate).not.toHaveBeenCalled();
  });

  it('saves and exports only with an open project', () => {
    const outside = context(null);
    runAppCommand('file.save', outside);
    runAppCommand('file.export', outside);
    expect(outside.save).not.toHaveBeenCalled();
    expect(outside.exportFile).not.toHaveBeenCalled();

    const inside = context('p1');
    runAppCommand('file.save', inside);
    runAppCommand('file.export', inside);
    expect(inside.save).toHaveBeenCalledOnce();
    expect(inside.exportFile).toHaveBeenCalledOnce();
  });

  it('opens recent projects and rejects unknown ids', () => {
    const ctx = context(null);
    runAppCommand('recent:abc', ctx);
    expect(ctx.navigate).toHaveBeenCalledWith('/project/abc');
    expect(runAppCommand('nope', ctx)).toBe(false);
  });

  it('opens settings and the MCP setup, and copies MCP snippets, with or without a project', () => {
    const ctx = context(null);
    runAppCommand('app.settings', ctx);
    runAppCommand('mcp.setup', ctx);
    runAppCommand('mcp.copy-claude-code', ctx);
    runAppCommand('mcp.copy-claude-desktop', ctx);
    expect(ctx.openSettings.mock.calls).toEqual([[null], ['mcp']]);
    expect(ctx.copyMcpSetup.mock.calls).toEqual([['claude-code'], ['claude-desktop']]);
  });
});

describe('recent projects', () => {
  beforeEach(() => {
    localStorage.clear();
    clearRecentProjects();
  });

  it('keeps the most recent first, without duplicates, capped', () => {
    for (let i = 0; i < MAX_RECENT + 2; i++) recordProjectOpened(`p${i}`, `P${i}`);
    recordProjectOpened('p5');
    expect(recentProjects.value).toHaveLength(MAX_RECENT);
    expect(recentProjects.value[0]).toEqual({ id: 'p5', name: 'P5' });
    expect(recentProjects.value.filter(p => p.id === 'p5')).toHaveLength(1);
  });

  it('persists across loads and ignores invalid storage', () => {
    recordProjectOpened('a', 'A');
    recentProjects.value = [];
    loadRecentProjects();
    expect(recentProjects.value).toEqual([{ id: 'a', name: 'A' }]);

    localStorage.setItem('pm:recent-projects', '{broken');
    loadRecentProjects();
    expect(recentProjects.value).toEqual([]);
  });

  it('syncs names and drops deleted projects', () => {
    recordProjectOpened('gone');
    recordProjectOpened('kept');
    syncRecentNames([{ id: 'kept', name: 'Stage' }]);
    expect(recentProjects.value).toEqual([{ id: 'kept', name: 'Stage' }]);
  });
});
