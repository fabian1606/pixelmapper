<template>
  <div class="min-h-screen bg-background p-8">
    <div class="max-w-4xl mx-auto space-y-8">
      <ProjectListHeader
        :account="account"
        :online="online"
        :importing="importing"
        @create="startCreate"
        @sign-out="signOut"
        @import="importFile"
      />

      <div v-if="loading" class="text-muted-foreground text-sm">Loading…</div>

      <div v-else-if="items.length === 0" class="text-muted-foreground text-sm">
        No projects yet. Create one to get started.
      </div>

      <div v-else class="grid gap-3">
        <ProjectListRow
          v-for="item in items"
          :key="item.id"
          :item="item"
          :online="online"
          :signed-in="!!account"
          @open="openProject"
          @rename="startRename"
          @delete="projectToDelete = $event"
          @detach="detachProject"
          @upload="uploadProject"
        />
      </div>
    </div>

    <ProjectFormDialog
      v-model:open="showCreate"
      mode="create"
      :targets="createTargets"
      :hint="createHint"
      :on-submit="submitCreate"
    />
    <ProjectFormDialog
      v-model:open="showRename"
      mode="rename"
      :initial-name="renaming?.name"
      :initial-description="renaming?.description ?? ''"
      :on-submit="submitRename"
    />
    <ProjectDeleteDialog :item="projectToDelete" @close="projectToDelete = null" @confirm="confirmDelete" />
    <LoginUploadDialog v-if="policy.offerUploadOnLogin" />
    <SignOutDialog />
  </div>
</template>

<script setup lang="ts">
/**
 * Project list (ADR 0004 D1, D3, D13–D16): local and cloud projects merged
 * from the local store, account actions and the login/logout dialogs.
 * Logic lives in `useProjectList` / `useAccountSession`.
 */
import { computed, ref, watch } from 'vue';
import { isOnline } from '~/utils/sync/connectivity';
import { importProjectBytes } from '~/utils/persistence/project-file';
import type { ProjectListItem, ProjectTarget } from '~/utils/account/project-list';
import { notify } from '~/composables/use-notifications';
import { useAccountSession } from '~/composables/account/use-account-session';
import { useProjectList } from '~/composables/account/use-project-list';
import ProjectListHeader from '~/components/account/ProjectListHeader.vue';
import ProjectListRow from '~/components/account/ProjectListRow.vue';
import ProjectFormDialog from '~/components/account/ProjectFormDialog.vue';
import ProjectDeleteDialog from '~/components/account/ProjectDeleteDialog.vue';
import LoginUploadDialog from '~/components/account/LoginUploadDialog.vue';
import SignOutDialog from '~/components/account/SignOutDialog.vue';

definePageMeta({ layout: false });

const supabase = useSupabaseClient();
const router = useRouter();
const route = useRoute();
const { account, policy, signOut } = useAccountSession();
const { items, loading, create, rename, remove, detach, upload } = useProjectList();
const online = isOnline;

// ── Open ─────────────────────────────────────────────────────────────────────

/** Opens a project in the editor. */
function openProject(item: ProjectListItem): void {
  router.push(`/project/${item.id}`);
}

// ── Create ───────────────────────────────────────────────────────────────────

const showCreate = ref(false);

/** Desktop + signed in: choose account or device. Otherwise the target is fixed. */
const createTargets = computed<{ value: ProjectTarget; label: string; disabled?: boolean }[]>(() => {
  if (policy.accountRequired) return [{ value: 'cloud', label: 'Account' }];
  if (!account.value) return [{ value: 'local', label: 'This device' }];
  return [
    { value: 'cloud', label: 'Account (synced)', disabled: !online.value },
    { value: 'local', label: 'This device only' },
  ];
});

/** Explains where the project goes. */
const createHint = computed(() => {
  if (policy.accountRequired) return online.value ? null : 'You are offline. Connect to create a project.';
  if (!account.value) return 'Stored on this device. Sign in to sync it later.';
  return online.value ? null : 'You are offline: the project is stored on this device. You can upload it later.';
});

/** Opens the create dialog. */
function startCreate(): void {
  showCreate.value = true;
}

/** Creates and opens the project. */
async function submitCreate(name: string, description: string, target: ProjectTarget): Promise<string | null> {
  const res = await create(name, description, target);
  if (res.error || !res.id) return res.error ?? 'Failed to create project';
  router.push(`/project/${res.id}`);
  return null;
}

// File → New Project (menu bar) lands here with `?new=1`.
watch(() => route.query.new, (v) => {
  if (!v) return;
  showCreate.value = true;
  router.replace({ query: {} });
}, { immediate: true });

// ── Rename / delete / detach / upload ────────────────────────────────────────

const showRename = ref(false);
const renaming = ref<ProjectListItem | null>(null);
const projectToDelete = ref<ProjectListItem | null>(null);

/** Opens the rename dialog for an entry. */
function startRename(item: ProjectListItem): void {
  renaming.value = item;
  showRename.value = true;
}

/** Renames the entry being edited. */
async function submitRename(name: string, description: string): Promise<string | null> {
  if (!renaming.value) return null;
  return rename(renaming.value, name, description);
}

/** Deletes after confirmation. */
async function confirmDelete(): Promise<void> {
  const item = projectToDelete.value;
  projectToDelete.value = null;
  if (!item) return;
  const err = await remove(item);
  if (err) notify({ variant: 'error', title: 'Delete failed', description: err });
}

/** "Detach as local copy" (D15). */
async function detachProject(item: ProjectListItem): Promise<void> {
  const id = await detach(item);
  if (id) notify({ title: 'Local copy created', description: `"${item.name} (local copy)" is stored on this device.` });
}

/** Uploads a local project to the account. */
async function uploadProject(item: ProjectListItem): Promise<void> {
  const err = await upload(item);
  if (err) notify({ variant: 'error', title: 'Upload failed', description: err });
  else notify({ title: 'Project uploaded', description: `"${item.name}" now syncs with your account.` });
}

// ── Import ───────────────────────────────────────────────────────────────────

const importing = ref(false);

/**
 * Imports a `.pmproject` (same as File → Open) and opens it: a local project
 * on desktop, a cloud project on the web (see `importProjectBytes`).
 */
async function importFile(file: File): Promise<void> {
  importing.value = true;
  try {
    const id = await importProjectBytes(supabase, new Uint8Array(await file.arrayBuffer()), file.name);
    router.push(`/project/${id}`);
  }
  catch (err) {
    notify({ variant: 'error', title: 'Import failed', description: (err as Error).message });
  }
  finally {
    importing.value = false;
  }
}
</script>
