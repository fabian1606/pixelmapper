/**
 * Desktop app shell: the native menu of `src-tauri/src/menu.rs` and the
 * native file dialogs of `src-tauri/src/files.rs`.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AppShell } from '../app-shell';

/** Event emitted by the backend for every menu click (payload = item id). */
const MENU_EVENT = 'app-menu';

/** Event emitted by `src-tauri/src/lifecycle.rs` on close/quit (payload `close` | `exit`). */
const BEFORE_QUIT_EVENT = 'app-before-quit';

/** Max wait for the quit handlers (the backend force-quits after 5 s). */
export const QUIT_FLUSH_TIMEOUT_MS = 3000;

/** Handlers run before quitting (module-level: `getAppShell()` creates new shells). */
const quitHandlers = new Set<() => Promise<void>>();
/** Whether the `app-before-quit` listener is installed. */
let quitListening = false;

/** Runs all handlers in parallel; resolves when all settled or after `timeoutMs`. */
export async function runQuitHandlers(handlers: Iterable<() => Promise<void>>, timeoutMs: number): Promise<void> {
  const all = Promise.allSettled([...handlers].map(h => Promise.resolve().then(h)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
  try {
    await Promise.race([all, timeout]);
  }
  finally {
    clearTimeout(timer);
  }
}

/** Installs the quit listener once: flush, then let the backend close/exit. */
function listenForQuit(): void {
  if (quitListening) return;
  quitListening = true;
  void listen<string>(BEFORE_QUIT_EVENT, async (e) => {
    try {
      await runQuitHandlers(quitHandlers, QUIT_FLUSH_TIMEOUT_MS);
    }
    catch (err) {
      console.warn('[app-shell] quit handlers failed:', err);
    }
    await invoke('app_quit_ready', { mode: e.payload }).catch(warn('app_quit_ready'));
  }).catch((err) => {
    quitListening = false;
    console.warn('[app-shell] listening for quit failed:', err);
  });
}

/** Logs failed fire-and-forget menu updates. */
function warn(what: string) {
  return (e: unknown) => console.warn(`[app-shell] ${what} failed:`, e);
}

/** Creates the desktop app shell. */
export function createTauriAppShell(): AppShell {
  return {
    nativeMenu: true,
    onMenuCommand(handler) {
      const unlisten = listen<string>(MENU_EVENT, e => handler(e.payload));
      return () => { void unlisten.then(off => off()); };
    },
    setRecentProjects(projects) {
      invoke('menu_set_recent', { projects }).catch(warn('menu_set_recent'));
    },
    setProjectOpen(open) {
      invoke('menu_set_project_open', { open }).catch(warn('menu_set_project_open'));
    },
    async saveProjectFile(bytes, fileName) {
      return invoke<boolean>('save_project_file', bytes, {
        headers: { 'x-file-name': encodeURIComponent(fileName) },
      });
    },
    async openProjectFile() {
      const buf = await invoke<ArrayBuffer>('open_project_file');
      return buf.byteLength ? { bytes: new Uint8Array(buf) } : null;
    },
    onBeforeQuit(handler) {
      quitHandlers.add(handler);
      listenForQuit();
      return () => { quitHandlers.delete(handler); };
    },
  };
}
