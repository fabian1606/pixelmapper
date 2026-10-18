/**
 * Desktop app shell: the native menu of `src-tauri/src/menu.rs` and the
 * native file dialogs of `src-tauri/src/files.rs`.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AppShell } from '../app-shell';

/** Event emitted by the backend for every menu click (payload = item id). */
const MENU_EVENT = 'app-menu';

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
  };
}
