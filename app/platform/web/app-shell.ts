/**
 * Web app shell: no menu bar (app commands are keyboard shortcuts only),
 * project files go through a download and a file input.
 */
import type { AppShell, PickedFile } from '../app-shell';
import { downloadBytes } from '~/utils/persistence/project-transfer';

/** Opens the browser's file picker for `.pmproject` files. */
function pickFile(): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pmproject,application/zip';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      resolve(file ? { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name } : null);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Creates the web app shell. */
export function createWebAppShell(): AppShell {
  return {
    nativeMenu: false,
    onMenuCommand: () => () => {},
    setRecentProjects: () => {},
    setProjectOpen: () => {},
    async saveProjectFile(bytes, fileName) {
      downloadBytes(bytes, fileName);
      return true;
    },
    openProjectFile: pickFile,
    // No quit hook on the web; `unload-handlers.ts` covers `beforeunload`.
    onBeforeQuit: () => () => {},
  };
}
