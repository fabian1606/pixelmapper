/**
 * File → Export / File → Open: `.pmproject` archives through the platform's
 * file dialogs (`AppShell`), on top of `project-transfer.ts`.
 */
import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { AppShell } from '~/platform/app-shell';
import { notify } from '~/composables/use-notifications';
import { exportProject, importArchive } from './project-transfer';

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
 */
export async function importProjectBytes(supabase: SupabaseClient, bytes: Uint8Array, fileName?: string): Promise<string> {
  const imported = await importArchive(bytes);
  const failed = Object.keys(imported.pluginErrors).length;
  if (failed) notify({ variant: 'warning', title: 'Some plugins could not be verified', description: `${failed} content plugin(s) were skipped.` });
  const name = imported.name || fileName?.replace(/\.pmproject$/, '') || 'Imported project';
  const { data, error } = await supabase.functions.invoke('create-project', { body: { name } });
  if (error || !data) throw new Error(error?.message ?? 'Failed to create project');
  const saved = await supabase.functions.invoke('save-snapshot', { body: { projectId: data.id, snapshot: imported.snapshot, sequenceNumber: 0, label: 'Imported' } });
  if (saved.error) throw new Error(saved.error.message);
  return data.id as string;
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
