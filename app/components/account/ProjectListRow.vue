<template>
  <div class="flex items-center justify-between p-4 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors group">
    <div class="flex-1 min-w-0 cursor-pointer" @click="emit('open', item)">
      <div class="flex items-center gap-2 flex-wrap">
        <p class="font-medium text-sm truncate">{{ item.name }}</p>
        <Badge v-if="item.kind === 'local'" variant="secondary">
          <HardDrive />Local
        </Badge>
        <Badge v-else-if="item.kind === 'cloud'" variant="outline">
          <Cloud />Cloud
        </Badge>
        <Badge v-else variant="outline" :title="ownerTitle">
          <UserRound />Owned by {{ ownerName }}
        </Badge>
        <Badge v-if="item.remoteDeleted" variant="destructive">Deleted on server</Badge>
        <Badge v-if="item.pending > 0" variant="secondary" title="Changes not yet synced">
          <RefreshCw />{{ item.pending }} pending
        </Badge>
      </div>
      <p v-if="item.description" class="text-xs text-muted-foreground truncate">{{ item.description }}</p>
      <p class="text-xs text-muted-foreground">
        Updated {{ formatRelative(item.updatedAt) }}<span v-if="item.role"> · {{ item.role }}</span>
      </p>
    </div>

    <div class="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" class="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity" aria-label="Project actions" @click.stop>
            <MoreHorizontal :size="16" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-56">
          <DropdownMenuItem :disabled="!actions.rename" @select="emit('rename', item)">
            <Edit :size="14" />Rename
          </DropdownMenuItem>
          <DropdownMenuItem v-if="actions.upload" @select="emit('upload', item)">
            <CloudUpload :size="14" />Upload to account
          </DropdownMenuItem>
          <DropdownMenuItem v-if="actions.detach" @select="emit('detach', item)">
            <Copy :size="14" />Detach as local copy
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem :disabled="!actions.delete" class="text-destructive focus:text-destructive" @select="emit('delete', item)">
            <Trash2 :size="14" />{{ actions.deleteIsLocalOnly && item.kind !== 'local' ? 'Remove from this device' : 'Delete' }}
          </DropdownMenuItem>
          <p v-if="actions.disabledHint" class="px-2 py-1.5 text-xs text-muted-foreground">{{ actions.disabledHint }}</p>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChevronRight :size="16" class="text-muted-foreground" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * One entry of the project list: name, Local / Cloud / "Owned by …" badges,
 * pending changes and the actions menu (ADR 0004 D3, D15).
 */
import { computed } from 'vue';
import { accountLabel } from '~/utils/account/known-accounts';
import { projectActions, type ProjectListItem } from '~/utils/account/project-list';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { ChevronRight, Cloud, CloudUpload, Copy, Edit, HardDrive, MoreHorizontal, RefreshCw, Trash2, UserRound } from 'lucide-vue-next';

const props = defineProps<{
  item: ProjectListItem;
  online: boolean;
  signedIn: boolean;
}>();

const emit = defineEmits<{
  open: [item: ProjectListItem];
  rename: [item: ProjectListItem];
  delete: [item: ProjectListItem];
  detach: [item: ProjectListItem];
  upload: [item: ProjectListItem];
}>();

/** Actions available for this entry right now. */
const actions = computed(() => projectActions(props.item, { online: props.online, signedIn: props.signedIn }));

/** Label of the account a kept copy is bound to. */
const ownerName = computed(() => (props.item.ownerUserId && accountLabel(props.item.ownerUserId)) || 'another account');

/** Tooltip explaining the owner badge. */
const ownerTitle = computed(() => `Kept copy of ${ownerName.value}'s cloud project. It syncs when that account signs in again.`);

/** "today", "yesterday", "3 days ago" … */
function formatRelative(ms: number | null): string {
  if (!ms) return '—';
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round((ms - Date.now()) / 86400000), 'day');
}
</script>
