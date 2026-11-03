/**
 * App commands: the actions of the menu bar (App, File, View, MCP). The native menu
 * (`src-tauri/src/menu.rs`) emits these ids; in the browser the subset in
 * `WEB_SHORTCUTS` is reachable by keyboard. Ids MUST match the Rust side.
 */
import type { KeyBinding } from '~/utils/shortcuts/key-binding';

/** Prefix of "Open Recent" entries: `recent:<project id>`. */
export const RECENT_PREFIX = 'recent:';

/** What the commands act on; provided by `useAppMenu`. */
export interface AppCommandContext {
  /** Id of the open project, `null` outside a project. */
  projectId(): string | null;
  navigate(path: string): void;
  /** Shows the "New project" dialog. */
  newProject(): void;
  /** File → Open: import a `.pmproject`. */
  openFile(): Promise<void>;
  /** File → Save: push a snapshot of the open project now. */
  save(): void;
  /** File → Export: save the open project as `.pmproject`. */
  exportFile(): Promise<void>;
  clearRecent(): void;
  /** App → Settings… / MCP → MCP Server Setup…: opens the Settings dialog. */
  openSettings(section: 'mcp' | null): void;
  /** MCP → Copy …: copies a setup snippet for the given client. */
  copyMcpSetup(client: 'claude-code' | 'claude-desktop'): Promise<void>;
}

/** Commands that need an open project, keyed by id. */
const PROJECT_VIEWS: Record<string, string> = {
  'view.design': '',
  'view.live': '/live',
  'view.connections': '/connections',
};

/** Runs the command with this id. Returns `false` for unknown ids. */
export function runAppCommand(id: string, ctx: AppCommandContext): boolean {
  if (id.startsWith(RECENT_PREFIX)) {
    ctx.navigate(`/project/${id.slice(RECENT_PREFIX.length)}`);
    return true;
  }
  const projectId = ctx.projectId();
  if (id in PROJECT_VIEWS) {
    if (projectId) ctx.navigate(`/project/${projectId}${PROJECT_VIEWS[id]}`);
    return true;
  }
  switch (id) {
    case 'file.new': ctx.newProject(); return true;
    case 'file.open': void ctx.openFile(); return true;
    case 'file.save': if (projectId) ctx.save(); return true;
    case 'file.export': if (projectId) void ctx.exportFile(); return true;
    case 'view.projects': ctx.navigate('/'); return true;
    case 'recent.clear': ctx.clearRecent(); return true;
    case 'app.settings': ctx.openSettings(null); return true;
    case 'mcp.setup': ctx.openSettings('mcp'); return true;
    case 'mcp.copy-claude-code': void ctx.copyMcpSetup('claude-code'); return true;
    case 'mcp.copy-claude-desktop': void ctx.copyMcpSetup('claude-desktop'); return true;
    default: return false;
  }
}

/**
 * Keyboard shortcuts in the browser (⌘/Ctrl). Only keys browsers let pages
 * take over; ⌘N and ⌘1–3 stay with the browser. ⌘S is bound by the editor
 * pages themselves. In the desktop app the menu shows the same keys.
 */
export const WEB_SHORTCUTS = [
  { keys: [{ key: 'o', mod: true }], label: 'Open…', command: 'file.open' },
  { keys: [{ key: 'e', mod: true, shift: true }], label: 'Export…', command: 'file.export' },
  { keys: [{ key: ',', mod: true }], label: 'Settings…', command: 'app.settings' },
] satisfies { keys: KeyBinding[]; label: string; command: string }[];
