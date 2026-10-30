<script setup lang="ts">
/**
 * App settings dialog, mounted once in `app.vue` and opened from the header
 * button, ⌘, and the desktop menu (Settings…, MCP → MCP Server Setup…).
 * Device-level preferences that are not part of a project; currently the
 * MCP server pairing.
 */
import { nextTick, watch } from 'vue';
import ExternalAgentsSection from '~/components/settings/ExternalAgentsSection.vue';
import { settingsSection } from '~/composables/use-settings-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const open = defineModel<boolean>('open', { default: false });

// Reveal the requested section once the dialog has rendered.
watch(open, async (isOpen) => {
  if (!isOpen || !settingsSection.value) return;
  await nextTick();
  document.getElementById(`settings-${settingsSection.value}`)?.scrollIntoView({ block: 'start' });
});
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
