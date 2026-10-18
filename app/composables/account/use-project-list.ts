import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getProjectStore } from '~/utils/persistence/project-store';
import type { RemoteClient } from '~/utils/sync/remote-api';
import type { RemoteProjectHead } from '~/utils/sync/remote-api-types';
import { isOnline, onReconnect } from '~/utils/sync/connectivity';
import { syncRecentNames } from '~/composables/app-menu/recent-projects';
import { notify } from '~/composables/use-notifications';
import { mergeProjectList, type ProjectListItem } from '~/utils/account/project-list';
import { reconcileRemoteHeads } from '~/utils/account/mirror';
import { fetchRemoteHeads } from '~/utils/account/remote-heads';
import { createLocalProject, deleteLocalProject, detachAsLocalCopy, renameLocalProject } from '~/utils/account/local-projects';
import { createCloudProject, deleteCloudProject, renameCloudProject } from '~/utils/account/cloud-projects';
import { uploadLocalProject } from '~/utils/account/upload';
import { bumpLocalProjects, localProjectsRevision, requestMirror } from './account-state';
import { useAccountSession } from './use-account-session';

/**
 * Project list page logic (ADR 0004 D1, D3, D11, D13, D15): reads the local
 * store first, then (signed in and online) refreshes from the account's
 * remote heads. Every operation returns an error message or `null`.
 */
export function useProjectList() {
  const supabase = useSupabaseClient() as unknown as SupabaseClient;
  const client = supabase as unknown as RemoteClient;
  const { account, policy } = useAccountSession();

  const items = ref<ProjectListItem[]>([]);
  const loading = ref(true);
  /** Last fetched heads (kept while offline so uncached cloud entries stay visible). */
  const heads = shallowRef<RemoteProjectHead[] | null>(null);

  // ── Loading ────────────────────────────────────────────────────────────────

  /** Rebuilds the list from the store and the cached heads. */
  async function rebuild(): Promise<void> {
    const store = await getProjectStore();
    const locals = await store.listProjects();
    const pending: Record<string, number> = {};
    await Promise.all(locals.filter(m => m.origin === 'cloud').map(async (m) => {
      pending[m.id] = await store.countPending(m.id);
    }));
    items.value = mergeProjectList({
      locals,
      heads: account.value ? heads.value : null,
      userId: account.value?.id ?? null,
      pending,
      showForeign: policy.showForeignProjects,
    });
  }

  /** Local first, then remote heads when possible. */
  async function refresh(): Promise<void> {
    try {
      await rebuild();
      loading.value = false;
      const user = account.value;
      // Signed out the local store is the whole list.
      if (!user) syncRecentNames(items.value);
      if (!user || !isOnline.value) return;
      const requestStartedAt = Date.now();
      const res = await fetchRemoteHeads(client);
      if (!res.ok) return;
      heads.value = res.data;
      const store = await getProjectStore();
      const reconciled = await reconcileRemoteHeads(store, res.data, user.id, { requestStartedAt });
      if (reconciled.markedDeleted.length) {
        notify({ variant: 'warning', title: 'Project deleted on the server', description: `${reconciled.markedDeleted.map(m => m.name).join(', ')} still had unsynced changes and was kept on this device.` });
      }
      await rebuild();
      // Complete list now: keep File → Open Recent names current (drops deleted projects).
      syncRecentNames(items.value);
      if (reconciled.stale.length) requestMirror();
    }
    catch (err) {
      console.error('[projects] list refresh failed:', err);
    }
    finally {
      loading.value = false;
    }
  }

  watch([localProjectsRevision, () => account.value?.id], () => { void refresh(); });
  let offReconnect: (() => void) | null = null;
  onMounted(() => {
    offReconnect = onReconnect(() => { void refresh(); });
    void refresh();
  });
  onBeforeUnmount(() => offReconnect?.());

  // ── Operations ─────────────────────────────────────────────────────────────

  /**
   * Creates a project. `cloud` needs an account and a connection; `local`
   * stays on this device (desktop). Resolves with the id or an error.
   */
  async function create(name: string, description: string, target: 'cloud' | 'local'): Promise<{ id?: string; error?: string }> {
    const store = await getProjectStore();
    if (target === 'local') {
      const meta = await createLocalProject(store, { name, description });
      bumpLocalProjects();
      return { id: meta.id };
    }
    const user = account.value;
    if (!user) return { error: 'Sign in to create cloud projects' };
    if (!isOnline.value) return { error: 'You are offline' };
    const res = await createCloudProject(client, store, { name, description, userId: user.id, cacheLocally: policy.mirrorCloudProjects });
    if (!res.ok) return { error: res.error.message || 'Failed to create project' };
    bumpLocalProjects();
    return { id: res.data.id };
  }

  /** Renames on the server (cloud) or locally (local / kept copies). */
  async function rename(item: ProjectListItem, name: string, description: string): Promise<string | null> {
    const store = await getProjectStore();
    if (item.kind === 'cloud') {
      const res = await renameCloudProject(client, store, item.id, name, description);
      if (!res.ok) return res.error.message || 'Failed to rename project';
    }
    else {
      await renameLocalProject(store, item.id, name, description);
    }
    bumpLocalProjects();
    return null;
  }

  /** Deletes on the server (own cloud projects) or removes the copy on this device. */
  async function remove(item: ProjectListItem): Promise<string | null> {
    const store = await getProjectStore();
    if (item.kind === 'cloud' && !item.remoteDeleted) {
      const res = await deleteCloudProject(client, store, item.id);
      if (!res.ok) return res.error.message || 'Failed to delete project';
    }
    else {
      await deleteLocalProject(store, item.id);
    }
    bumpLocalProjects();
    return null;
  }

  /** "Detach as local copy" (D15). Resolves with the new id. */
  async function detach(item: ProjectListItem): Promise<string | null> {
    const copy = await detachAsLocalCopy(await getProjectStore(), item.id);
    bumpLocalProjects();
    return copy?.id ?? null;
  }

  /** Uploads one local project to the signed-in account. */
  async function upload(item: ProjectListItem): Promise<string | null> {
    const user = account.value;
    if (!user) return 'Sign in to upload projects';
    const res = await uploadLocalProject(client, await getProjectStore(), item.id, user.id);
    bumpLocalProjects();
    if (!res.ok) return res.error.kind === 'network' ? 'You are offline' : res.error.message;
    return null;
  }

  return { items, loading, refresh, create, rename, remove, detach, upload };
}
