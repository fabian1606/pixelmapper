<script setup lang="ts">
import type { LiveSection } from '~/utils/live/types';
import { sectionDisplayName } from '~/utils/live/sections';
import LiveSectionEditor from './LiveSectionEditor.vue';

/**
 * Shown under a single button / pad whose action is "Section": picks which
 * section the control belongs to (or creates a new one) and, once it is a
 * member, embeds the section's editor.
 */
defineProps<{
  /** Section the control currently belongs to (null while the choice is pending). */
  section: LiveSection | null;
  /** All sections of the active page. */
  sections: LiveSection[];
}>();

const emit = defineEmits<{
  /** Move the control into section `target` (a section id, or 'new' for a fresh one). */
  (e: 'move', target: string): void;
}>();
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-col gap-1">
      <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Section</span>
      <select
        class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
        :value="section?.id ?? ''"
        @change="(e) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v) emit('move', v);
        }"
      >
        <option v-if="!section" value="">— choose section —</option>
        <option v-for="s in sections" :key="s.id" :value="s.id">
          {{ sectionDisplayName(s) }} ({{ s.members.length }})
        </option>
        <option value="new">+ New section</option>
      </select>
    </div>

    <LiveSectionEditor v-if="section" :section="section" />
  </div>
</template>
