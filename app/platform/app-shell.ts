/**
 * App shell of the running platform (host-only, ADR 0003): the native menu
 * bar and project file dialogs. Each `#platform` entry exports a
 * `getAppShell()` returning this shape.
 *
 * Desktop: a native menu (`src-tauri/src/menu.rs`) and native dialogs.
 * Web: no menu (keyboard shortcuts only), download / file input instead.
 */

/** One "Open Recent" entry. */
export interface RecentProject {
  id: string;
  name: string;
}

/** A file the user picked. */
export interface PickedFile {
  bytes: Uint8Array;
  /** File name if the platform knows it (fallback name for imports). */
  name?: string;
}

export interface AppShell {
  /** Whether a native menu bar shows the app commands. */
  readonly nativeMenu: boolean;
  /** Subscribes to menu clicks (payload = command id); returns an unsubscribe. */
  onMenuCommand(handler: (id: string) => void): () => void;
  /** Shows these projects under File → Open Recent (most recent first). */
  setRecentProjects(projects: RecentProject[]): void;
  /** Enables the menu items that need an open project. */
  setProjectOpen(open: boolean): void;
  /** Saves a `.pmproject`; resolves `false` if the user cancelled. */
  saveProjectFile(bytes: Uint8Array, fileName: string): Promise<boolean>;
  /** Lets the user pick a `.pmproject`; `null` if cancelled. */
  openProjectFile(): Promise<PickedFile | null>;
  /**
   * Runs `handler` before the desktop window closes / the app quits and waits
   * for it (bounded by a timeout) so pending local writes can finish.
   * Web: no-op (the browser offers no such hook beyond `beforeunload`).
   * Returns an unsubscribe.
   */
  onBeforeQuit(handler: () => Promise<void>): () => void;
}
