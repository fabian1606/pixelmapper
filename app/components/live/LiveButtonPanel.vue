<script setup lang="ts">
import { computed } from 'vue';
import { useEngineStore } from '~/stores/engine-store';
import type { ButtonAction, ButtonAppearance, InputBinding, LiveSection } from '~/utils/live/types';
import { autoLabel } from '~/utils/live/button-actions';
import SegmentedControl from '~/components/engine/SegmentedControl.vue';
import LiveButtonAppearance from './LiveButtonAppearance.vue';
import LiveActionList from './LiveActionList.vue';
import LiveSectionAssignment from './LiveSectionAssignment.vue';
import LiveInputList from './LiveInputList.vue';

/**
 * Sidebar panel of one button (canvas button or controller pad). Order:
 * Action | Section switch on top, then the Appearance group, then the group
 * that grows (the action cards, or the section settings).
 *
 * With Section, Appearance belongs to the whole section, so a member has no
 * look of its own. Section membership itself lives on the page; the panel
 * only emits intents and the sidebar runs the commands.
 */
type ButtonPatch = { label?: string; color?: string; actions?: ButtonAction[]; appearance?: ButtonAppearance; inputs?: InputBinding[] };

const props = defineProps<{
  label?: string;
  color?: string;
  actions?: ButtonAction[];
  appearance?: ButtonAppearance;
  /** Outside inputs (key, MIDI, …) that also press this button. */
  inputs?: InputBinding[];
  /** What a controller pad already sends in hardware (read-only). */
  nativeInput?: string | null;
  /** Section this button belongs to, if any. */
  section: LiveSection | null;
  /** All sections of the page (for the section picker). */
  sections: LiveSection[];
  /** "Section" chosen while sections exist: waiting for the user to pick one. */
  sectionPending: boolean;
}>();

const emit = defineEmits<{
  (e: 'patch', patch: ButtonPatch): void;
  (e: 'patch-section', sectionId: string, patch: Partial<Pick<LiveSection, 'color' | 'appearance'>>): void;
  /** Switch to Section (join / create one). */
  (e: 'choose-section'): void;
  /** Switch to Action (leave the section; actions stay stored). */
  (e: 'choose-action'): void;
  /** Move the button into section `target` ('new' creates one). */
  (e: 'move', target: string): void;
}>();

const engineStore = useEngineStore();

const mode = computed<'action' | 'section'>(() => (props.section || props.sectionPending ? 'section' : 'action'));
const MODE_OPTIONS = [
  { value: 'action' as const, label: 'Action' },
  { value: 'section' as const, label: 'Section' },
];

function setMode(next: 'action' | 'section') {
  if (next === mode.value) return;
  if (next === 'section') emit('choose-section');
  else emit('choose-action');
}

const placeholderLabel = computed(() => autoLabel(props.actions, engineStore.savedPresets));

function onSectionAppearance(patch: { color?: string; appearance?: ButtonAppearance }) {
  if (!props.section) return;
  const next: Partial<Pick<LiveSection, 'color' | 'appearance'>> = {};
  if ('color' in patch) next.color = patch.color;
  if ('appearance' in patch) next.appearance = patch.appearance;
  emit('patch-section', props.section.id, next);
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <SegmentedControl
      aria-label="Button content"
      :options="MODE_OPTIONS"
      :model-value="mode"
      @update:model-value="setMode"
    />

    <!-- ── Appearance ─────────────────────────────────────────────────── -->
    <div v-if="mode === 'action' || section" class="flex flex-col gap-3 pt-4 border-t border-border">
      <div class="flex items-center justify-between">
        <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Appearance</span>
        <span v-if="section" class="text-[10px] text-violet-300">all {{ section.members.length }} buttons</span>
      </div>
      <LiveButtonAppearance
        v-if="section"
        :show-label="false"
        :color="section.color"
        :appearance="section.appearance"
        @patch="onSectionAppearance"
      />
      <LiveButtonAppearance
        v-else
        show-label
        :label="label"
        :auto-label="placeholderLabel"
        :color="color"
        :appearance="appearance"
        @patch="(p) => emit('patch', p)"
      />
    </div>

    <!-- ── Input: keys / MIDI / … press this button like a click ───────── -->
    <LiveInputList
      class="pt-4 border-t border-border"
      :inputs="inputs"
      :native="nativeInput"
      @update="(next) => emit('patch', { inputs: next.length ? next : undefined })"
    />

    <!-- ── Actions / Section ───────────────────────────────────────────── -->
    <div class="flex flex-col gap-3 pt-4 border-t border-border">
      <div class="flex items-center justify-between">
        <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ mode === 'action' ? 'Actions' : 'Section' }}
        </span>
        <span v-if="mode === 'action'" class="text-[10px] font-mono text-muted-foreground/60">{{ Math.max(1, actions?.length ?? 0) }}</span>
      </div>

      <LiveActionList
        v-if="mode === 'action'"
        :actions="actions ?? []"
        @update="(next) => emit('patch', { actions: next })"
      />
      <LiveSectionAssignment
        v-else
        :section="section"
        :sections="sections"
        @move="(target) => emit('move', target)"
      />
    </div>
  </div>
</template>
