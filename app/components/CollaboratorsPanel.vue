<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useLiveBusStore, TAB_SESSION_ID } from '~/stores/live-bus-store';
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
  display_name: string;
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

const liveBus = useLiveBusStore();
const { presenceUsers, followedSessionId } = storeToRefs(liveBus);
const onlineIds = computed(() => new Set(presenceUsers.value.map(p => p.userId)));

function getInitialsFromUserId(userId: string): string {
  return userId.slice(0, 2).toUpperCase();
}

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

function getInitials(name: string): string {
  if (!name) return '';
  // For "first.last" / "first last" / "first-last" — first letter of each segment.
  // For an email, drop the domain first.
  const local = name.includes('@') ? name.split('@')[0] : name;
  const parts = local.split(/[.\s\-_]+/).filter(Boolean);
  if (parts.length === 0) return '';
  return parts.map(p => p[0]?.toUpperCase() ?? '').join('').slice(0, 2);
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
    <!-- Avatar stack: one entry per WebSocket connection (tab) with its cursor color -->
    <div class="flex items-center -space-x-2">
      <div
        v-for="user in presenceUsers"
        :key="user.sessionId"
        :title="user.sessionId === TAB_SESSION_ID ? (user.displayName || 'You') : followedSessionId === user.sessionId ? `Following ${user.displayName || user.userId}` : (user.displayName || user.userId)"
        :class="user.sessionId !== TAB_SESSION_ID ? 'cursor-pointer' : 'cursor-default'"
        class="relative"
        @click="user.sessionId !== TAB_SESSION_ID && liveBus.toggleFollow(user.sessionId)"
      >
        <div
          :style="{
            backgroundColor: user.sessionId === TAB_SESSION_ID ? '#eab308' : user.color,
            boxShadow: followedSessionId === user.sessionId ? `0 0 0 2px white, 0 0 0 4px ${user.color}` : 'none'
          }"
          class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white border-2 border-sidebar shrink-0 transition-shadow"
        >
          {{ user.displayName ? getInitials(user.displayName) : getInitialsFromUserId(user.userId) }}
        </div>
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
              v-for="member in collaborators"
              :key="member.user_id"
              class="flex items-center gap-3 py-2 px-1 rounded-md group"
            >
              <div class="relative shrink-0">
                <div
                  :class="getAvatarColor(member.email)"
                  class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                >
                  {{ getInitials(member.display_name || member.email) }}
                </div>
                <span
                  v-if="onlineIds.has(member.user_id)"
                  class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border border-background"
                />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate">{{ member.display_name || member.email }}</p>
                <p class="text-xs text-muted-foreground truncate">
                  {{ member.email }} · <span class="capitalize">{{ member.role }}</span>
                </p>
              </div>
              <Button
                v-if="isOwner && member.role !== 'owner'"
                variant="ghost"
                size="sm"
                class="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                :disabled="removingId === member.user_id"
                @click="removeCollaborator(member.user_id)"
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
