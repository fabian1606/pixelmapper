/**
 * App-wide open state of the Settings dialog, so the header button, the
 * desktop menu (Settings…, MCP → MCP Server Setup…) and ⌘, open the same
 * dialog. The dialog itself is mounted once in `app.vue`.
 */
import { ref } from 'vue';

/** Tabs the dialog can open at. */
export type SettingsSection = 'mcp' | 'shortcuts';

/** Whether the dialog is open. */
export const settingsOpen = ref(false);

/** Section to reveal when the dialog opens (`null` = top). */
export const settingsSection = ref<SettingsSection | null>(null);

/** Opens the dialog, optionally at a section. */
export function openSettings(section: SettingsSection | null = null): void {
  settingsSection.value = section;
  settingsOpen.value = true;
}
