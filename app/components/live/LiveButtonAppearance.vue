<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronRight } from 'lucide-vue-next';
import type { ButtonActiveLook, ButtonAppearance, ButtonInactiveLook } from '~/utils/live/types';
import { resolveAppearance } from '~/utils/live/button-actions';

/**
 * Appearance of a button (or of all buttons of a section): the label is
 * always visible, color and active / inactive look sit behind "More" (like
 * the modifier ParamForm), collapsed with a one-line summary.
 */
const props = defineProps<{
  /** Own label; hidden for sections (their label comes from the preset). */
  label?: string;
  showLabel: boolean;
  /** Placeholder for an empty label, e.g. the first action's name. */
  autoLabel?: string | null;
  /** Own color; empty / absent = automatic (preset color). Empty string survives sync, unlike undefined. */
  color?: string;
  appearance?: ButtonAppearance;
}>();

const emit = defineEmits<{
  (e: 'patch', patch: { label?: string; color?: string; appearance?: ButtonAppearance }): void;
}>();

const ACTIVE_LABELS: Record<ButtonActiveLook, string> = { full: 'Full color', blink: 'Blink', pulse: 'Pulse to the beat' };
const INACTIVE_LABELS: Record<ButtonInactiveLook, string> = { dim: 'Dimmed', off: 'Off', full: 'Full color' };

// "More" open state, remembered per viewer (same idea as ParamForm).
const STORAGE_KEY = 'pm.live.appearanceMore';
function readOpen(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}
const open = ref(readOpen());
function toggle() {
  open.value = !open.value;
  try { localStorage.setItem(STORAGE_KEY, open.value ? '1' : '0'); } catch { /* storage unavailable */ }
}

const look = computed(() => resolveAppearance(props.appearance));
const summary = computed(() =>
  `${props.color ? 'Own color' : 'Preset color'} · ${ACTIVE_LABELS[look.value.active]} · ${INACTIVE_LABELS[look.value.inactive].toLowerCase()} when off`,
);

function setLook(patch: ButtonAppearance) {
  emit('patch', { appearance: { ...props.appearance, ...patch } });
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-if="showLabel" class="flex flex-col gap-1">
      <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Label</span>
      <input
        type="text"
        class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
        :placeholder="autoLabel ? `${autoLabel} (auto)` : 'Button label'"
        :value="label ?? ''"
        @change="(e) => emit('patch', { label: (e.target as HTMLInputElement).value })"
      />
    </div>

    <button
      type="button"
      class="flex items-center gap-1 min-w-0 text-[11px] text-muted-foreground hover:text-foreground self-stretch text-left"
      :aria-expanded="open"
      @click="toggle"
    >
      <ChevronRight class="h-3.5 w-3.5 shrink-0 transition-transform" :class="open && 'rotate-90'" />
      <span class="shrink-0">More</span>
      <span v-if="!open" class="ml-1 truncate text-muted-foreground/60 flex items-center gap-1">
        <span v-if="color" class="inline-block size-2 rounded-sm shrink-0" :style="{ backgroundColor: color }" />
        {{ summary }}
      </span>
    </button>

    <div v-if="open" class="flex flex-col gap-2 pl-1">
      <div class="flex flex-col gap-1">
        <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Color</span>
        <div class="flex gap-1.5">
          <select
            class="flex-1 min-w-0 text-xs bg-background border border-border rounded px-2 py-1.5"
            :value="color ? 'own' : 'auto'"
            @change="(e) => emit('patch', { color: (e.target as HTMLSelectElement).value === 'own' ? '#3b82f6' : '' })"
          >
            <option value="auto">Auto (preset color)</option>
            <option value="own">Own color</option>
          </select>
          <input
            v-if="color"
            type="color"
            class="w-10 h-[30px] shrink-0 bg-background border border-border rounded cursor-pointer"
            :value="color"
            @change="(e) => emit('patch', { color: (e.target as HTMLInputElement).value })"
          />
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">When active</span>
        <select
          class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
          :value="look.active"
          @change="(e) => setLook({ active: (e.target as HTMLSelectElement).value as ButtonActiveLook })"
        >
          <option v-for="(l, k) in ACTIVE_LABELS" :key="k" :value="k">{{ l }}</option>
        </select>
      </div>

      <div class="flex flex-col gap-1">
        <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">When inactive</span>
        <select
          class="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
          :value="look.inactive"
          @change="(e) => setLook({ inactive: (e.target as HTMLSelectElement).value as ButtonInactiveLook })"
        >
          <option v-for="(l, k) in INACTIVE_LABELS" :key="k" :value="k">{{ l }}</option>
        </select>
      </div>
    </div>
  </div>
</template>
