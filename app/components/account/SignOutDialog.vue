<template>
  <AlertDialog :open="open">
    <AlertDialogContent>
      <template v-if="state.step === 'syncing' || state.step === 'finishing'">
        <AlertDialogHeader>
          <AlertDialogTitle>Signing out…</AlertDialogTitle>
          <AlertDialogDescription>
            {{ state.step === 'syncing' ? 'Syncing your latest changes.' : 'Cleaning up.' }}
          </AlertDialogDescription>
        </AlertDialogHeader>
      </template>

      <template v-else-if="state.step === 'pending'">
        <AlertDialogHeader>
          <AlertDialogTitle>Unsynced changes</AlertDialogTitle>
          <AlertDialogDescription>
            {{ pendingText }} could not be synced{{ online ? '' : ' because you are offline' }}.
            {{ policy.logoutCache === 'clear'
              ? 'They will be lost if you sign out now.'
              : 'If you keep the local copies, they stay on this device and sync the next time you sign in.' }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="cancelSignOut">Cancel</AlertDialogCancel>
          <AlertDialogAction :class="policy.logoutCache === 'clear' ? destructiveClass : ''" @click.prevent="confirmPendingSignOut">
            Sign out anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </template>

      <template v-else-if="state.step === 'copies'">
        <AlertDialogHeader>
          <AlertDialogTitle>Keep local copies?</AlertDialogTitle>
          <AlertDialogDescription>
            Keep local copies of your {{ state.copies }} cloud project{{ state.copies === 1 ? '' : 's' }} on this device?
            Kept projects stay linked to {{ account?.label ?? 'your account' }}: you can still open and edit them,
            and they sync when you sign in again. Local-only projects are always kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="cancelSignOut">Cancel</AlertDialogCancel>
          <Button variant="outline" :class="destructiveClass" @click="chooseLocalCopies(false)">Remove</Button>
          <AlertDialogAction @click.prevent="chooseLocalCopies(true)">Keep</AlertDialogAction>
        </AlertDialogFooter>
      </template>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
/**
 * Sign-out dialog (ADR 0004 D15 desktop, D16 web): progress while syncing,
 * a confirmation when changes could not be synced, and on desktop the
 * "Keep local copies?" question. Driven by `useAccountSession()`.
 */
import { computed } from 'vue';
import { isOnline } from '~/utils/sync/connectivity';
import { useAccountSession } from '~/composables/account/use-account-session';
import { Button } from '~/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog';

const { account, policy, signOutState, confirmPendingSignOut, chooseLocalCopies, cancelSignOut } = useAccountSession();

const state = signOutState;
const online = isOnline;
const open = computed(() => state.value.step !== 'idle');
const destructiveClass = 'text-destructive hover:text-destructive';

/** "3 project changes and 1 custom fixture". */
const pendingText = computed(() => {
  const s = state.value;
  if (s.step !== 'pending') return '';
  const parts: string[] = [];
  if (s.pending.projects) parts.push(`${s.pending.projects} project change${s.pending.projects === 1 ? '' : 's'}`);
  if (s.pending.records) parts.push(`${s.pending.records} custom fixture${s.pending.records === 1 ? '' : 's'}`);
  return parts.join(' and ');
});
</script>
