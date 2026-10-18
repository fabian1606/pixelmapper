/**
 * Recently opened projects (File → Open Recent), most recent first.
 *
 * Per device, kept in localStorage (a convenience: losing it loses nothing).
 * Names come from the project list (`get-projects`) and are refreshed with
 * `syncRecentNames`, which also drops projects that no longer exist.
 */
import { shallowRef } from 'vue';
import type { RecentProject } from '~/platform/app-shell';

/** localStorage key. */
const STORAGE_KEY = 'pm:recent-projects';
/** Entries kept in the menu. */
export const MAX_RECENT = 10;

/** The list; empty until `loadRecentProjects()` ran on the client. */
export const recentProjects = shallowRef<RecentProject[]>([]);

/** Writes the list; storage errors (private mode, quota) are ignored. */
function persist(list: RecentProject[]): void {
  recentProjects.value = list;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
  catch { /* per-device convenience only */ }
}

/** Reads the stored list (client only). Invalid data yields an empty list. */
export function loadRecentProjects(): void {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    recentProjects.value = Array.isArray(parsed)
      ? parsed.filter((p): p is RecentProject => typeof p?.id === 'string' && typeof p?.name === 'string').slice(0, MAX_RECENT)
      : [];
  }
  catch {
    recentProjects.value = [];
  }
}

/** Moves a project to the top. Keeps a known name when `name` is not given. */
export function recordProjectOpened(id: string, name?: string): void {
  const known = recentProjects.value.find(p => p.id === id);
  const entry = { id, name: name ?? known?.name ?? '' };
  persist([entry, ...recentProjects.value.filter(p => p.id !== id)].slice(0, MAX_RECENT));
}

/** Updates names from the project list and drops projects that are gone. */
export function syncRecentNames(projects: { id: string; name: string }[]): void {
  const names = new Map(projects.map(p => [p.id, p.name]));
  persist(recentProjects.value.filter(p => names.has(p.id)).map(p => ({ id: p.id, name: names.get(p.id)! })));
}

/** File → Open Recent → Clear Menu. */
export function clearRecentProjects(): void {
  persist([]);
}
