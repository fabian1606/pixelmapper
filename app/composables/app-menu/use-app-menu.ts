/**
 * Wires the app commands to the platform: native menu clicks (desktop),
 * keyboard shortcuts (both), the "Open Recent" list and the enabled state of
 * project-only items. Call once, from `app.vue`.
 */
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { getAccountPolicy, getAppShell, getMcpSetupInfo } from '#platform';
import { getProjectStore } from '~/utils/persistence/project-store';
import { useEngineStore } from '~/stores/engine-store';
import { triggerSaveSnapshot } from '~/components/engine/composables/use-history';
import { useShortcuts } from '~/components/engine/composables/use-shortcuts';
import { exportProjectFile, openProjectFile } from '~/utils/persistence/project-file';
import { runAppCommand, WEB_SHORTCUTS, type AppCommandContext } from './app-commands';
import { openSettings } from '~/composables/use-settings-dialog';
import { notify } from '~/composables/use-notifications';
import { claudeCodeCommand, claudeDesktopConfig } from '~/utils/agents/mcp-setup';
import { clearRecentProjects, loadRecentProjects, recentProjects, recordProjectOpened, syncRecentNames } from './recent-projects';

/** Label for a recent project whose name is not known yet. */
const UNTITLED = 'Untitled project';

/** Context of the mounted app menu (one per app), for `runMenuCommand`. */
let activeCtx: AppCommandContext | null = null;

/** Runs an app command from UI outside the menu (e.g. the web header's export button). */
export function runMenuCommand(id: string): void {
  if (activeCtx) runAppCommand(id, activeCtx);
}

/** Whether the platform shows the app commands in a native menu bar. */
export const hasNativeMenu = getAppShell().nativeMenu;

export function useAppMenu(): void {
  const shell = getAppShell();
  const route = useRoute();
  const router = useRouter();
  const supabase = useSupabaseClient();
  const user = useSupabaseUser();
  const engineStore = useEngineStore();

  /** Open project, from the route (`/project/:id/...`). */
  const projectId = computed(() => route.path.startsWith('/project/') ? (route.params.id as string | undefined) ?? null : null);

  /**
   * Refreshes recent names from the project list (drops deleted projects).
   * Local projects (ADR 0004 D3) count too, so they are never dropped.
   */
  async function refreshNames() {
    const locals = await getProjectStore()
      .then(store => store.listProjects())
      .then(list => list.map(m => ({ id: m.id, name: m.name })))
      .catch(() => null);
    if (!user.value) {
      // Signed out on desktop the local store is the whole list.
      if (locals && !getAccountPolicy().accountRequired) syncRecentNames(locals);
      return;
    }
    const { data, error } = await supabase.functions.invoke('get-projects');
    if (!error && Array.isArray(data)) syncRecentNames([...(locals ?? []), ...data]);
  }

  const ctx: AppCommandContext = {
    projectId: () => projectId.value,
    navigate: path => void router.push(path),
    newProject: () => void router.push({ path: '/', query: { new: '1' } }),
    async openFile() {
      const id = await openProjectFile(shell, supabase);
      if (id) await router.push(`/project/${id}`);
    },
    save: () => triggerSaveSnapshot(),
    async exportFile() {
      const snapshot = engineStore.currentSnapshot();
      const id = projectId.value;
      if (!snapshot || !id) return;
      const name = recentProjects.value.find(p => p.id === id)?.name || `project-${id}`;
      await exportProjectFile(shell, snapshot, name);
    },
    clearRecent: clearRecentProjects,
    openSettings,
    async copyMcpSetup(client) {
      const { cliPath } = await getMcpSetupInfo();
      const text = client === 'claude-code' ? claudeCodeCommand(cliPath) : claudeDesktopConfig(cliPath);
      const what = client === 'claude-code' ? 'Claude Code command' : 'Claude Desktop config';
      try {
        await navigator.clipboard.writeText(text);
        notify({ title: `Copied ${what}`, description: cliPath ? undefined : 'Replace <repo> with your Pixelmapper checkout.' }, 4000);
      } catch (error) {
        console.warn('[mcp] clipboard write failed', error);
        notify({ title: `Could not copy the ${what}`, description: 'Open MCP → MCP Server Setup… and copy it there.', variant: 'warning' });
      }
    },
  };

  activeCtx = ctx;
  useShortcuts(WEB_SHORTCUTS.map(s => ({ ...s, handler: () => runAppCommand(s.command, ctx) })));

  let offMenu: (() => void) | undefined;
  onMounted(() => {
    offMenu = shell.onMenuCommand((id) => {
      if (!runAppCommand(id, ctx)) console.warn(`[app-menu] unknown command "${id}"`);
    });
    loadRecentProjects();
    watch(recentProjects, list => shell.setRecentProjects(list.map(p => ({ id: p.id, name: p.name || UNTITLED }))), { immediate: true });
    watch(projectId, (id) => {
      shell.setProjectOpen(!!id);
      if (!id) return;
      recordProjectOpened(id);
      if (!recentProjects.value[0]?.name) void refreshNames();
    }, { immediate: true });
    void refreshNames();
  });
  onBeforeUnmount(() => offMenu?.());
}
