<template>
  <div class="min-h-screen bg-background p-8">
    <div class="max-w-4xl mx-auto space-y-8">

      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-semibold">Projects</h1>
          <p class="text-muted-foreground text-sm mt-1">{{ user?.email }}</p>
        </div>
        <div class="flex items-center gap-3">
          <Button variant="outline" size="sm" @click="signOut">Sign out</Button>
          <Button size="sm" @click="showCreate = true">New project</Button>
        </div>
      </div>

      <!-- Project list -->
      <div v-if="loading" class="text-muted-foreground text-sm">Loading…</div>

      <div v-else-if="projects.length === 0" class="text-muted-foreground text-sm">
        No projects yet. Create one to get started.
      </div>

      <div v-else class="grid gap-3">
        <div
          v-for="project in projects"
          :key="project.id"
          class="flex items-center justify-between p-4 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors group"
        >
          <div
            class="flex-1 cursor-pointer"
            @click="openProject(project.id)"
          >
            <p class="font-medium text-sm">{{ project.name }}</p>
            <p v-if="project.description" class="text-xs text-muted-foreground">{{ project.description }}</p>
            <p class="text-xs text-muted-foreground">
              Updated {{ formatDate(project.updated_at) }} · {{ project.role }}
            </p>
          </div>
          <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              v-if="project.role === 'owner'"
              variant="ghost"
              size="sm"
              @click.stop="startRename(project)"
            >
              <Edit :size="16" />
            </Button>
            <Button
              v-if="project.role === 'owner'"
              variant="ghost"
              size="sm"
              class="text-destructive hover:text-destructive"
              @click.stop="startDelete(project)"
            >
              <Trash2 :size="16" />
            </Button>
            <ChevronRight :size="16" class="text-muted-foreground" />
          </div>
        </div>
      </div>
    </div>

    <!-- Create project dialog -->
    <Dialog v-model:open="showCreate">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <form class="space-y-4" @submit.prevent="createProject">
          <div class="space-y-2">
            <Label for="projectName">Name</Label>
            <Input id="projectName" v-model="newName" placeholder="My Show" required autofocus />
          </div>
          <div class="space-y-2">
            <Label for="projectDesc">Description <span class="text-muted-foreground">(optional)</span></Label>
            <Input id="projectDesc" v-model="newDescription" placeholder="…" />
          </div>
          <p v-if="createError" class="text-sm text-destructive">{{ createError }}</p>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="outline" @click="showCreate = false">Cancel</Button>
            <Button type="submit" :disabled="creating">
              {{ creating ? 'Creating…' : 'Create' }}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Rename project dialog -->
    <Dialog v-model:open="showRename">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename project</DialogTitle>
        </DialogHeader>
        <form class="space-y-4" @submit.prevent="renameProject">
          <div class="space-y-2">
            <Label for="renameName">Name</Label>
            <Input id="renameName" v-model="editName" placeholder="My Show" required autofocus />
          </div>
          <div class="space-y-2">
            <Label for="renameDesc">Description <span class="text-muted-foreground">(optional)</span></Label>
            <Input id="renameDesc" v-model="editDescription" placeholder="…" />
          </div>
          <p v-if="renameError" class="text-sm text-destructive">{{ renameError }}</p>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="outline" @click="showRename = false">Cancel</Button>
            <Button type="submit" :disabled="renaming">
              {{ renaming ? 'Saving…' : 'Save' }}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Delete project dialog -->
    <DeleteConfirmDialog
      :open="showDeleteConfirm"
      :node-name="projectToDelete?.name || ''"
      @update:open="showDeleteConfirm = $event"
      @confirm="deleteProject"
    />
  </div>
</template>

<script setup lang="ts">
import { ChevronRight, Edit, Trash2 } from 'lucide-vue-next'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import DeleteConfirmDialog from '~/components/engine/DeleteConfirmDialog.vue'

definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()

interface Project {
  id: string
  name: string
  description: string | null
  updated_at: string | null
  role: string
}

const projects = ref<Project[]>([])
const loading = ref(true)
const showCreate = ref(false)
const newName = ref('')
const newDescription = ref('')
const creating = ref(false)
const createError = ref('')

const showRename = ref(false)
const editingProjectId = ref('')
const editName = ref('')
const editDescription = ref('')
const renaming = ref(false)
const renameError = ref('')

const showDeleteConfirm = ref(false)
const projectToDelete = ref<Project | null>(null)
const deleting = ref(false)

async function loadProjects() {
  loading.value = true
  const { data, error } = await supabase.functions.invoke('get-projects')
  loading.value = false
  if (!error && data) projects.value = data
}

async function createProject() {
  createError.value = ''
  creating.value = true
  const { data, error } = await supabase.functions.invoke('create-project', {
    body: { name: newName.value, description: newDescription.value || undefined },
  })
  creating.value = false
  if (error || !data) {
    createError.value = error?.message ?? 'Failed to create project'
    return
  }
  showCreate.value = false
  newName.value = ''
  newDescription.value = ''
  loadProjects()
  router.push(`/project/${data.id}`)
}

function openProject(id: string) {
  router.push(`/project/${id}`)
}

async function signOut() {
  await supabase.auth.signOut()
  router.push('/auth/login')
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
    Math.round((new Date(iso).getTime() - Date.now()) / 86400000),
    'day',
  )
}

function startRename(project: Project) {
  editingProjectId.value = project.id
  editName.value = project.name
  editDescription.value = project.description || ''
  renameError.value = ''
  showRename.value = true
}

async function renameProject() {
  renameError.value = ''
  renaming.value = true
  const { data, error } = await supabase.functions.invoke('rename-project', {
    body: { projectId: editingProjectId.value, name: editName.value, description: editDescription.value || undefined },
  })
  renaming.value = false
  if (error || !data) {
    renameError.value = error?.message ?? 'Failed to rename project'
    return
  }
  showRename.value = false
  loadProjects()
}

function startDelete(project: Project) {
  projectToDelete.value = project
  showDeleteConfirm.value = true
}

async function deleteProject() {
  if (!projectToDelete.value) return
  deleting.value = true
  const { error } = await supabase.functions.invoke('delete-project', {
    method: 'DELETE',
    body: { projectId: projectToDelete.value.id },
  })
  deleting.value = false
  if (error) {
    return
  }
  projectToDelete.value = null
  loadProjects()
}

onMounted(loadProjects)
</script>
