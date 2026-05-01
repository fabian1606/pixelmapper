<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { UserPlus, X } from 'lucide-vue-next';

interface Collaborator {
  role: string;
  user_id: string;
  accepted_at: string | null;
  email: string;
}

interface Props {
  projectId: string;
}

const props = defineProps<Props>();
const supabase = useSupabaseClient();

const collaborators = ref<Collaborator[]>([]);
const loading = ref(false);
const showDialog = ref(false);
const inviteEmails = ref('');
const inviting = ref(false);
const inviteError = ref('');
const inviteSuccess = ref('');
const removingId = ref<string | null>(null);

const currentUserId = computed(() => supabase.auth.getUser().then(r => r.data.user?.id));

const currentUserRole = computed(() => {
  const uid = collaborators.value.find(c => c.user_id === _currentUserId.value)?.role;
  return uid ?? null;
});

const _currentUserId = ref<string | null>(null);
const isOwner = computed(() => currentUserRole.value === 'owner');

async function loadCollaborators() {
  loading.value = true;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    _currentUserId.value = user?.id ?? null;

    const { data, error } = await supabase.functions.invoke('get-collaborators', {
      body: { projectId: props.projectId },
    });
    if (!error && data) {
      collaborators.value = data;
    }
  } catch (e) {
    console.error('Failed to load collaborators:', e);
  }
  loading.value = false;
}

async function removeCollaborator(userId: string) {
  removingId.value = userId;
  const { error } = await supabase.functions.invoke('remove-collaborator', {
    body: { projectId: props.projectId, userId },
  });
  removingId.value = null;
  if (!error) {
    collaborators.value = collaborators.value.filter(c => c.user_id !== userId);
  }
}

async function inviteCollaborators() {
  inviteError.value = '';
  inviteSuccess.value = '';
  inviting.value = true;

  const emails = inviteEmails.value
    .split(',')
    .map(e => e.trim())
    .filter(e => e.length > 0);

  if (emails.length === 0) {
    inviteError.value = 'Please enter at least one email';
    inviting.value = false;
    return;
  }

  const { data, error } = await supabase.functions.invoke('invite-collaborator', {
    body: { projectId: props.projectId, emails },
  });

  inviting.value = false;

  if (error) {
    inviteError.value = error.message || 'Failed to invite collaborators';
    return;
  }

  const results: { email: string; success: boolean; message?: string }[] = data ?? [];
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  if (failed.length > 0 && successful.length === 0) {
    inviteError.value = failed.map(r => `${r.email}: ${r.message}`).join(', ');
    return;
  }

  inviteEmails.value = '';
  inviteSuccess.value = `${successful.length} user(s) added`;
  if (failed.length > 0) {
    inviteSuccess.value += ` · ${failed.map(r => `${r.email}: ${r.message}`).join(', ')}`;
  }

  await loadCollaborators();
}

function getInitials(email: string): string {
  const parts = email.split('@')[0].split('.');
  return parts.map(p => p[0].toUpperCase()).join('').slice(0, 2);
}

function getAvatarColor(email: string): string {
  const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-purple-500', 'bg-pink-500'];
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = ((hash << 5) - hash) + email.charCodeAt(i);
    hash = hash & hash;
  }
  return colors[Math.abs(hash) % colors.length];
}

onMounted(loadCollaborators);
</script>

<template>
  <div class="flex items-center gap-2">
    <!-- Avatar stack -->
    <div class="flex items-center -space-x-2">
      <div
        v-for="collab in collaborators"
        :key="collab.user_id"
        :title="collab.email"
        :class="getAvatarColor(collab.email)"
        class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white border-2 border-sidebar shrink-0"
      >
        {{ getInitials(collab.email) }}
      </div>
    </div>

    <!-- Open dialog button -->
    <Button
      variant="ghost"
      size="sm"
      class="text-sidebar-foreground/50 hover:text-sidebar-foreground"
      @click="showDialog = true"
    >
      <UserPlus :size="16" />
    </Button>

    <!-- Collaborators dialog -->
    <Dialog v-model:open="showDialog">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Collaborators</DialogTitle>
        </DialogHeader>

        <div class="space-y-4">
          <!-- Member list -->
          <div class="space-y-1">
            <div
              v-for="collab in collaborators"
              :key="collab.user_id"
              class="flex items-center gap-3 py-2 px-1 rounded-md group"
            >
              <div
                :class="getAvatarColor(collab.email)"
                class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
              >
                {{ getInitials(collab.email) }}
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate">{{ collab.email }}</p>
                <p class="text-xs text-muted-foreground capitalize">{{ collab.role }}</p>
              </div>
              <Button
                v-if="isOwner && collab.role !== 'owner'"
                variant="ghost"
                size="sm"
                class="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                :disabled="removingId === collab.user_id"
                @click="removeCollaborator(collab.user_id)"
              >
                <X :size="14" />
              </Button>
            </div>
          </div>

          <!-- Invite form — only for owners -->
          <template v-if="isOwner">
            <div class="border-t pt-4 space-y-3">
              <Label for="invite-emails">Invite by email</Label>
              <div class="flex gap-2">
                <Input
                  id="invite-emails"
                  v-model="inviteEmails"
                  placeholder="name@example.com"
                  class="flex-1"
                  @keydown.enter.prevent="inviteCollaborators"
                />
                <Button :disabled="inviting" @click="inviteCollaborators">
                  {{ inviting ? '…' : 'Add' }}
                </Button>
              </div>
              <p class="text-xs text-muted-foreground">Separate multiple emails with commas</p>
              <p v-if="inviteError" class="text-sm text-destructive">{{ inviteError }}</p>
              <p v-if="inviteSuccess" class="text-sm text-green-600">{{ inviteSuccess }}</p>
            </div>
          </template>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
