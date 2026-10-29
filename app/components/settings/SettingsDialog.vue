<script setup lang="ts">
/**
 * App settings dialog (opened from the header). Device-level preferences
 * that are not part of a project; currently only *External agents*.
 */
import ExternalAgentsSection from '~/components/settings/ExternalAgentsSection.vue';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const open = defineModel<boolean>('open', { default: false });
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Preferences for this device.</DialogDescription>
      </DialogHeader>
      <ExternalAgentsSection />
    </DialogContent>
  </Dialog>
</template>
