/**
 * File → Export / File → Open: `.pmproject` archives through the platform's
 * file dialogs (`AppShell`), on top of `project-transfer.ts`.
 */
import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { AppShell } from '~/platform/app-shell';
import { notify } from '~/composables/use-notifications';
import { exportProject, importArchive } from './project-transfer';
import { getAccountPolicy } from '#platform';
import { getProjectStore } from '~/utils/persistence/project-store';
import { createLocalProject } from '~/utils/account/local-projects';
import { createProject, type RemoteClient } from '~/utils/sync/remote-api';
import { newUuid } from '~/utils/ids';

/** The part of the Nuxt Supabase client used here (edge functions). */
type SupabaseClient = Pick<ReturnType<typeof useSupabaseClient>, 'functions'>;

/** Characters not allowed in file names on common systems. */
const UNSAFE_FILE_CHARS = /[\\/:*?"<>|]+/g;

/** Builds the archive and lets the user save it. Errors become notifications. */
export async function exportProjectFile(shell: AppShell, snapshot: ProjectSnapshot, name: string): Promise<void> {
  try {
    const { bytes, missingPlugins } = await exportProject(name, snapshot);
    const fileName = `${name.replace(UNSAFE_FILE_CHARS, '-').trim() || 'project'}.pmproject`;
    const saved = await shell.saveProjectFile(bytes, fileName);
    if (saved && missingPlugins.length) notify({ variant: 'warning', title: 'Export incomplete', description: `${missingPlugins.length} content plugin(s) were unavailable and are not included.` });
  }
  catch (err) {
    notify({ variant: 'error', title: 'Export failed', description: (err as Error).message });
  }
}

/**
 * Imports a `.pmproject`: verifies its plugins, caches its extension bundles
 * and creates a project from the snapshot. Returns the new project id.
 * Missing extensions are offered for install by the open gate later.
 *
 * Desktop: a local-only project (no server call, works offline). Web: a
 * cloud project with a client id and the snapshot as its initial server
 * snapshot, in one idempotent `create-project` call (ADR 0004 D11).
 */
export async function importProjectBytes(supabase: SupabaseClient, bytes: Uint8Array, fileName?: string): Promise<string> {
  const imported = await importArchive(bytes);
  const failed = Object.keys(imported.pluginErrors).length;
  if (failed) notify({ variant: 'warning', title: 'Some plugins could not be verified', description: `${failed} content plugin(s) were skipped.` });
  const name = imported.name || fileName?.replace(/\.pmproject$/, '') || 'Imported project';

  if (getAccountPolicy().importTarget === 'local') {
    const meta = await createLocalProject(await getProjectStore(), { name, snapshot: imported.snapshot });
    return meta.id;
  }
  const res = await createProject(supabase as RemoteClient, { id: newUuid(), name, snapshot: imported.snapshot, snapshotLabel: 'Imported' });
  if (!res.ok) throw new Error(res.error.message || 'Failed to create project');
  return res.data.project.id;
}

/** Lets the user pick a file and imports it; `null` if cancelled. Errors become notifications. */
export async function openProjectFile(shell: AppShell, supabase: SupabaseClient): Promise<string | null> {
  try {
    const file = await shell.openProjectFile();
    if (!file) return null;
    return await importProjectBytes(supabase, file.bytes, file.name);
  }
  catch (err) {
    notify({ variant: 'error', title: 'Import failed', description: (err as Error).message });
    return null;
  }
}
