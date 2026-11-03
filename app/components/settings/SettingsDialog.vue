<script setup lang="ts">
/**
 * App settings dialog, mounted once in `app.vue` and opened from the header
 * button, ⌘, and the desktop menu (Settings…, MCP → MCP Server Setup…).
 * Device-level preferences that are not part of a project, one tab each:
 * the MCP server pairing and the keyboard shortcuts.
 */
import { ref, watch } from 'vue';
import ExternalAgentsSection from '~/components/settings/ExternalAgentsSection.vue';
import ShortcutsSection from '~/components/settings/ShortcutsSection.vue';
import { settingsSection, type SettingsSection } from '~/composables/use-settings-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const open = defineModel<boolean>('open', { default: false });

/** Visible tab; follows the section the dialog was opened at. */
const tab = ref<SettingsSection>('mcp');

watch(open, (isOpen) => {
  if (isOpen && settingsSection.value) tab.value = settingsSection.value;
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Preferences for this device.</DialogDescription>
      </DialogHeader>
      <Tabs v-model="tab">
        <TabsList>
          <TabsTrigger value="mcp">MCP Server</TabsTrigger>
          <TabsTrigger value="shortcuts">Shortcuts</TabsTrigger>
        </TabsList>
        <TabsContent value="mcp" class="pt-2">
          <ExternalAgentsSection />
        </TabsContent>
        <TabsContent value="shortcuts" class="pt-2">
          <ShortcutsSection />
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>
</template>
